import type {SupabaseClient} from '@supabase/supabase-js';
import {encryptSecret,decryptSecret,last4} from './crypto';
import {createAdminClient} from './admin-client';
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

// Routing skeleton for section 12 of the brief: NOT wired into BraveProvider/analyzeOffer in this
// bloc (no BYOK provider is actually activated yet — see the delivery report). Reads the raw encrypted
// row directly, which requires the admin/service-role client: provider_credentials has zero grants and
// zero RLS policies for any client role (migration 009) — not even the organization's own members can
// SELECT it directly, only through list_provider_credentials' redacted summary. Decrypts in memory,
// immediately before the value would be handed to a provider call — never cached, never logged.
export async function resolveProviderCredential(organizationId:string,provider:ByokProvider):Promise<string|null> {
 const admin=createAdminClient();
 const {data,error}=await admin.from('provider_credentials').select('encrypted_secret,iv,auth_tag').eq('organization_id',organizationId).eq('provider',provider).maybeSingle();
 if(error||!data)return null;
 return decryptSecret({ciphertext:fromBytea(data.encrypted_secret),iv:fromBytea(data.iv),authTag:fromBytea(data.auth_tag)});
}
