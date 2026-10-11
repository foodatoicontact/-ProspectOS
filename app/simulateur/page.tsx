import type {Metadata} from 'next';
import {Simulator} from '../../src/components/Simulator';

// Public simulator V1: no account, fictional demonstration data only. Kept out of search engines, the sitemap and the
// SEO registry until it is validated.
export const metadata:Metadata={
 title:'Simulateur de prospection',
 description:'Testez votre ciblage sur des données de démonstration : comment ProspectOS prioriserait votre prospection.',
 robots:{index:false,follow:false},
};
export default function Page(){return <Simulator/>}
