// store.js - the app's state and every action that changes it.
// State = who is signed in + the data from the database + the model the engine builds from it.
// Each action calls one database function, then updates the local copy with what the database returned.
import { useSyncExternalStore } from '../vendor/react.js';
import { rpc, auth, configured } from './api.js';
import { buildModel, todayStr } from './engine.js';
import { PREF, PREF_KEYS, applyPrefs } from './prefs.js';

const S = { rev: 0, phase: 'boot', user: null, data: null, model: null, error: '', recovering: false, syncing: false, toast: null };
const subs = new Set();
const emit = () => { S.rev++; subs.forEach(f => f()); };
export const getState = () => S;
export const subscribe = f => { subs.add(f); return () => subs.delete(f); };
export function useStore() { useSyncExternalStore(subscribe, () => S.rev); return S; }

/* ---------- toast ---------- */
let toastTimer = 0;
export function say(text, bad) { S.toast = { text, bad: !!bad }; emit(); clearTimeout(toastTimer); toastTimer = setTimeout(() => { S.toast = null; emit(); }, bad ? 3600 : 1800); }

/* ---------- local copy (instant start, then refreshed from the database) ---------- */
const cacheKey = () => 'dil:data:' + (S.user ? S.user.id : '');
function setData(data, fromCache) {
  S.data = data;
  S.model = buildModel(data, todayStr());
  if (!fromCache) { try { localStorage.setItem(cacheKey(), JSON.stringify(data)); } catch (e) { try { localStorage.removeItem(cacheKey()); } catch (z) { /* ignore */ } } }
  emit();
}
const touch = () => setData({ ...S.data });
function prefsFromServer(settings) {
  const p = {}; PREF_KEYS.forEach(k => { if (settings && settings[k] !== undefined) p[k] = settings[k]; });
  applyPrefs(p);
}

/* ---------- start, sign in, sign out ---------- */
export async function boot() {
  if (!configured()) { S.phase = 'setup'; emit(); return; }
  try {
    auth.onChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { S.recovering = true; emit(); }
      if (event === 'SIGNED_OUT') { S.user = null; S.data = null; S.model = null; S.phase = 'auth'; emit(); }
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session && (!S.user || S.user.id !== session.user.id)) enter(session.user);
    });
    const s = await auth.session();
    if (s) await enter(s.user); else { S.phase = 'auth'; emit(); }
  } catch (e) { S.phase = 'auth'; S.error = e.message; emit(); }
}
async function enter(user) {
  if (S.user && S.user.id === user.id && S.phase !== 'auth') return;
  S.user = { id: user.id, email: user.email || '' };
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(cacheKey())); } catch (e) { /* ignore */ }
  if (cached && cached.accounts) { prefsFromServer(cached.settings); setData(cached, true); S.phase = 'ready'; } else S.phase = 'loading';
  emit();
  await load();
}
export async function load() {
  S.syncing = true; S.error = ''; emit();
  try {
    const data = await rpc('app_bootstrap', { p_lang: PREF.lang });
    prefsFromServer(data.settings);
    setData(data);
    S.phase = 'ready';
  } catch (e) {
    S.error = e.message;
    if (S.phase !== 'ready') S.phase = 'error';
  } finally { S.syncing = false; emit(); }
}
export async function signOut() { try { localStorage.removeItem(cacheKey()); } catch (e) { /* ignore */ } await auth.signOut(); }
export function endRecovery() { S.recovering = false; emit(); }

// the model is built for "today": rebuild when the app comes back on another day, and look for new captured messages
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || S.phase !== 'ready') return;
  if (S.model && S.model.today !== todayStr()) touch();
  refreshInbox();
});

/* ---------- entries ---------- */
function patchEntries(list) {
  const ids = new Set(list.map(e => e.id));
  S.data.entries = list.concat(S.data.entries.filter(e => !ids.has(e.id)));
  touch();
}
export async function saveEntry(entry) { const e = await rpc('entry_save', { p: entry }); patchEntries([e]); return e; }
export async function saveEntries(entries, rules) {
  const r = await rpc('entries_save_many', { p: { entries, rules: rules || [] } });
  S.data.rules = r.rules; patchEntries(r.entries); return r.entries;
}
export async function deleteEntry(id) {
  const r = await rpc('entry_delete', { p_id: id }), gone = new Set(r.deleted);
  S.data.entries = S.data.entries.filter(e => !gone.has(e.id));
  S.data.marks = (S.data.marks || []).filter(z => !gone.has(z.entry));
  touch();
}

/* ---------- accounts and categories ---------- */
export async function saveAccount(p) {
  const r = await rpc('account_save', { p });
  S.data.accounts = r.accounts;
  if (r.entry) S.data.entries = [r.entry].concat(S.data.entries);
  touch(); return r.account;
}
export async function deleteAccount(id) { const r = await rpc('account_delete', { p_id: id }); S.data.accounts = r.accounts; touch(); return r.mode; }

/* ---------- normalization marks, budget ---------- */
export async function setMarks(items, mode, months) {
  const keys = new Set(items.map(i => i.entry + '|' + i.acc)), before = S.data.marks;
  const rest = (S.data.marks || []).filter(z => !keys.has(z.entry + '|' + z.acc));   // shown at once, confirmed by the server
  S.data.marks = mode === 'clear' ? rest : rest.concat(items.map(i => ({ entry: i.entry, acc: i.acc, mode, months: months || [] })));
  touch();
  try { S.data.marks = await rpc('marks_set', { p: { items, mode, months: months || [] } }); touch(); }
  catch (e) { S.data.marks = before; touch(); throw e; }
}
export async function setBudget(month, amount) { S.data.budgets = await rpc('budget_set', { p_month: month, p_amount: amount }); touch(); }

/* ---------- settings (kept in the database, so they follow the user to every device) ---------- */
let pending = {}, timer = 0;
export function saveSettings(patch) {
  const pref = {}; PREF_KEYS.forEach(k => { if (patch[k] !== undefined) pref[k] = patch[k]; });
  if (Object.keys(pref).length) applyPrefs(pref);
  if (S.data) { S.data.settings = { ...(S.data.settings || {}), ...patch }; touch(); } else emit();
  if (!S.user) return;
  Object.assign(pending, patch);
  clearTimeout(timer);
  timer = setTimeout(async () => { const p = pending; pending = {}; try { await rpc('settings_save', { p }); } catch (e) { Object.assign(pending, { ...p, ...pending }); } }, 900);
}

/* ---------- plan, investments, other assets ---------- */
export async function saveCapex(p) { S.data.capex = await rpc('capex_save', { p }); touch(); }
export async function deleteCapex(id) { S.data.capex = await rpc('capex_delete', { p_id: id }); touch(); }
export async function saveInstrument(p) { S.data.instruments = await rpc('instrument_save', { p }); touch(); }
export async function saveAsset(p) { S.data.assets = await rpc('asset_save', { p }); touch(); }
export async function deleteAsset(id) { S.data.assets = await rpc('asset_delete', { p_id: id }); touch(); }

/* ---------- captured bank messages ---------- */
export async function refreshInbox() { try { const list = await rpc('inbox_list'); if (S.data) { S.data.inbox = list; emit(); } } catch (e) { /* offline: keep the old list */ } }
export async function updateInbox(ids, status, entry) { S.data.inbox = await rpc('inbox_update', { p_ids: ids, p_status: status, p_entry: entry || null }); emit(); }
export async function rotateCaptureToken() { S.data.capture_token = await rpc('capture_token_rotate'); touch(); }

/* ---------- backup ---------- */
export function exportBundle() {
  const d = S.data;
  return { format: 'diligence-backup', version: 1, exported_at: new Date().toISOString(), settings: d.settings || {}, accounts: d.accounts, entries: d.entries,
    marks: d.marks || [], budgets: d.budgets || [], capex: d.capex || [], instruments: d.instruments || [], assets: d.assets || [], rules: d.rules || [] };
}
export async function importBundle(bundle, replace) { const r = await rpc('import_bundle', { p: bundle, p_replace: !!replace }); await load(); return r; }
export async function wipe() { await rpc('wipe_my_data'); await load(); }
