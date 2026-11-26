// Server only — imported by the API route (app/api/v1/[...path]/route.ts): the reader of « Entreprises ayant cédé un fonds »
// (migration 058, public.sale_sellers) with the privileged client. Kept out of src/discovery/providers/bodacc-sales.ts,
// which the browser's bundle also contains: the privileged client never reaches a browser.
import {createAdminClient} from '../server/admin-client.ts';
import {registerSellersReader} from './providers/bodacc-sales.ts';
registerSellersReader(async args=>{
 const {data,error}=await createAdminClient().rpc('sale_sellers',args);
 if(error)throw Error('SELLERS_UNAVAILABLE');
 return data;
});
