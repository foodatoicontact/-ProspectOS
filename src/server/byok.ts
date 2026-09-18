import type {SupabaseClient} from '@supabase/supabase-js';
import {encryptSecret,decryptSecret,last4} from './crypto.ts';
import {createAdminClient} from './admin-client.ts';
export type ByokProvider='brave'|'anthropic'|'openai';
export interface CredentialSummary {provider:ByokProvider;key_last4:string;created_at:string;updated_at:string}
// Postgres' bytea text-input/output format is hex prefixed with `\x` — both the RPC parameter
// (implicitly cast from the JSON string PostgREST sends) and PostgREST's own JSON serialization of a
// bytea column use this exact form. A bare hex string without the prefix is not valid bytea input.
const toBytea=(buf:Buffer):string=>'\\x'+buf.toString('hex');
const fromBytea=(value:string):Buffer=>Buffer.from(value.replace(/^\\x/,''),'hex');

// Saved through the caller's OWN authenticated client (RLS + save_provider_credential's own
// require_owner check decide who may act — never trusted from anything else): the API key is encrypted
// here, in server memory, before it ever reaches SQL — only ciphertext (+ iv/authTag) crosses into the
// database. The plaintext key is never returned, logged, or stored anywhere once this call returns.
export async function saveProviderCredential(db:SupabaseClient,organizationId:string,provider:ByokProvider,apiKey:string):Promise<CredentialSummary> {
 const {ciphertext,iv,authTag}=encryptSecret(apiKey);
 const {data,error}=await db.rpc('save_provider_credential',{
  p_organization_id:organizationId,p_provider:provider,
  p_encrypted_secret:toBytea(ciphertext),p_iv:toBytea(iv),p_auth_tag:toBytea(authTag),
  p_key_last4:last4(apiKey),
 });
 if(error)throw Error('DATABASE_REQUEST_FAILED');
 return data as CredentialSummary;
}
export async function listProviderCredentials(db:SupabaseClient,organizationId:string):Promise<CredentialSummary[]> {
 const {data,error}=await db.rpc('list_provider_credentials',{p_organization_id:organizationId});
 if(error)throw Error('DATABASE_REQUEST_FAILED');
 return (data as CredentialSummary[])??[];
}
export async function deleteProviderCredential(db:SupabaseClient,organizationId:string,provider:ByokProvider):Promise<void> {
 const {error}=await db.rpc('delete_provider_credential',{p_organization_id:organizationId,p_provider:provider});
 if(error)throw Error('DATABASE_REQUEST_FAILED');
}

// Three-state resolution — deliberately NOT collapsed to string|null (4A.3.1 hardening). NONE and
// INVALID must never be confused by a caller: NONE means "no BYOK credential exists, a platform-key
// fallback is a legitimate choice"; INVALID means "one exists but cannot be trusted/used" (corrupted
// ciphertext/iv/tag, wrong BYOK_MASTER_KEY, malformed stored bytea, any other cryptographic failure) —
// silently substituting the platform key here would mean a broken BYOK setup quietly shifts cost onto
// the platform's own key, an invisible and unauthorized billing change. A caller MUST fail closed (no
// provider call at all) on INVALID, never fall back.
export type CredentialResolution={status:'NONE'}|{status:'VALID';apiKey:string}|{status:'INVALID'};

// Reads the raw encrypted row directly, which requires the admin/service-role client:
// provider_credentials has zero grants and zero RLS policies for any client role (migration 009) — not
// even the organization's own members can SELECT it directly, only through list_provider_credentials'
// redacted summary. Decrypts in memory, immediately before the value would be handed to a provider
// call — never cached, never logged. The raw crypto exception (which could vary by failure mode but
// never contains the plaintext key, ciphertext, iv or tag in its message) is deliberately swallowed
// here and never returned/rethrown with its original detail — only the fact that it failed.
export async function resolveProviderCredential(organizationId:string,provider:ByokProvider):Promise<CredentialResolution> {
 const admin=createAdminClient();
 const {data,error}=await admin.from('provider_credentials').select('encrypted_secret,iv,auth_tag').eq('organization_id',organizationId).eq('provider',provider).maybeSingle();
 if(error||!data)return {status:'NONE'};
 try {
  const apiKey=decryptSecret({ciphertext:fromBytea(data.encrypted_secret),iv:fromBytea(data.iv),authTag:fromBytea(data.auth_tag)});
  return {status:'VALID',apiKey};
 } catch {
  return {status:'INVALID'};
 }
}
