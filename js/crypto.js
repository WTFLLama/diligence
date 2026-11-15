// crypto.js - end-to-end encryption. Everything a user owns is one encrypted "vault"; the database only ever stores ciphertext.
//
//   data key (DEK)   32 random bytes, made on the phone. Encrypts the vault (AES-256-GCM). Never leaves the phone unwrapped.
//   password         PBKDF2 -> a key that wraps the DEK (stored as wrap_pw)
//   recovery code    PBKDF2 -> a second key that wraps the same DEK (stored as wrap_rc)
//   capture keys     an ECDH P-256 pair. The public half lets the server encrypt an incoming bank SMS / e-mail at once;
//                    the private half lives inside the vault, so only the phone can read the message.
const te = new TextEncoder(), td = new TextDecoder();
const subtle = () => {
  if (!globalThis.crypto || !crypto.subtle) throw new Error('This browser cannot encrypt your data. Open the app over https in an up-to-date browser.');
  return crypto.subtle;
};
export const rand = n => crypto.getRandomValues(new Uint8Array(n));
export function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
export function unb64(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };

export const PW_ITERS = 600000;      // password -> key
const RC_ITERS = 1000;               // the recovery code is 120 random bits already; it does not need stretching

/* ---------- AES-GCM helpers ---------- */
const aes = raw => subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
async function seal(key, bytes, aad) {
  const iv = rand(12);
  return cat(iv, new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, bytes)));
}
async function unseal(key, bytes, aad) {
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: te.encode(aad) }, key, bytes.subarray(12)));
}

/* ---------- wrapping the data key with a password or the recovery code ---------- */
async function stretch(secret, salt, iters) {
  const base = await subtle().importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iters }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export const newSalt = () => b64(rand(16));
export const newDek = () => rand(32);
export async function wrapWithPassword(dek, password, salt, iters, uid) { return b64(await seal(await stretch(password, unb64(salt), iters), dek, 'pw:' + uid)); }
export async function unwrapWithPassword(wrapped, password, salt, iters, uid) {
  try { return await unseal(await stretch(password, unb64(salt), iters), unb64(wrapped), 'pw:' + uid); } catch (e) { throw new Error('Wrong password.'); }
}
export const normCode = s => String(s || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');
export async function wrapWithCode(dek, code, salt, uid) { return b64(await seal(await stretch(normCode(code), unb64(salt), RC_ITERS), dek, 'rc:' + uid)); }
export async function unwrapWithCode(wrapped, code, salt, uid) {
  try { return await unseal(await stretch(normCode(code), unb64(salt), RC_ITERS), unb64(wrapped), 'rc:' + uid); } catch (e) { throw new Error('Wrong recovery code.'); }
}
// 24 characters, no I L O U: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newRecoveryCode() {
  const r = rand(24); let s = '';
  for (let i = 0; i < 24; i++) s += ALPHA[r[i] & 31] + (i % 4 === 3 && i < 23 ? '-' : '');
  return s;
}

/* ---------- the vault ---------- */
async function pipe(bytes, stream) {
  const w = stream.writable.getWriter(); w.write(bytes); w.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}
const canZip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined' && typeof Response !== 'undefined';
// -> base64 text: [1 byte: 1 = gzip, 0 = plain] [12 bytes iv] [ciphertext]
export async function encryptVault(dek, obj, uid) {
  let bytes = te.encode(JSON.stringify(obj)), z = 0;
  if (canZip()) { try { bytes = await pipe(bytes, new CompressionStream('gzip')); z = 1; } catch (e) { z = 0; bytes = te.encode(JSON.stringify(obj)); } }
  return b64(cat(new Uint8Array([z]), await seal(await aes(dek), bytes, 'vault:' + uid)));
}
export async function decryptVault(dek, text, uid) {
  const all = unb64(text);
  let bytes;
  try { bytes = await unseal(await aes(dek), all.subarray(1), 'vault:' + uid); } catch (e) { throw new Error('vault_key'); }
  if (all[0] === 1) bytes = await pipe(bytes, new DecompressionStream('gzip'));
  return JSON.parse(td.decode(bytes));
}

/* ---------- captured bank messages ---------- */
// The server function does the mirror image of openCaptured(): fresh key pair, ECDH with the user's public key, HKDF, AES-GCM.
const EC = { name: 'ECDH', namedCurve: 'P-256' }, INFO = 'diligence-capture-v1';
export async function newCaptureKeys() {
  const kp = await subtle().generateKey(EC, true, ['deriveBits']);
  return { pub: b64(new Uint8Array(await subtle().exportKey('raw', kp.publicKey))), priv: await subtle().exportKey('jwk', kp.privateKey) };
}
async function sharedKey(priv, pubRaw) {
  const pub = await subtle().importKey('raw', pubRaw, EC, false, []);
  const bits = await subtle().deriveBits({ name: 'ECDH', public: pub }, priv, 256);
  const hk = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode(INFO) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
// [65 bytes: sender's one-time public key] [12 bytes iv] [ciphertext]
export async function openCaptured(privJwk, text) {
  const all = unb64(text), priv = await subtle().importKey('jwk', privJwk, EC, false, ['deriveBits']);
  const key = await sharedKey(priv, all.subarray(0, 65));
  return JSON.parse(td.decode(await unseal(key, all.subarray(65), INFO)));
}
// used by the tests (the server function carries its own copy of this)
export async function sealCaptured(pubB64, obj) {
  const kp = await subtle().generateKey(EC, true, ['deriveBits']);
  const key = await sharedKey(kp.privateKey, unb64(pubB64));
  return b64(cat(new Uint8Array(await subtle().exportKey('raw', kp.publicKey)), await seal(key, te.encode(JSON.stringify(obj)), INFO)));
}
