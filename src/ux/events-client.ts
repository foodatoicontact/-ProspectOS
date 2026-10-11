// UX A/B — client side of the view tracking: a page session tracks a prospect view once per variant, whatever the number
// of React renders or effect re-runs (StrictMode included). The server deduplicates again (30 minutes).
export function markViewOnce(seen:Set<string>,key:string):boolean{
 if(seen.has(key))return false;
 seen.add(key);
 return true;
}
