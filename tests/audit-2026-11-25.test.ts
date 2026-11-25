// External audit of 25 nov. 2026 — compliance fixes: self-hosted fonts (no call to Google Fonts from the visitor's
// browser), site icons, the VAT wording of the mentions légales, and the Stripe transfer text kept behind a constant
// until the owner has checked Stripe's DPA. The i18n files are not touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {EDITOR,TRANSFERS,STRIPE_SCC_CONFIRMED,STRIPE_TRANSFER_SCC} from '../src/domain/legal.ts';
const root=new URL('../',import.meta.url);
const read=(p:string)=>readFileSync(new URL(p,root),'utf8');
function files(dir:string,out:string[]=[]):string[]{
 for(const f of readdirSync(new URL(dir,root))){const p=`${dir}/${f}`;if(['node_modules','.next','.git'].includes(f))continue;
  if(statSync(new URL(p,root)).isDirectory())files(p,out);else if(/\.(ts|tsx|css|mjs|js|json|html)$/.test(f))out.push(p)}
 return out;
}
test('fonts: no reference to fonts.googleapis.com or fonts.gstatic.com anywhere in the site code',()=>{
 const hits=[...files('app'),...files('src'),...files('commercial'),'next.config.ts'].filter(f=>/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(read(f)));
 assert.deepEqual(hits,[]);
});
test('fonts: DM Sans, Manrope and Inter through next/font/google, exposed as CSS variables on :root by the root layout',()=>{
 const f=read('src/fonts.ts');
 assert.match(f,/import \{DM_Sans,Manrope,Inter\} from 'next\/font\/google';/);
 for(const v of ['--font-dm-sans','--font-manrope','--font-inter'])assert.ok(f.includes(`variable:'${v}'`),v);
 assert.match(f,/preload:false/,'Inter (veille dédiée only) is declared but never preloaded on every page');
 const layout=read('app/layout.tsx');
 assert.match(layout,/return <html lang="fr"><body>\n    <style dangerouslySetInnerHTML=\{\{__html:FONT_VARIABLES_CSS\}\}\/>/);
 const css=read('app/globals.css');
 assert.doesNotMatch(css,/@import/);
 assert.doesNotMatch(css.replace(/var\(--font-(dm-sans|manrope),'(DM Sans|Manrope)'\)/g,''),/'DM Sans'|'Manrope'/,'every use goes through the variable, the old name as fallback');
 assert.match(read('src/dedicated/livraison-style.ts'),/font-family:var\(--font-inter,"Inter"\)/);
 assert.doesNotMatch(read('src/ui/v2/dedicated/DeliveryView.tsx'),/<link /);
});
test('icons: app/icon.png (512 px), app/apple-icon.png (180 px) and app/favicon.ico from the « P » logo',()=>{
 const size=(p:string)=>{const b=readFileSync(new URL(p,root));assert.equal(b.subarray(1,4).toString(),'PNG',p);return [b.readUInt32BE(16),b.readUInt32BE(20)]};
 assert.deepEqual(size('app/icon.png'),[512,512]);assert.deepEqual(size('app/apple-icon.png'),[180,180]);
 const ico=readFileSync(new URL('app/favicon.ico',root));assert.equal(ico.readUInt16LE(2),1,'an ICO file');assert.ok(ico.readUInt16LE(4)>=1);
});
test('mentions légales: the franchise wording; the RCS stays « to confirm » (registry regularisation in progress)',()=>{
 assert.equal(EDITOR.vatStatus,'TVA non applicable, article 293 B du CGI');
 assert.equal(EDITOR.rcs,'[À CONFIRMER]');
});
test('privacy: nothing asserted about Stripe until the owner switches STRIPE_SCC_CONFIRMED; the replacement text is ready',()=>{
 assert.equal(STRIPE_SCC_CONFIRMED,false);
 assert.match(TRANSFERS.stripe,/^\[À CONFIRMER\]/);
 assert.match(STRIPE_TRANSFER_SCC,/clauses contractuelles types adoptées par la Commission européenne/);
 assert.match(STRIPE_TRANSFER_SCC,/DPA\) de Stripe/);
 assert.match(TRANSFERS.braveSearch,/^\[À CONFIRMER\]/,'Brave: still nothing asserted');
 assert.match(read('src/domain/legal.ts'),/stripe: STRIPE_SCC_CONFIRMED \? STRIPE_TRANSFER_SCC : `\$\{TO_CONFIRM\}/);
});
test('i18n: the FR and EN dictionaries are untouched by this change',()=>{
 for(const f of ['src/i18n/fr.ts','src/i18n/en.ts'])assert.ok(existsSync(new URL(f,root)));
 assert.doesNotMatch(read('src/i18n/fr.ts')+read('src/i18n/en.ts'),/293 B|--font-|next\/font/);
});
