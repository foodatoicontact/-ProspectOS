import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  createSafeFetch,
  isPublicAddress,
  validateUrl,
  nativeRequest,
  type SafeFetchDependencies,
  type TransportResponse,
} from '../src/discovery/safe-fetch.ts';

const response = (statusCode: number, body = '', headers: Record<string, string> = {}): TransportResponse => ({
  statusCode,
  headers,
  body: (async function* () { yield Buffer.from(body); })(),
});

function harness(routes: Record<string, TransportResponse | Error | (() => Promise<TransportResponse>)>, dns = ['93.184.216.34']) {
  const requests: Array<{ url: string; address: string; family: 4 | 6 }> = [];
  const deps: SafeFetchDependencies = {
    resolve: async () => dns.map(address => ({address, family: address.includes(':') ? 6 as const : 4 as const})),
    request: async input => {
      requests.push({url: input.url.toString(), address: input.address, family: input.family});
      const value = routes[input.url.toString()];
      if (value instanceof Error) throw value;
      if (typeof value === 'function') return value();
      if (!value) throw new Error(`Unexpected request: ${input.url}`);
      return value;
    },
    now: () => Date.now(),
  };
  const injectedFetch = createSafeFetch(deps);
  return {fetch: (url: string, options: Parameters<typeof injectedFetch>[1] = {}) => injectedFetch(url, {allowedHosts: ['example.com'], ...options}), requests};
}

test('recognizes only globally routable IP addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('93.184.216.34'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('validates URL syntax and fetch policy', () => {
  assert.equal(validateUrl('https://example.com/a').hostname, 'example.com');
  for (const url of ['ftp://example.com', 'https://user:pass@example.com', 'https://localhost', 'https://example.com:8443', `https://example.com/${'a'.repeat(2049)}`, 'https://linkedin.com/company/x', 'https://sub.instagram.com/x']) {
    assert.throws(() => validateUrl(url), undefined, url);
  }
});

test('safeFetch requires an explicit nonempty host allowlist', async () => {
  const fetch = createSafeFetch({resolve: async () => [], request: async () => response(200), now: Date.now});
  await assert.rejects(fetch('https://example.com'), /allowed hosts/i);
  await assert.rejects(fetch('https://example.com', {allowedHosts: []}), /allowed hosts/i);
});

test('fetches robots first, pins the validated address, and returns HTML', async () => {
  const {fetch, requests} = harness({
    'https://example.com/robots.txt': response(404, '', {'content-type': 'text/plain'}),
    'https://example.com/page': response(200, '<h1>Hello</h1>', {'content-type': 'text/html; charset=utf-8'}),
  });
  const result = await fetch('https://example.com/page', {allowedHosts: ['example.com']});
  assert.deepEqual(result, {url: 'https://example.com/page', html: '<h1>Hello</h1>', contentType: 'text/html; charset=utf-8'});
  assert.deepEqual(requests.map(r => [r.url, r.address]), [['https://example.com/robots.txt', '93.184.216.34'], ['https://example.com/page', '93.184.216.34']]);
});

test('rejects a hostname if any DNS answer is non-public', async () => {
  const {fetch, requests} = harness({}, ['93.184.216.34', '127.0.0.1']);
  await assert.rejects(fetch('https://example.com', {respectRobots: false}), /non-public/i);
  assert.equal(requests.length, 0);
});

test('revalidates redirects and rejects private redirect destinations', async () => {
  const {fetch} = harness({'https://example.com/': response(302, '', {location: 'http://127.0.0.1/admin'})});
  await assert.rejects(fetch('https://example.com', {respectRobots: false}), /non-public|IP address/i);
});

test('applies allowedHosts to every redirect', async () => {
  const {fetch} = harness({'https://example.com/': response(302, '', {location: 'https://other.example/'})});
  await assert.rejects(fetch('https://example.com', {respectRobots: false, allowedHosts: ['example.com']}), /allowed/i);
});

test('enforces the response byte limit while consuming the body', async () => {
  const {fetch} = harness({'https://example.com/': response(200, 'abcdef', {'content-type': 'text/html'})});
  await assert.rejects(fetch('https://example.com', {respectRobots: false, maxBytes: 5}), /large/i);
});

test('rejects non-HTML content', async () => {
  const {fetch} = harness({'https://example.com/': response(200, '{}', {'content-type': 'application/json'})});
  await assert.rejects(fetch('https://example.com', {respectRobots: false}), /content type/i);
});

test('robots disallow denies the content request', async () => {
  const {fetch, requests} = harness({'https://example.com/robots.txt': response(200, 'User-agent: ProspectOS\nDisallow: /private', {'content-type': 'text/plain'})});
  await assert.rejects(fetch('https://example.com/private'), /robots/i);
  assert.equal(requests.length, 1);
});

test('robots fetch errors fail closed', async () => {
  const {fetch} = harness({'https://example.com/robots.txt': new Error('network down')});
  await assert.rejects(fetch('https://example.com/'), /robots/i);
});

test('uses one total deadline for robots and content', async () => {
  let clock = 0;
  let signal: AbortSignal | undefined;
  let destroyed = 0;
  const trackedResponse = (statusCode: number, bodyText = '', headers: Record<string, string> = {}): TransportResponse => ({
    statusCode,
    headers,
    body: Object.assign((async function* () { yield Buffer.from(bodyText); })(), {destroy: () => { destroyed++; }}),
  });
  const deps: SafeFetchDependencies = {
    resolve: async () => [{address: '93.184.216.34', family: 4}],
    request: async input => { signal = input.signal; clock += 60; return input.url.pathname === '/robots.txt' ? trackedResponse(404) : trackedResponse(200, '<p>x</p>', {'content-type': 'text/html'}); },
    now: () => clock,
  };
  await assert.rejects(createSafeFetch(deps)('https://example.com/', {allowedHosts: ['example.com'], timeoutMs: 100}), /timed out/i);
  assert.equal(signal?.aborted, true);
  assert.equal(destroyed, 2);
});

test('actively times out a resolver that never settles', async () => {
  const deps: SafeFetchDependencies = {
    resolve: async () => new Promise(() => {}),
    request: async () => response(200, '<p>x</p>', {'content-type': 'text/html'}),
    now: () => Date.now(),
  };
  await assert.rejects(createSafeFetch(deps)('https://example.com/', {allowedHosts: ['example.com'], respectRobots: false, timeoutMs: 20}), /timed out/i);
});

test('shared deadline aborts and destroys a trickling response body', async () => {
  let signal: AbortSignal | undefined;
  let destroyed = false;
  const body = Object.assign((async function* () {
    while (!destroyed) { yield Buffer.from('x'); await new Promise(resolve => setTimeout(resolve, 5)); }
  })(), {destroy: () => { destroyed = true; }});
  const fetch = createSafeFetch({
    resolve: async () => [{address: '93.184.216.34', family: 4}],
    request: async input => { signal = input.signal; return {statusCode: 200, headers: {'content-type': 'text/html'}, body}; },
    now: Date.now,
  });
  await assert.rejects(fetch('https://example.com/', {allowedHosts: ['example.com'], respectRobots: false, timeoutMs: 20}), /timed out|abort/i);
  assert.equal(signal?.aborted, true);
  assert.equal(destroyed, true);
});

test('destroys bodies discarded for redirects, robots 404, and invalid content', async () => {
  let destroyed = 0;
  const discarded = (statusCode: number, headers: Record<string, string> = {}): TransportResponse => ({
    statusCode, headers,
    body: Object.assign((async function* () { yield Buffer.from('unused'); })(), {destroy: () => { destroyed++; }}),
  });
  const {fetch} = harness({
    'https://example.com/robots.txt': discarded(404),
    'https://example.com/': discarded(302, {location: '/bad'}),
    'https://example.com/bad': discarded(200, {'content-type': 'application/json'}),
  });
  await assert.rejects(fetch('https://example.com/'), /content type/i);
  assert.equal(destroyed, 4);
});

test('native request pins a scalar lookup address on Node without Internet', async () => {
  const server = http.createServer((_request, reply) => reply.end('ok'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const result = await nativeRequest({url: new URL(`http://pinned.invalid:${address.port}/`), address: '127.0.0.1', family: 4, timeoutMs: 500, signal: new AbortController().signal});
    assert.equal(await (async () => { let text = ''; for await (const chunk of result.body) text += Buffer.from(chunk).toString(); return text; })(), 'ok');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('checks robots again before following a content redirect', async () => {
  const {fetch, requests} = harness({
    'https://example.com/robots.txt': response(404),
    'https://example.com/': response(302, '', {location: 'https://other.example/private'}),
    'https://other.example/robots.txt': response(200, 'User-agent: *\nDisallow: /private', {'content-type': 'text/plain'}),
  });
  await assert.rejects(fetch('https://example.com/', {allowedHosts: ['example.com', 'other.example']}), /robots/i);
  assert.deepEqual(requests.map(request => request.url), ['https://example.com/robots.txt', 'https://example.com/', 'https://other.example/robots.txt']);
});

test('limits redirect count', async () => {
  const {fetch} = harness({
    'https://example.com/': response(302, '', {location: '/one'}),
    'https://example.com/one': response(302, '', {location: '/two'}),
  });
  await assert.rejects(fetch('https://example.com/', {respectRobots: false, maxRedirects: 1}), /redirect/i);
});
