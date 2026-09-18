import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import JSZip from 'jszip';

// Everything here reads through the caller's OWN authenticated client (the same one built by
// authenticatedDb from their Bearer token), never a privileged one — RLS alone decides what comes
// back, so the tenant boundary can never be bypassed by this export regardless of what it asks for.
export async function buildAccountExportZip(db:SupabaseClient,user:{id:string;email?:string}):Promise<Uint8Array>{
 const memberships=await select(db,'memberships','organization_id,role,created_at');
 const organizations=await select(db,'organizations','id,name,created_at');
 const projects=await select(db,'projects','*');
 const icps=await select(db,'icps','*');
 const prospects=await select(db,'prospects','*');
 const evidence=await select(db,'evidence','*');
 const channels=await select(db,'channels','*');
 const outreach=await select(db,'outreach','*');
 const events=await select(db,'events','*');
 const entitlement=await db.from('account_entitlements').select('plan,status,starts_at,expires_at').eq('user_id',user.id).maybeSingle();

 const zip=new JSZip();
 zip.file('account.json',JSON.stringify({
  email:user.email??null,
  memberships,
  entitlement:entitlement.data??null,
  exported_at:new Date().toISOString(),
 },null,1));
 zip.file('organizations.json',JSON.stringify(organizations,null,1));
 zip.file('projects.json',JSON.stringify(projects,null,1));
 zip.file('icps.json',JSON.stringify(icps,null,1));
 zip.file('prospects.json',JSON.stringify(prospects,null,1));
 zip.file('evidence.json',JSON.stringify(evidence,null,1));
 zip.file('channels.json',JSON.stringify(channels,null,1));
 zip.file('outreach.json',JSON.stringify(outreach,null,1));
 zip.file('history.json',JSON.stringify(events,null,1));
 // Explicit, honest scope statement — never silently decide that shared organizational data is
 // "yours" or hide that it's included. No secret (password hash, JWT, service key) is ever queried
 // here in the first place, so none can leak into the archive.
 zip.file('README.txt',
`ProspectOS — export de données
Généré le : ${new Date().toISOString()}

account.json : votre email, vos memberships (organisation + rôle) et votre accès (bêta ou non).
organizations.json, projects.json, icps.json, prospects.json, evidence.json, channels.json,
outreach.json, history.json : les données de la ou des organisations dont vous êtes membre,
telles que votre compte peut légitimement les consulter aujourd'hui (limité par les mêmes règles
d'accès que l'application elle-même — jamais les données d'une autre organisation).

Ces données sont partagées avec les autres membres de votre organisation : ProspectOS ne décide
pas arbitrairement qu'elles vous appartiennent personnellement à titre individuel.

Aucun mot de passe, jeton d'authentification ou clé technique Supabase n'est jamais inclus dans
cet export.
`);
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
async function select(db:SupabaseClient,table:string,columns:string){
 const {data,error}=await db.from(table).select(columns);
 if(error)throw Error('DATABASE_REQUEST_FAILED');
 return data;
}

// Server-only: never imported by client code, never reachable from the browser. Anonymizes rather
// than deletes the auth.users row — see migration 008's header comment for exactly why a literal
// DELETE FROM auth.users is impossible today (organizations.owner_id / evidence.verified_by /
// events.actor_id all reference it with no ON DELETE, and evidence.verified_by / events cannot be
// touched without weakening evidence-first or the append-only invariant). The row keeps existing so
// every one of those references stays valid; its identifying fields are scrambled and login is
// permanently disabled instead.
export async function anonymizeAuthUser(userId:string):Promise<void>{
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!serviceKey)throw Error('CONFIGURATION_REQUIRED');
 const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const anonymizedEmail=`deleted+${userId}@deleted.invalid`;
 const randomPassword=crypto.randomUUID()+crypto.randomUUID();
 const {error}=await admin.auth.admin.updateUserById(userId,{
  email:anonymizedEmail,
  password:randomPassword,
  ban_duration:'876000h', // ~100 years — effectively permanent, never re-enabled by this app
  user_metadata:{deleted:true,deleted_at:new Date().toISOString()},
 });
 if(error)throw Error('DATABASE_REQUEST_FAILED');
}
