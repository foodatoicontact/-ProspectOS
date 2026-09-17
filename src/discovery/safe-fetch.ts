import http from 'node:http';
import https from 'node:https';
import {lookup as dnsLookup} from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import robotsParser from 'robots-parser';

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  allowedHosts?: string[];
  respectRobots?: boolean;
}

export interface TransportResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
}

export interface TransportInput {
  url: URL;
  address: string;
  family: 4 | 6;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface SafeFetchDependencies {
  resolve(hostname: string): Promise<Array<{address: string; family: 4 | 6}>>;
  request(input: TransportInput): Promise<TransportResponse>;
  now(): number;
}

const USER_AGENT = 'ProspectOS/1.0';
const SOCIAL_HOSTS = ['linkedin.com', 'instagram.com', 'facebook.com', 'tiktok.com', 'snapchat.com'];
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;

function hostMatches(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const suffix = domain.toLowerCase().replace(/\.$/, '');
  return host === suffix || host.endsWith(`.${suffix}`);
}

export function isPublicAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && parsed.range() === 'ipv4Mapped') parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

export function validateUrl(rawUrl: string, allowedHosts?: string[]): URL {
  if (rawUrl.length > 2048) throw new Error('URL exceeds 2048 characters');
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error('Invalid URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only HTTP(S) URLs are allowed');
  if (url.username || url.password) throw new Error('URL credentials are forbidden');
  if (url.port && !((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443'))) throw new Error('Non-standard ports are forbidden');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) throw new Error('Localhost is forbidden');
  if (SOCIAL_HOSTS.some(domain => hostMatches(hostname, domain))) throw new Error('Authenticated/social network fetching is forbidden');
  if (ipaddr.isValid(hostname) && !isPublicAddress(hostname)) throw new Error('Non-public IP address is forbidden');
  if (allowedHosts !== undefined && !allowedHosts.some(host => hostMatches(hostname, host))) throw new Error(`Host ${hostname} is not in the allowed hosts`);
  return url;
}

function header(response: TransportResponse, name: string): string | undefined {
  const value = response.headers[name] ?? response.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readBody(response: TransportResponse, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error('Response is too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function destroyBody(response: TransportResponse, error?: Error): void {
  const body = response.body as AsyncIterable<Uint8Array> & {destroy?: (error?: Error) => void};
  body.destroy?.(error);
}

export function nativeRequest(input: TransportInput): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const client = input.url.protocol === 'https:' ? https : http;
    const requestOptions: http.RequestOptions & {autoSelectFamily?: boolean} = {
      method: 'GET',
      headers: {accept: 'text/html,application/xhtml+xml,text/plain;q=0.5', 'user-agent': USER_AGENT},
      lookup: (_hostname, _options, callback) => callback(null, input.address, input.family),
      autoSelectFamily: false,
      agent: false,
      signal: input.signal,
    };
    const request = client.request(input.url, requestOptions, response => resolve({statusCode: response.statusCode ?? 0, headers: response.headers, body: response}));
    request.setTimeout(input.timeoutMs, () => request.destroy(new Error('Request timed out')));
    request.once('error', reject);
    request.end();
  });
}

const productionDependencies: SafeFetchDependencies = {
  resolve: async hostname => {
    const answers = await dnsLookup(hostname, {all: true, verbatim: true});
    return answers.map(answer => ({address: answer.address, family: answer.family as 4 | 6}));
  },
  request: nativeRequest,
  now: Date.now,
};

export function createSafeFetch(dependencies: SafeFetchDependencies) {
  return async function safeFetchWithDependencies(rawUrl: string, options: SafeFetchOptions = {}): Promise<{url: string; html: string; contentType: string}> {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('maxBytes must be a positive integer');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be a positive integer');
    if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) throw new Error('maxRedirects must be a non-negative integer');
    if (!options.allowedHosts?.length) throw new Error('A nonempty allowed hosts list is required');
    const deadline = dependencies.now() + timeoutMs;
    const abortController = new AbortController();
    const deadlineTimer = setTimeout(() => abortController.abort(new Error('Safe fetch timed out')), timeoutMs);

    const remaining = () => {
      const value = deadline - dependencies.now();
      if (value <= 0) {
        const error = new Error('Safe fetch timed out');
        abortController.abort(error);
        throw error;
      }
      return value;
    };

    const beforeDeadline = async <T>(operation: Promise<T>): Promise<T> => {
      remaining();
      let abort: (() => void) | undefined;
      try {
        return await Promise.race([
          operation,
          new Promise<T>((_resolve, reject) => {
            abort = () => reject(abortController.signal.reason ?? new Error('Safe fetch timed out'));
            if (abortController.signal.aborted) abort();
            else abortController.signal.addEventListener('abort', abort, {once: true});
          }),
        ]);
      } finally {
        if (abort) abortController.signal.removeEventListener('abort', abort);
      }
    };

    const requestOnce = async (url: URL) => {
      remaining();
      const answers = await beforeDeadline(dependencies.resolve(url.hostname.replace(/^\[|\]$/g, '')));
      remaining();
      if (!answers.length) throw new Error('DNS returned no addresses');
      if (answers.some(answer => !isPublicAddress(answer.address))) throw new Error('DNS returned a non-public address');
      const selected = answers[0]!;
      const family = ipaddr.parse(selected.address).kind() === 'ipv4' ? 4 : 6;
      const response = await beforeDeadline(dependencies.request({url, address: selected.address, family, timeoutMs: remaining(), signal: abortController.signal}));
      abortController.signal.addEventListener('abort', () => destroyBody(response, new Error('Safe fetch timed out')), {once: true});
      remaining();
      return response;
    };

    const fetchFollowingRedirects = async (initial: URL, expected: 'html' | 'robots', beforeRequest?: (url: URL) => Promise<void>) => {
      let current = initial;
      for (let redirects = 0; ; redirects++) {
        await beforeRequest?.(current);
        const response = await requestOnce(current);
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          destroyBody(response);
          if (redirects >= maxRedirects) throw new Error('Maximum redirects exceeded');
          const location = header(response, 'location');
          if (!location) throw new Error('Redirect response has no location');
          current = validateUrl(new URL(location, current).toString(), options.allowedHosts);
          continue;
        }
        if (expected === 'robots' && response.statusCode === 404) {
          destroyBody(response);
          return {url: current, response, body: ''};
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          destroyBody(response);
          throw new Error(`HTTP status ${response.statusCode}`);
        }
        const contentType = (header(response, 'content-type') ?? '').toLowerCase();
        if (expected === 'html' && !/^(text\/html|application\/xhtml\+xml)(?:;|$)/.test(contentType)) {
          destroyBody(response);
          throw new Error(`Unsupported content type: ${contentType || 'missing'}`);
        }
        if (expected === 'robots' && !/^text\/plain(?:;|$)/.test(contentType)) {
          destroyBody(response);
          throw new Error(`Unsupported robots content type: ${contentType || 'missing'}`);
        }
        try {
          return {url: current, response, body: await beforeDeadline(readBody(response, maxBytes))};
        } catch (error) {
          destroyBody(response, error instanceof Error ? error : undefined);
          throw error;
        }
      }
    };

    const checkRobots = async (target: URL) => {
      try {
        const robotsUrl = new URL('/robots.txt', target);
        const robots = await fetchFollowingRedirects(robotsUrl, 'robots');
        if (robots.response.statusCode !== 404 && robotsParser(robots.url.toString(), robots.body).isAllowed(target.toString(), USER_AGENT) !== true) throw new Error('Blocked by robots.txt');
      } catch (error) {
        if (error instanceof Error && /robots\.txt$|Blocked by robots/.test(error.message)) throw error;
        throw new Error(`Robots check failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    try {
      const target = validateUrl(rawUrl, options.allowedHosts);
      const result = await fetchFollowingRedirects(target, 'html', options.respectRobots === false ? undefined : checkRobots);
      return {url: result.url.toString(), html: result.body, contentType: header(result.response, 'content-type') ?? ''};
    } finally {
      clearTimeout(deadlineTimer);
    }
  };
}

export const safeFetch = createSafeFetch(productionDependencies);
