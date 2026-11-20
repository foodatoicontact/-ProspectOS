// The style sheet of the delivered lists (the PDFs already sent), unchanged. One source for the two places that must look
// alike: the generator writes it as is into the document (commercial/livraison.ts imports it from here), the follow-up space applies it inside
// its own block (scopedLivraisonCss). Change it here only: both follow.
export const LIVRAISON_CSS=`@page{size:A4;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#f6f7fb}
body{font-family:"Inter",-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#141826;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-size:9.6pt;line-height:1.45}
a{text-decoration:none;color:inherit}
.page{width:210mm;min-height:297mm;padding:16mm 15mm;position:relative;page-break-after:always;overflow:hidden}
.cover{background:#0b0f24;color:#eef0ff;display:flex;flex-direction:column;justify-content:space-between}
.glow{position:absolute;inset:-30% -20% auto auto;width:150mm;height:150mm;border-radius:50%;background:radial-gradient(circle,#6d5cf5 0%,rgba(109,92,245,.35) 35%,rgba(11,15,36,0) 70%);filter:blur(4px)}
.glow:after{content:"";position:absolute;left:-90mm;top:140mm;width:120mm;height:120mm;border-radius:50%;background:radial-gradient(circle,rgba(229,83,75,.45),rgba(11,15,36,0) 65%)}
.cv-top,.cv-mid,.cv-bot{position:relative;z-index:1}
.cv-top{display:flex;justify-content:space-between;align-items:center}
.logo{font-weight:800;font-size:14pt;letter-spacing:-.2px}.logo span{display:inline-block;background:linear-gradient(135deg,#7c6cff,#5b5bd6);color:#fff;border-radius:8px;padding:2px 9px;margin-right:8px}
.logo.s{font-size:11pt;color:#5b5bd6}
.for{font-size:9.5pt;color:#b9bedb}.for b{color:#fff}
.eyebrow{display:inline-block;font-size:8.5pt;letter-spacing:1.4px;text-transform:uppercase;color:#c7c2ff;border:1px solid rgba(199,194,255,.35);border-radius:999px;padding:4px 12px;margin-bottom:14px}
h1{font-size:40pt;line-height:1.02;letter-spacing:-1.5px;font-weight:800}
h1 em{font-style:normal;color:#ff7a59}
.lead{max-width:150mm;margin-top:14px;font-size:11pt;color:#c9cde6;line-height:1.5}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:20px}
.kpis div{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px 12px}
.kpis b{display:block;font-size:20pt;letter-spacing:-.5px}.kpis span{font-size:8.5pt;color:#aab0d0}
.cv-bot{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px 14px}
.lbl{font-size:8pt;text-transform:uppercase;letter-spacing:1.2px;color:#9aa1c4;margin-bottom:6px}
.toc{display:flex;align-items:center;gap:10px;padding:8px 6px;border-top:1px solid rgba(255,255,255,.08)}
.toc:first-of-type{border-top:0}
.dot{width:10px;height:10px;border-radius:50%;flex:none}
.tt{flex:1;font-weight:700;font-size:10.5pt}.tt small{display:block;font-weight:400;color:#a7adcc;font-size:8.5pt}
.n{font-weight:800;font-size:13pt;color:#fff}
.light{background:#f6f7fb}
.page.light{background:#f6f7fb}
.ph{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.back{font-size:8.5pt;color:#5b5bd6;font-weight:600}
h2.big{font-size:22pt;letter-spacing:-.6px;margin-bottom:12px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.panel{background:#fff;border:1px solid #e4e7f0;border-radius:14px;padding:12px 14px}
.pt{font-weight:700;font-size:10pt;margin-bottom:8px}
.bar{display:grid;grid-template-columns:42mm 1fr 8mm;align-items:center;gap:6px;margin:5px 0;font-size:8.8pt}
.bt{height:9px;background:#eef0f7;border-radius:6px;overflow:hidden}.bf{height:100%;background:linear-gradient(90deg,#7c6cff,#5b5bd6);border-radius:6px}
.bv{font-weight:800;text-align:right}
.note{font-size:8pt;color:#6b7186;margin-top:6px}
.sig{border-left:4px solid var(--c);padding:5px 0 5px 10px;margin:6px 0}.sig b{display:block;font-size:9.6pt}.sig span{font-size:8.8pt;color:#525870}
.pt2{font-weight:800;font-size:12pt;margin:16px 0 8px}
.tops{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.top{background:#0b0f24;color:#fff;border-radius:14px;padding:12px;display:block}
.tn{font-weight:800;font-size:10.5pt}.tv{font-size:8.5pt;color:#b8bde0;margin:2px 0 6px}.tw{font-size:8.8pt;color:#e7e9ff}
.how{margin-top:14px;background:#fff;border:1px dashed #c9cde0;border-radius:12px;padding:10px 12px;font-size:8.8pt;color:#3c4158}
.k2{display:inline-block;background:#eef0ff;color:#4b4bc4;font-weight:700;border-radius:5px;padding:0 5px;margin:0 2px}
.sec{padding:14mm 15mm 6mm;page-break-before:always}
.sh{background:#0b0f24;color:#fff;border-radius:16px;padding:14px 16px;position:relative;margin-bottom:10px;border-left:6px solid var(--c)}
.sh h2{font-size:17pt;letter-spacing:-.4px}.sh p{font-size:8.8pt;color:#b8bde0;margin-top:2px}
.sn{display:inline-block;font-size:8pt;font-weight:700;background:var(--c);color:#0b0f24;border-radius:999px;padding:2px 9px;margin-bottom:6px}
.sh .back{position:absolute;right:16px;top:14px;color:#c7c2ff}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.card{background:#fff;border:1px solid #e4e7f0;border-radius:14px;padding:11px 12px;page-break-inside:avoid;break-inside:avoid;display:flex;flex-direction:column;gap:6px}
.ch{display:flex;justify-content:space-between;gap:8px}
.nm{font-weight:800;font-size:10.5pt;letter-spacing:-.1px}
.meta{margin-top:3px}
.chip{display:inline-block;font-size:7.6pt;background:#eef0ff;color:#4b4bc4;border-radius:5px;padding:1px 6px;margin:0 3px 2px 0;font-weight:600}
.chip.ghost{background:#f2f3f7;color:#525870;font-weight:500}
.dt{text-align:right;flex:none}.dt span{display:block;font-size:7.4pt;color:#7a8096;text-transform:uppercase;letter-spacing:.6px}.dt b{font-size:8.8pt;white-space:nowrap}
.k{display:block;font-size:7.2pt;text-transform:uppercase;letter-spacing:.8px;color:#8a90a6;font-weight:700;margin-bottom:1px}
.fact,.why{font-size:8.8pt;color:#262b3d}.why{color:#4a5068}
.hook{font-size:8.8pt;background:#f5f4ff;border-radius:9px;padding:6px 8px;color:#2a2a6e;font-style:italic}.hook .k{font-style:normal;color:#6d5cf5}
.src{align-self:flex-start;font-size:8.2pt;font-weight:700;color:#fff;background:#5b5bd6;border-radius:999px;padding:3px 10px;margin-top:auto}
.meth{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.meth div{background:#fff;border:1px solid #e4e7f0;border-radius:14px;padding:12px}.meth b{display:block;font-size:10.5pt;margin-bottom:4px}.meth span{font-size:8.8pt;color:#4a5068}
.rules{margin-top:10px;background:#fff;border:1px solid #e4e7f0;border-radius:14px;padding:12px 14px}.rules ul{padding-left:16px;font-size:9pt;color:#3c4158}.rules li{margin:3px 0}
.cta{margin-top:14px;background:linear-gradient(120deg,#0b0f24,#2a2470);color:#fff;border-radius:16px;padding:16px 18px;display:flex;justify-content:space-between;align-items:center;gap:10px}
.ct{font-size:14pt;font-weight:800;letter-spacing:-.3px}.cs{font-size:9pt;color:#c9cde6;margin-top:3px}
.cta a{background:#fff;color:#0b0f24;font-weight:800;border-radius:999px;padding:8px 16px;white-space:nowrap}
.legal{margin-top:12px;font-size:7.8pt;color:#7a8096}

.meth-page{page-break-before:always;min-height:auto}
.sec{break-after:page}
`;
// The same rules, confined to `scope` for the application: the page-level selectors (html, body, *) become the block
// itself, every other selector is prefixed; the print-only rules (@page, page breaks, A4 page sizes) are left out.
export function scopedLivraisonCss(scope:string):string{
 const out:string[]=[];
 for(const m of LIVRAISON_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
  const sel=m[1]!.trim(),body=m[2]!.trim();
  if(sel.startsWith('@')||/page-break|break-after|break-before/.test(body)&&!/[a-z]-?color|background|border|font|padding|margin|display/.test(body.replace(/page-break[^;]*;?|break-(?:after|before|inside)[^;]*;?/g,'')))continue;
  const scoped=sel.split(',').map(x=>x.trim()).filter(x=>x!=='html').map(x=>x==='*'?`${scope} *`:x==='body'?scope:/^\.page\b|^\.sec\b/.test(x)?null:`${scope} ${x}`).filter(Boolean);
  if(scoped.length)out.push(`${scoped.join(',')}{${body.replace(/page-break-[a-z]+:[^;]+;?|break-(?:after|before|inside):[^;]+;?/g,'')}}`);
 }
 return out.join('\n');
}
