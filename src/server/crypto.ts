import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
// BYOK secret encryption. AES-256-GCM (NIST-standard authenticated cipher, Node's built-in `crypto`
// module — not a hand-rolled scheme, never Base64-as-security): a random 96-bit IV per encryption, a
// 128-bit authentication tag verified on every decrypt. The master key lives ONLY in the server
// environment (BYOK_MASTER_KEY, never NEXT_PUBLIC_, never in git, never logged) and is the sole secret
// that can ever turn ciphertext back into a usable API key — the database alone (encrypted_secret/iv/
// auth_tag columns) is never enough. Decryption happens exclusively at the moment a BYOK provider call
// is about to be made (see resolveProviderCredential in byok.ts), never eagerly, never cached in a way
// that would keep a plaintext key resident longer than one request.
const ALGORITHM='aes-256-gcm';
function masterKey():Buffer {
 const raw=process.env.BYOK_MASTER_KEY;
 if(!raw)throw Error('CONFIGURATION_REQUIRED');
 const key=Buffer.from(raw,'base64');
 if(key.length!==32)throw Error('CONFIGURATION_REQUIRED');
 return key;
}
export interface EncryptedSecret {ciphertext:Buffer;iv:Buffer;authTag:Buffer}
export function encryptSecret(plaintext:string):EncryptedSecret {
 const iv=randomBytes(12);
 const cipher=createCipheriv(ALGORITHM,masterKey(),iv);
 const ciphertext=Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()]);
 return {ciphertext,iv,authTag:cipher.getAuthTag()};
}
export function decryptSecret(encrypted:EncryptedSecret):string {
 const decipher=createDecipheriv(ALGORITHM,masterKey(),encrypted.iv);
 decipher.setAuthTag(encrypted.authTag);
 return Buffer.concat([decipher.update(encrypted.ciphertext),decipher.final()]).toString('utf8');
}
// Alphanumerics only: provider_credentials.key_last4 CHECK '^[A-Za-z0-9]{4}$' (migration 009) rejects a key whose tail
// holds '-', '_' or whitespace, and the save would fail (tests/byok-key-last4.test.ts).
// A provider key travels in an HTTP header (x-api-key / Authorization): visible ASCII only, no space. Anything else
// (Unicode, invisible characters, whitespace, newline) makes fetch throw before any request leaves.
export const isHeaderSafeSecret=(secret:string):boolean=>/^[\x21-\x7E]+$/.test(secret);
export const last4=(secret:string):string=>secret.replace(/[^A-Za-z0-9]/g,'').slice(-4).padStart(4,'0');
