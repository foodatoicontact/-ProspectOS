import type {Metadata} from 'next';
import Home from '../page';
// ProspectOS installable (PWA): the start page of the installed app (manifest start_url). The same application as the
// homepage — sign-in for a visitor, the workspace for a signed-in session — under its own address, never indexed.
export const metadata:Metadata={title:{absolute:'ProspectOS'},alternates:{canonical:'/'},robots:{index:false,follow:false}};
export default function Page(){return <Home/>}
