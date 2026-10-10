// Copy a text only once `gate` — the server accepting the action — has resolved (migration 029: a message whose source
// is no longer verified must never reach the clipboard). The write still starts inside the click: Safari keeps the user
// gesture only for a ClipboardItem whose data is a promise, so the text resolves after the server answered.
// Resolves true once copied, false when the browser refused the clipboard after the server accepted (the caller then
// asks the user to copy by hand); rejects with the gate's own error when the server refused — nothing is written then.
type ClipboardLike={write?:(items:unknown[])=>Promise<void>;writeText?:(text:string)=>Promise<void>};
type ClipboardItemLike=new(items:Record<string,Promise<Blob>>)=>unknown;
type ClipboardEnv={clipboard?:ClipboardLike;ClipboardItem?:ClipboardItemLike};

function browserClipboard():ClipboardEnv{
 const g=globalThis as {navigator?:{clipboard?:ClipboardLike};ClipboardItem?:ClipboardItemLike};
 return {clipboard:g.navigator?.clipboard,ClipboardItem:g.ClipboardItem};
}

export async function copyAfter(gate:Promise<unknown>,text:string,env:ClipboardEnv=browserClipboard()):Promise<boolean>{
 const {clipboard,ClipboardItem:Item}=env;
 let write:Promise<void>|null=null;
 if(clipboard?.write&&typeof Item==='function'){
  const data=gate.then(()=>new Blob([text],{type:'text/plain'}));data.catch(()=>{});
  try{write=clipboard.write([new Item({'text/plain':data})])}catch{write=null}
  write?.catch(()=>{});
 }
 await gate;
 if(write)try{await write;return true}catch{/* a browser without promise data: plain text below */}
 if(!clipboard?.writeText)return false;
 try{await clipboard.writeText(text);return true}catch{return false}
}
