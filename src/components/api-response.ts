// Reading a /api/v1 response in the browser. The route always answers JSON — success and business errors
// alike (Response.json, application/json). Anything else is not a ProspectOS answer: an HTML error page, a
// proxy's "upstream …" text, an empty or cut body, or a request that never got a response. Those are reported
// as one clear, localized "service unavailable" message — never the raw upstream text and never a JSON parser
// error such as "Unexpected token 'u', "upstream r"... is not valid JSON". No automatic retry: the user retries.
export class ServiceUnavailableError extends Error{
 constructor(message:string){super(message);this.name='ServiceUnavailableError'}
}
export async function fetchApiJson(send:()=>Promise<Response>,unavailableMessage:string):Promise<{res:Response;data:any}>{
 let res:Response;
 try{res=await send()}catch{throw new ServiceUnavailableError(unavailableMessage)}
 if(!/json/i.test(res.headers.get('content-type')??''))throw new ServiceUnavailableError(unavailableMessage);
 try{return {res,data:await res.json()}}catch{throw new ServiceUnavailableError(unavailableMessage)}
}
