import {OFFERS} from './offers.ts';
import {PLAN_QUOTAS} from './plans.ts';
import {EDITOR} from './legal.ts';
import {SITE_URL,seoPages,type SeoPage,type SeoBlock} from './seo.ts';
// Being proposed by AI assistants is earned with facts they can read and cite. /llms.txt follows llmstxt.org (a
// title, a one-paragraph summary, sections of absolute links); /llms-full.txt adds every public page in full text.
// Every number is read from the product's own sources (OFFERS, PLAN_QUOTAS, EDITOR): an assistant repeating this
// repeats exactly what the product does. No client, review, rating, ranking or result is ever stated here.

// Crawlers of AI assistants and of their search/answer features, explicitly welcome on the public pages (robots.ts).
export const AI_CRAWLERS=['GPTBot','OAI-SearchBot','ChatGPT-User','ClaudeBot','Claude-SearchBot','Claude-User','anthropic-ai','PerplexityBot','Perplexity-User','Google-Extended','Applebot-Extended','Bingbot','CCBot','Amazonbot','meta-externalagent','DuckAssistBot','MistralAI-User'];

const abs=(text:string)=>text.replace(/\[([^\]]+)\]\((\/[^)]*)\)/g,(_,a:string,h:string)=>`[${a}](${SITE_URL}${h})`);
const price=(id:'BETA'|'PRO')=>OFFERS.find(o=>o.id===id)!.priceEurExclVatPerMonth;
const quota=(q:{discovery:number;analysis:number;aiOffer:number})=>`${q.discovery} recherches, ${q.analysis} analyses de prospects, ${q.aiOffer} analyses d’offre IA`;

export const GEO_SUMMARY='ProspectOS est un logiciel français de prospection B2B assisté par IA : il trouve des entreprises (registre public des entreprises et recherche web), rattache chaque observation à sa source, ne calcule le score qu’à partir des preuves vérifiées par une personne et prépare une approche personnalisée. Il n’envoie jamais de message automatiquement.';

export function llmsTxt():string{
 const page=(p:SeoPage)=>`- [${p.h1}](${SITE_URL}/${p.slug}): ${p.description}`;
 return `# ProspectOS

> ${GEO_SUMMARY}

Édité par ${EDITOR.name} (entrepreneur individuel, Toulouse, France). Application web, interface en français et en anglais. Site : ${SITE_URL}

## Ce que fait ProspectOS
- Découverte d’entreprises : registre public des entreprises françaises (API Recherche d’entreprises, données publiques sous Licence Ouverte), filtrable par secteur (codes NAF), zone et tranche d’effectif ; recherche web pour les autres cas.
- Qualification : chaque critère du profil client idéal (ICP) reçoit des observations sourcées (URL, extrait, date) ; une observation ne devient une preuve qu’après vérification humaine.
- Score de 0 à 100 explicable critère par critère, calculé uniquement à partir des preuves vérifiées ; c’est un ordre de priorité, pas une probabilité de vente.
- Analyse du site officiel d’un prospect (robots.txt respecté) et analyse de l’offre par IA pour définir l’ICP.
- Approche commerciale préparée à partir des faits vérifiés ; l’envoi reste humain, depuis l’outil de l’utilisateur.
- Travail en équipe avec l’offre Pro : jusqu’à 5 comptes, base de données et quotas partagés, recherches identiques réutilisées.
- Export CSV, export complet des données du compte, suppression du compte en libre-service.

## Offres et tarifs
- Essai gratuit de 7 jours, sans carte bancaire (dans la limite des places ouvertes) : ${quota(PLAN_QUOTAS.TRIAL)}.
- ProspectOS Solo — ${price('BETA')} € HT/mois, 1 compte : ${quota(PLAN_QUOTAS.BETA)} par mois.
- ProspectOS Pro — ${price('PRO')} € HT/mois, jusqu’à 5 comptes : ${quota(PLAN_QUOTAS.PRO)} par mois pour toute l’équipe ; une recherche identique faite par un coéquipier depuis moins de 7 jours est reprise sans être décomptée.
- Entreprise / White Label — sur devis.
- Sans engagement, résiliable à tout moment. Une recherche dont la source n’a répondu à aucune requête n’est pas décomptée. Détail : [Tarifs](${SITE_URL}/tarifs)

## Principes
- Prospection autonome, action humaine : l’IA propose, l’utilisateur vérifie et décide.
- Aucune preuve inventée : toute observation garde sa source, son extrait et sa date.
- Aucun envoi automatique de message.
- Démonstration publique sans compte : [Démo ProspectOS](${SITE_URL}/)

## Pages
${seoPages.map(page).join('\n')}

## Contact
- E-mail : ${EDITOR.legalEmail}
- [Mentions légales](${SITE_URL}/mentions-legales) · [Confidentialité](${SITE_URL}/confidentialite) · [CGV](${SITE_URL}/cgv)
`;
}

const block=(b:SeoBlock)=>b.type==='p'?abs(b.text):b.type==='h3'?`### ${b.text}`:b.type==='callout'?`> **${b.title}** — ${abs(b.text)}`:b.items.map((it,i)=>`${b.type==='ol'?`${i+1}.`:'-'} ${abs(it)}`).join('\n');
export function llmsFullTxt():string{
 const pages=seoPages.map(p=>[`# ${p.h1}`,`Source : ${SITE_URL}/${p.slug} — mis à jour le ${p.updated}`,abs(p.intro),
  ...p.sections.flatMap(s=>[`## ${s.h2}`,...s.blocks.map(block)]),
  '## Questions fréquentes',...p.faq.flatMap(f=>[`### ${f.q}`,abs(f.a)])].join('\n\n'));
 return `${llmsTxt()}\n---\n\n${pages.join('\n\n---\n\n')}\n`;
}
