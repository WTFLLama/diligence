// store.js - the app's state and every action that changes it.
// State = who is signed in + their decrypted data + the model the engine builds from it.
//
// Everything a user owns is ONE encrypted vault (crypto.js). The database stores only the ciphertext, so nobody but the
// user can read it. Each action changes a copy of the data with the rules in db.js, encrypts it and saves it; the
// database refuses the save if another device saved in between, and then the action is repeated on the fresh copy.
import { useSyncExternalStore } from '../vendor/react.js';
import { rpc, auth, configured } from './api.js';
import { buildModel, todayStr } from './engine.js';
import { PREF, PREF_KEYS, applyPrefs } from './prefs.js';
import * as DB from './db.js';
import * as C from './crypto.js';

const S = { rev: 0, phase: 'boot', user: null, data: null, model: null, error: '', recovering: false, syncing: false, toast: null, lock: null };
const subs = new Set();
const emit = () => { S.rev++; subs.forEach(f => f()); };
export const getState = () => S;
export const subscribe = f => { subs.add(f); return () => subs.delete(f); };
export function useStore() { useSyncExternalStore(subscribe, () => S.rev); return S; }

/* ---------- toast ---------- */
let toastTimer = 0;
export function say(text, bad) { S.toast = { text, bad: !!bad }; emit(); clearTimeout(toastTimer); toastTimer = setTimeout(() => { S.toast = null; emit(); }, bad ? 3600 : 1800); }

/* ---------- keys and the local copy ---------- */
// K.dek = the data key (only on this device), K.meta = what the database holds about the vault, K.vrev = the version we have
let K = { dek: null, meta: null, vrev: 0 };
let pendingPw = '', pwTimer = 0;      // the password just typed on the sign-in form, kept in memory until the vault is opened
const holdPw = pw => { pendingPw = pw; clearTimeout(pwTimer); pwTimer = setTimeout(() => { pendingPw = ''; }, 60000); };
const ls = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { try { localStorage.removeItem(k); } catch (z) { /* ignore */ } } },
  del: k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};
const keyName = () => 'dil:key:' + (S.user ? S.user.id : ''), cacheName = () => 'dil:vault:' + (S.user ? S.user.id : '');
const keepKey = () => ls.set(keyName(), C.b64(K.dek));
const keepCopy = (rev, blob) => ls.set(cacheName(), JSON.stringify({ rev, blob }));       // the encrypted copy, for an instant start
const forget = () => { ls.del(keyName()); ls.del(cacheName()); K = { dek: null, meta: null, vrev: 0 }; };
// earlier versions kept a readable copy on the device: remove it
try { Object.keys(localStorage).filter(k => k.indexOf('dil:data:') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }

const VAULT = ['accounts', 'entries', 'marks', 'budgets', 'capex', 'instruments', 'assets', 'rules', 'settings', 'recovery', 'cap_priv'];
const vaultOf = data => { const o = {}; VAULT.forEach(k => { if (data[k] !== undefined) o[k] = data[k]; }); return o; };
function prefsFromVault(settings) {
  const p = {}; PREF_KEYS.forEach(k => { if (settings && settings[k] !== undefined) p[k] = settings[k]; });
  applyPrefs(p);
}
function adopt(v) {
  const d = { ...DB.emptyData(), ...v };
  prefsFromVault(d.settings);
  S.data = { ...d, inbox: S.data ? S.data.inbox || [] : [], capture_token: K.meta ? K.meta.capture_token : '' };
  S.model = buildModel(S.data, todayStr());
  emit();
}
const rebuild = () => { S.model = buildModel(S.data, todayStr()); emit(); };

/* ---------- start, sign in, sign out ---------- */
export async function boot() {
  if (!configured()) { S.phase = 'setup'; emit(); return; }
  try {
    auth.onChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { S.recovering = true; emit(); }
      if (event === 'SIGNED_OUT') { K = { dek: null, meta: null, vrev: 0 }; S.user = null; S.data = null; S.model = null; S.lock = null; S.phase = 'auth'; emit(); }
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session && (!S.user || S.user.id !== session.user.id)) enter(session.user);
    });
    const s = await auth.session();
    if (s) await enter(s.user); else { S.phase = 'auth'; emit(); }
  } catch (e) { S.phase = 'auth'; S.error = e.message; emit(); }
}
async function enter(user) {
  if (S.user && S.user.id === user.id && S.phase !== 'auth') return;
  S.user = { id: user.id, email: user.email || '' };
  S.phase = 'loading'; S.data = null; S.model = null; S.lock = null;
  K = { dek: null, meta: null, vrev: 0 };
  emit();
  const raw = ls.get(keyName());
  if (raw) {
    try {
      K.dek = C.unb64(raw);
      const cached = JSON.parse(ls.get(cacheName()) || 'null');
      if (cached && cached.blob) { const v = await C.decryptVault(K.dek, cached.blob, user.id); K.vrev = cached.rev; adopt(v); S.phase = 'ready'; emit(); }
    } catch (e) { ls.del(cacheName()); K.vrev = 0; }
  }
  await load();
}
// asks the database what it has and opens it, or stops at the lock screen when this device has no key yet
export async function load() {
  if (!S.user) return;
  S.syncing = true; S.error = ''; emit();
  const uid = S.user.id;
  try {
    const meta = await rpc('vault_open');
    if (!meta || !meta.exists) {
      forget(); S.data = null; S.model = null;
      if (pendingPw) await createVault(pendingPw); else { S.lock = 'create'; S.phase = 'lock'; }
    } else {
      K.meta = meta;
      if (!K.dek && pendingPw) { try { K.dek = await C.unwrapWithPassword(meta.wrap_pw, pendingPw, meta.salt, meta.iters, uid); keepKey(); } catch (e) { K.dek = null; } }
      if (!K.dek) { S.lock = 'unlock'; S.phase = 'lock'; }
      else { await fetchLatest(); if (K.dek) { S.data.capture_token = meta.capture_token; S.lock = null; S.phase = 'ready'; refreshInbox(); } }
    }
  } catch (e) {
    S.error = e.message;
    if (S.phase !== 'ready') S.phase = 'error';
  } finally { pendingPw = ''; S.syncing = false; emit(); }
}
// downloads the vault when the database has a newer version than this device
async function fetchLatest() {
  const r = await rpc('vault_get', { p_rev: S.data ? K.vrev : 0 });
  if (!r || !r.blob) return;
  let v;
  try { v = await C.decryptVault(K.dek, r.blob, S.user.id); }
  catch (e) {                       // the vault was started over with a new key on another device
    const meta = K.meta; forget(); K.meta = meta; S.data = null; S.model = null; S.lock = 'unlock'; S.phase = 'lock'; emit();
    return;
  }
  K.vrev = r.rev; keepCopy(r.rev, r.blob); adopt(v);
}
async function createVault(pw) {
  const uid = S.user.id, dek = C.newDek(), salt = C.newSalt(), code = C.newRecoveryCode(), keys = await C.newCaptureKeys();
  const d = DB.emptyData();
  DB.seedDefaults(d, PREF.lang);
  d.settings = { lang: PREF.lang }; d.recovery = code; d.cap_priv = keys.priv;
  const blob = await C.encryptVault(dek, d, uid);
  const meta = await rpc('vault_init', { p: { salt, iters: C.PW_ITERS, blob, capture_pub: keys.pub,
    wrap_pw: await C.wrapWithPassword(dek, pw, salt, C.PW_ITERS, uid), wrap_rc: await C.wrapWithCode(dek, code, salt, uid) } });
  K = { dek, meta, vrev: meta.rev };
  keepKey(); keepCopy(meta.rev, blob);
  S.data = null; adopt(d);
  S.lock = null; S.phase = 'ready'; emit();
}
// the sign-in form goes through these, so the password can open (or create) the vault right after
export async function signIn(email, password) { holdPw(password); try { return await auth.signIn(email, password); } catch (e) { pendingPw = ''; throw e; } }
export async function signUp(email, password) {
  holdPw(password);
  try { const r = await auth.signUp(email, password); if (!r.session) pendingPw = ''; return r; } catch (e) { pendingPw = ''; throw e; }
}
export async function signOut() { ls.del(keyName()); ls.del(cacheName()); await auth.signOut(); }
export function endRecovery() { S.recovering = false; emit(); }
export const vaultState = () => ({ exists: !!K.meta, unlocked: !!K.dek });

/* ---------- lock screen: this device has no key yet ---------- */
const checkPassword = async pw => { try { await auth.signIn(S.user.email, pw); } catch (e) { throw new Error(/invalid login/i.test(e.message) ? 'Wrong password.' : e.message); } };
async function rewrap(dek, pw) {
  const wrap_pw = await C.wrapWithPassword(dek, pw, K.meta.salt, K.meta.iters, S.user.id);
  await rpc('vault_rewrap', { p_wrap_pw: wrap_pw });
  K.meta.wrap_pw = wrap_pw;
}
export async function unlock(pw) {
  if (S.lock === 'create') { await checkPassword(pw); try { await createVault(pw); } catch (e) { if (/already exists/i.test(e.message)) { holdPw(pw); await load(); } else throw e; } return; }
  K.dek = await C.unwrapWithPassword(K.meta.wrap_pw, pw, K.meta.salt, K.meta.iters, S.user.id);
  keepKey();
  await load();
}
// the recovery code opens the vault; the current password is then made to open it too
export async function unlockWithCode(code, pw) {
  const dek = await C.unwrapWithCode(K.meta.wrap_rc, code, K.meta.salt, S.user.id);
  await checkPassword(pw);
  await rewrap(dek, pw);
  K.dek = dek; keepKey();
  await load();
}
// after the "forgot my password" e-mail: set the new password and make it open the vault
const settled = async () => {
  if (S.phase !== 'lock' && S.phase !== 'ready') await load();
  if (S.phase !== 'lock' && S.phase !== 'ready') throw new Error(S.error || 'No connection. Check your internet and try again.');
};
export async function finishRecovery(pw, code) {
  await settled();
  if (!K.meta) { await auth.setPassword(pw); S.recovering = false; if (S.lock === 'create') await createVault(pw); emit(); return; }
  const dek = K.dek || await C.unwrapWithCode(K.meta.wrap_rc, code, K.meta.salt, S.user.id);
  await auth.setPassword(pw);
  await rewrap(dek, pw);
  K.dek = dek; keepKey();
  S.recovering = false;
  if (S.phase !== 'ready') await load(); else emit();
}
// no password that opens it and no recovery code: the data cannot be read by anyone. Erase it and begin again.
export async function startOver(pw) {
  await settled();
  if (S.recovering) await auth.setPassword(pw); else await checkPassword(pw);
  await rpc('vault_reset');
  forget(); S.data = null; S.model = null;
  await createVault(pw);
  S.recovering = false; emit();
}

// the model is built for "today": rebuild when the app comes back on another day, look for changes from another device and for new captured messages
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') { flushSettings(); return; }
  if (S.phase !== 'ready' || !K.dek) return;
  if (S.model && S.model.today !== todayStr()) rebuild();
  queue(fetchLatest).catch(() => {});
  refreshInbox();
});

/* ---------- saving ---------- */
let chain = Promise.resolve();
const queue = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };      // one save at a time
// fn(draft) changes a copy of the data (and may throw to refuse). Returns what fn returns, once the encrypted copy is saved.
function commit(fn) {
  return queue(async () => {
    for (let i = 0; i < 3; i++) {
      if (!K.dek || !S.data) throw new Error('Not signed in');
      const d = structuredClone(vaultOf(S.data)), out = fn(d);
      const blob = await C.encryptVault(K.dek, d, S.user.id);
      let rev;
      try { rev = await rpc('vault_put', { p_rev: K.vrev, p_blob: blob }); }
      catch (e) { if (/vault_conflict/.test(e.message)) { await fetchLatest(); continue; } throw e; }
      K.vrev = rev; keepCopy(rev, blob); adopt(d);
      return out;
    }
    throw new Error('Your data changed on another device. Try again.');
  });
}

/* ---------- entries ---------- */
export const saveEntry = entry => commit(d => DB.writeEntry(d, entry));
export const saveEntries = (entries, rules) => commit(d => DB.writeEntries(d, entries, rules));
export const deleteEntry = id => commit(d => { DB.deleteEntry(d, id); });

/* ---------- accounts and categories ---------- */
export const saveAccount = p => commit(d => DB.saveAccount(d, p).account);
export const deleteAccount = id => commit(d => DB.deleteAccount(d, id));

/* ---------- normalization marks, budget ---------- */
export async function setMarks(items, mode, months) {
  const keys = new Set(items.map(i => i.entry + '|' + i.acc)), before = S.data.marks;
  const rest = (S.data.marks || []).filter(z => !keys.has(z.entry + '|' + z.acc));   // shown at once, then saved
  S.data.marks = mode === 'clear' ? rest : rest.concat(items.map(i => ({ entry: i.entry, acc: i.acc, mode, months: months || [] })));
  rebuild();
  try { await commit(d => { DB.setMarks(d, items, mode, months || []); }); }
  catch (e) { S.data.marks = before; rebuild(); throw e; }
}
export const setBudget = (month, amount) => commit(d => { DB.setBudget(d, month, amount); });

/* ---------- settings (kept in the vault, so they follow the user to every device) ---------- */
let pending = {}, timer = 0;
const stripNulls = o => { const r = {}; Object.keys(o).forEach(k => { if (o[k] !== null && o[k] !== undefined) r[k] = o[k]; }); return r; };
function flushSettings() {
  clearTimeout(timer);
  const p = pending; pending = {};
  if (!Object.keys(p).length || !K.dek || !S.data) return;
  commit(d => { d.settings = stripNulls({ ...(d.settings || {}), ...p }); }).catch(() => { pending = { ...p, ...pending }; });
}
export function saveSettings(patch) {
  const pref = {}; PREF_KEYS.forEach(k => { if (patch[k] !== undefined) pref[k] = patch[k]; });
  if (Object.keys(pref).length) applyPrefs(pref);
  if (S.data) { S.data.settings = { ...(S.data.settings || {}), ...patch }; rebuild(); } else emit();
  if (!S.user || !K.dek || !S.data) return;
  Object.assign(pending, patch);
  clearTimeout(timer);
  timer = setTimeout(flushSettings, 900);
}

/* ---------- plan, investments, other assets ---------- */
export const saveCapex = p => commit(d => { DB.saveCapex(d, p); });
export const deleteCapex = id => commit(d => { DB.deleteCapex(d, id); });
export const saveInstrument = p => commit(d => { DB.saveInstrument(d, p); });
export const saveAsset = p => commit(d => { DB.saveAsset(d, p); });
export const deleteAsset = id => commit(d => { DB.deleteAsset(d, id); });

/* ---------- captured bank messages ---------- */
// The server encrypts each message for this user as it arrives; only the key inside the vault can open it.
export async function refreshInbox() {
  if (!S.data || !S.data.cap_priv) return;
  try {
    const rows = await rpc('capture_list'), out = [], stale = [], old = Date.now() - 3 * 86400000;
    for (const r of rows || []) {
      try { const m = await C.openCaptured(S.data.cap_priv, r.c); out.push({ id: r.id, at: r.at, ch: m.ch === 'email' ? 'email' : 'sms', sender: String(m.sender || ''), text: String(m.text || '') }); }
      catch (e) { if (new Date(r.at).getTime() < old) stale.push(r.id); }      // written for a key this vault no longer has
    }
    if (stale.length) rpc('capture_done', { p_ids: stale }).catch(() => {});
    if (S.data) { S.data.inbox = out; emit(); }
  } catch (e) { /* offline: keep the old list */ }
}
export async function updateInbox(ids) {
  await rpc('capture_done', { p_ids: ids });
  const gone = new Set(ids);
  S.data.inbox = (S.data.inbox || []).filter(n => !gone.has(n.id)); emit();
}
export async function rotateCaptureToken() { const t = await rpc('capture_rotate'); if (K.meta) K.meta.capture_token = t; S.data.capture_token = t; emit(); }

/* ---------- backup ---------- */
export function exportBundle() {
  const d = S.data;
  return { format: 'diligence-backup', version: 1, exported_at: new Date().toISOString(), settings: d.settings || {}, accounts: d.accounts, entries: d.entries,
    marks: d.marks || [], budgets: d.budgets || [], capex: d.capex || [], instruments: d.instruments || [], assets: d.assets || [], rules: d.rules || [] };
}
export const importBundle = (bundle, replace) => commit(d => DB.importBundle(d, bundle, !!replace));
export const wipe = () => commit(d => { DB.wipe(d, PREF.lang); });
