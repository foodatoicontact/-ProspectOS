import {demoCompanies,type DemoView,type DemoCompany} from './view.ts';
// The public demo page (app/d/[token]) as one self-contained HTML document: no framework, no external request, phone
// first (it is opened from a LinkedIn message). Every value is escaped; the only links are the official source of each
// signal and ProspectOS itself. The page shows no phone number and no email — none exists in what it receives.
export const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const MONTHS=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
export function frenchDate(iso:string|null):string|null{
 const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(iso??'');if(!m)return null;
 const month=MONTHS[Number(m[2])-1];if(!month)return null;
 return `${Number(m[3])===1?'1er':Number(m[3])} ${month} ${m[1]}`;
}
const CSS=`*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:#0b0f24;color:#eef0fb;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:inherit}.wrap{max-width:720px;margin:0 auto;padding:0 16px 120px}
.by{background:#141a3a;border-bottom:1px solid #262d57;font-size:13.5px;color:#c9cdf0;padding:10px 16px;text-align:center}
.by b{color:#fff}
header{padding:28px 0 8px}.logo{display:inline-flex;align-items:center;gap:8px;font-weight:700;text-decoration:none;color:#fff}
.logo span{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:8px;background:#6d5efc;font-size:15px}
.eyebrow{margin:26px 0 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#a8adde}
h1{margin:0;font-size:30px;line-height:1.12;letter-spacing:-.02em}
.target{margin:12px 0 0;color:#c9cdf0;font-size:16px}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:22px 0 6px}
.kpi{background:#141a3a;border:1px solid #262d57;border-radius:12px;padding:12px}
.kpi b{display:block;font-size:24px;line-height:1.1}.kpi span{font-size:12.5px;color:#a8adde}
h2{font-size:15px;margin:28px 0 10px;color:#c9cdf0;font-weight:600}
.card{background:#fff;color:#12152b;border-radius:14px;padding:14px;margin:0 0 10px}
.top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.name{font-size:17px;font-weight:700;line-height:1.25;overflow-wrap:anywhere}
.new{flex:none;background:#ff7a59;color:#fff;font-size:11.5px;font-weight:700;border-radius:999px;padding:3px 9px;letter-spacing:.02em}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}
.chip{background:#eef0fb;color:#3b3fa0;border-radius:6px;padding:2px 8px;font-size:12.5px;font-weight:600}
.chip.sig{background:#e8f8ee;color:#12733a}.chip.date{background:#f1f2f6;color:#3a3f5c}
.act{margin:10px 0 0;font-size:14.5px}
.k{display:block;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#7b80a3;font-weight:700;margin-bottom:2px}
.quote{margin:10px 0 0;font-size:13.5px;color:#3a3f5c;border-left:3px solid #d9dcf0;padding-left:10px;overflow-wrap:anywhere}
.hook{margin:10px 0 0;background:#f4f2ff;border-radius:10px;padding:10px;font-size:14px;font-style:italic;color:#221d5c}
.hook .k{font-style:normal;color:#6d5efc}
.src{display:inline-flex;align-items:center;min-height:44px;margin-top:10px;padding:0 14px;border-radius:999px;background:#5b55d6;color:#fff;font-weight:600;font-size:14px;text-decoration:none}
.note{font-size:12.5px;color:#a8adde;margin:18px 0 0}
.cta{position:fixed;left:0;right:0;bottom:0;background:rgba(11,15,36,.96);border-top:1px solid #262d57;padding:10px 16px calc(10px + env(safe-area-inset-bottom))}
.cta a{display:flex;align-items:center;justify-content:center;min-height:50px;max-width:720px;margin:0 auto;border-radius:12px;background:#ff7a59;color:#fff;font-weight:700;font-size:16px;text-decoration:none;text-align:center;padding:0 12px}
.cta small{display:block;text-align:center;color:#a8adde;font-size:11.5px;margin-top:6px}
.empty{margin:40px 0;color:#c9cdf0}
.solo{max-width:520px;margin:14vh auto;padding:0 20px;text-align:center}.solo h1{font-size:24px}.solo p{color:#c9cdf0}
.solo a{display:inline-flex;align-items:center;min-height:44px;color:#fff}
@media(min-width:640px){h1{font-size:38px}.card{padding:18px}}`;
const HEAD=(title:string)=>`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#0b0f24">
<title>${esc(title)}</title><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="Une sélection d’entreprises issue de sources publiques officielles, préparée avec ProspectOS."><meta property="og:type" content="website">
<style>${CSS}</style></head>`;

function card(c:DemoCompany):string{
 const place=[c.department,c.city].filter(Boolean).join(' · ');
 const date=frenchDate(c.signalDate);
 return `<article class="card"><div class="top"><div class="name">${esc(c.name)}</div>${c.isNew?'<span class="new">Nouveau</span>':''}</div>
<div class="chips">${place?`<span class="chip">${esc(place)}</span>`:''}${c.signalLabel?`<span class="chip sig">${esc(c.signalLabel)}</span>`:''}${date?`<span class="chip date">${esc(date)}</span>`:''}</div>
${c.activity?`<p class="act"><span class="k">Activité</span>${esc(c.activity)}</p>`:''}
${c.excerpt?`<p class="quote"><span class="k">Extrait de l’annonce</span>« ${esc(c.excerpt)} »</p>`:''}
${c.hook?`<p class="hook"><span class="k">Accroche possible</span>« ${esc(c.hook)} »</p>`:''}
${c.sourceUrl?`<a class="src" href="${esc(c.sourceUrl)}" target="_blank" rel="noopener noreferrer nofollow">Voir l’annonce officielle ↗</a>`:''}</article>`;
}

// nonce: the page's only script (it keeps the token in this browser so the copy can be made after sign-up).
export function renderDemoPage(view:DemoView,o:{token:string;nonce:string;author?:string}):string{
 const author=(o.author??'').trim().slice(0,60)||'Kevin';
 const rows=demoCompanies(view);const priority=rows.filter(r=>r.priority).length;const fresh=rows.filter(r=>r.isNew).length;
 const n=rows.length;const title=`${view.project.name} · démo ProspectOS`;
 const kpis=[`<div class="kpi"><b>${n}</b><span>${n>1?'entreprises':'entreprise'}</span></div>`,
  priority?`<div class="kpi"><b>${priority}</b><span>en priorité</span></div>`:'',
  fresh?`<div class="kpi"><b>${fresh}</b><span>${fresh>1?'nouvelles':'nouvelle'}</span></div>`:''].join('');
 const first=rows.filter(r=>r.priority),rest=rows.filter(r=>!r.priority);
 const list=first.length&&rest.length
  ?`<h2>À voir en premier (${first.length})</h2>${first.map(card).join('')}<h2>Les autres (${rest.length})</h2>${rest.map(card).join('')}`
  :rows.map(card).join('');
 return `${HEAD(title)}<body>
<div class="by">Démo préparée pour vous par <b>${esc(author)}</b>, ProspectOS</div>
<div class="wrap"><header><a class="logo" href="/"><span>P.</span>ProspectOS</a>
<div class="eyebrow">Démo en lecture seule</div><h1>${esc(view.project.name)}</h1>
${view.target?`<p class="target"><span class="k">Cible</span>${esc(view.target)}</p>`:''}
<div class="kpis">${kpis}</div></header>
<main>${n?list:'<p class="empty">Cette démo ne contient pas encore d’entreprise.</p>'}
<p class="note">Chaque ligne vient d’une source publique officielle, avec son lien. Aucun numéro de téléphone ni e-mail n’est fourni : ProspectOS n’en invente pas. Les accroches sont des propositions à vérifier avant tout contact.</p></main></div>
<div class="cta"><a id="keep" href="/#inscription">Créer mon compte et garder ces résultats</a><small>Les entreprises ci-dessus seront copiées dans votre compte.</small></div>
<script nonce="${esc(o.nonce)}">document.getElementById('keep').addEventListener('click',function(){try{localStorage.setItem('prospectos-demo-claim-v1',JSON.stringify({token:${JSON.stringify(o.token)},savedAt:Date.now()}))}catch(e){}});</script>
</body></html>`;
}
// Unknown, expired and revoked links get this same page: nothing tells whether a token ever existed.
export function renderDemoUnavailable(kind:'invalid'|'busy'|'unavailable'='invalid'):string{
 const [title,text]=kind==='busy'?['Trop de demandes','Patientez un instant, puis rechargez la page.']
  :kind==='unavailable'?['Page momentanément indisponible','Réessayez dans un instant.']
  :['Lien expiré ou invalide','Ce lien de démo n’est plus disponible. Demandez-en un nouveau à la personne qui vous l’a envoyé.'];
 return `${HEAD(`${title} · ProspectOS`)}<body><div class="solo"><a class="logo" href="/"><span>P.</span>ProspectOS</a><h1>${esc(title)}</h1><p>${esc(text)}</p><p><a href="/">Découvrir ProspectOS</a></p></div></body></html>`;
}
