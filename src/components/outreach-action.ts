// Outreach actions (Save / Approve / Copy) report their own refusal inside the message block, right above the buttons
// (role="alert"): the general banner sits at the top of the page, out of sight on a phone once the user scrolled down
// to the message. A success clears that message. An error that is not about the message (an expired session) is
// rethrown untouched, so it still reaches the general banner.
export async function runOutreachAction(action:()=>Promise<void>,setError:(message:string)=>void,isGeneral:(e:unknown)=>boolean,fallback:string):Promise<void>{
 try{await action()}catch(e){if(isGeneral(e))throw e;setError(e instanceof Error&&e.message?e.message:fallback);return}
 setError('');
}
