import {createHash,randomBytes} from 'node:crypto';
// ProspectOS Pro team (migration 022), server side. The invitation token is drawn here — 256 random bits,
// URL-safe — and only its SHA-256 is sent to the database; the raw token exists in the link the owner hands to the
// invited person, nowhere else. Every rule (owner, active team plan, 5 seats, confirmed matching e-mail, single use,
// 7 days) is enforced by the database; this module only maps its refusals to stable codes and clear messages.
export const newInviteToken=():string=>randomBytes(32).toString('base64url');
export const isInviteToken=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
export const inviteTokenHash=(token:string):string=>createHash('sha256').update(token).digest('hex');
// The link is built on the address the owner is using (same deployment: production or its preview).
export function inviteLink(request:Request,token:string):string{
 const url=new URL('/',new URL(request.url).origin);url.searchParams.set('invite',token);return url.toString();
}
// database refusal → [stable code, French message (the API's language), HTTP status]
export const TEAM_ERRORS={
 team_plan_required:['TEAM_PLAN_REQUIRED','Inviter des coéquipiers nécessite l’offre ProspectOS Pro active.',403],
 team_owner_required:['TEAM_OWNER_REQUIRED','Seul le propriétaire de l’équipe peut gérer ses membres.',403],
 team_full:['TEAM_FULL','L’équipe compte déjà 5 comptes (invitations en attente comprises).',409],
 already_member:['TEAM_ALREADY_MEMBER','Ce compte fait déjà partie de l’équipe.',409],
 already_in_team:['TEAM_ALREADY_IN_TEAM','Votre compte fait déjà partie d’une autre équipe. Quittez-la avant d’en rejoindre une nouvelle.',409],
 invitation_invalid:['TEAM_INVITATION_INVALID','Ce lien d’invitation n’est plus valable (utilisé, retiré ou expiré). Demandez-en un nouveau.',410],
 invitation_email_mismatch:['TEAM_INVITATION_EMAIL_MISMATCH','Cette invitation a été envoyée à une autre adresse e-mail. Connectez-vous avec l’adresse invitée.',403],
 email_not_confirmed:['TEAM_EMAIL_NOT_CONFIRMED','Confirmez d’abord votre adresse e-mail, puis rouvrez le lien d’invitation.',403],
 team_unavailable:['TEAM_UNAVAILABLE','L’équipe n’est plus active : l’offre Pro de son propriétaire est terminée.',409],
 team_member_required:['TEAM_MEMBER_REQUIRED','Ce compte n’est pas membre de l’équipe.',404],
} as const satisfies Record<string,readonly [string,string,number]>;
export function teamError(error:unknown):{error:string;code:string;status:number}|null{
 const text=error instanceof Error?error.message:String((error as {message?:unknown})?.message??'');
 for(const [db,[code,message,status]] of Object.entries(TEAM_ERRORS))if(new RegExp(`\\b${db}\\b`).test(text))return {error:message,code,status};
 return null;
}
