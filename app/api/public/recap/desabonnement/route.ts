import {createAdminClient} from '../../../../../src/server/admin-client';
import {digestSecret,verifyUnsubscribe,UNSUBSCRIBE_PATH} from '../../../../../src/digest/morning';
// One-click unsubscribe from the morning recap (migration 040). The link carries the user id and an HMAC of it
// (MORNING_DIGEST_SECRET): nobody can unsubscribe someone else, and no login is needed.
//  - GET shows a confirmation page with one button: a link scanner that opens the URL never unsubscribes anyone;
//  - POST unsubscribes — from that button, or from the mail client's own one-click button (RFC 8058, List-Unsubscribe-Post).
// A wrong or expired link only says so; nothing tells whether an account exists.
export const dynamic='force-dynamic';
export const runtime='nodejs';
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function page(title:string,body:string,status=200){
 return new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · ProspectOS</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#14171f}main{max-width:520px;margin:12vh auto;padding:24px 16px}h1{font-size:22px}button{min-height:48px;padding:0 20px;border:0;border-radius:10px;background:#1f4ed8;color:#fff;font:inherit;font-weight:600;cursor:pointer}a{color:#1f4ed8}@media (prefers-color-scheme:dark){body{background:#0f1115;color:#e8eaf0}a{color:#8fb0ff}}</style></head>
<body><main><h1>${esc(title)}</h1>${body}<p><a href="/">ProspectOS</a></p></main></body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex'}});
}
const invalid=()=>page('Lien invalide','<p>Ce lien de désinscription n’est pas valide. Vous pouvez aussi désactiver le récap dans ProspectOS, écran « Aujourd’hui », ou écrire à contact@prospectos.fr.</p>',400);

export async function GET(request:Request){
 const url=new URL(request.url);
 const user=verifyUnsubscribe(digestSecret(process.env),url.searchParams.get('u'),url.searchParams.get('t'));
 if(!user)return invalid();
 return page('Ne plus recevoir le récap du matin ?',`<p>Vous ne recevrez plus l’email quotidien de ProspectOS. Vous pourrez le réactiver à tout moment depuis l’écran « Aujourd’hui ».</p>
<form method="post" action="${esc(`${UNSUBSCRIBE_PATH}?u=${encodeURIComponent(user)}&t=${encodeURIComponent(url.searchParams.get('t')!)}`)}"><button type="submit">Me désinscrire</button></form>`);
}

export async function POST(request:Request){
 const url=new URL(request.url);
 const user=verifyUnsubscribe(digestSecret(process.env),url.searchParams.get('u'),url.searchParams.get('t'));
 if(!user)return invalid();
 let admin;try{admin=createAdminClient()}catch{return page('Désinscription momentanément indisponible','<p>Réessayez dans un instant, ou écrivez à contact@prospectos.fr.</p>',503)}
 const {error}=await admin.rpc('unsubscribe_morning_digest',{p_user:user});
 if(error)return page('Désinscription momentanément indisponible','<p>Réessayez dans un instant, ou écrivez à contact@prospectos.fr.</p>',503);
 return page('C’est fait','<p>Vous ne recevrez plus le récap du matin. Vous pouvez le réactiver à tout moment depuis l’écran « Aujourd’hui ».</p>');
}
