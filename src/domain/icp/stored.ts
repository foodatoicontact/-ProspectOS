// Reading icps.profile (migration 041). The database only checks the shape's outline; every read goes through
// parseIcpProfile, and a stored profile that does not pass is reported as unreadable — the page then offers a new import —
// never thrown, never partially used.
import {parseIcpProfile,type IcpProfile} from './schema.ts';

export type StoredProfile=
 |{state:'none'}
 |{state:'valid';profile:IcpProfile}
 |{state:'unreadable';reason:'PROFILE_UNREADABLE'};

export function readStoredProfile(raw:unknown):StoredProfile{
 if(raw===null||raw===undefined)return {state:'none'};
 const parsed=parseIcpProfile(raw);
 return parsed.ok?{state:'valid',profile:parsed.profile}:{state:'unreadable',reason:'PROFILE_UNREADABLE'};
}

export const UNREADABLE_PROFILE_MESSAGE={
 fr:'Le profil enregistré est illisible. Relancez un import pour le remplacer.',
 en:'The saved profile cannot be read. Run a new import to replace it.',
} as const;
