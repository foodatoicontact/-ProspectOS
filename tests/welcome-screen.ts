// The legacy welcome screen of app/page.tsx as one JSX expression, for the tests that read it as source. Since WEB-1 its
// sign-up card, SEO links and footer are named once (shared with the ProspectOS 2.0 homepage); this puts them back in
// place, so the text these tests inspect is exactly the screen a visitor gets while WEB_V2_HOME_ENABLED is off.
export function legacyWelcome(page:string):string{
 const blk=page.slice(page.indexOf(" if(mode==='welcome'){"));
 const part=(k:string)=>{const m=new RegExp(`\\n  const ${k}=(.*);\\n`).exec(blk);if(!m)throw new Error(`welcome screen: ${k} not found`);return m[1]!};
 const ret=/\n  return (<main className="welcome">.*)\n \}/.exec(blk);
 if(!ret)throw new Error('welcome screen JSX not found');
 let jsx=ret[1]!;
 for(const k of ['seoLinks','authCard','footer'])jsx=jsx.split(`{${k}}`).join(part(k));
 return ` if(mode==='welcome')return ${jsx}`;
}
