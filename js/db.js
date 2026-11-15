// db.js - the ledger's rules, applied on the phone. These functions change a plain data object
// ({ accounts, entries, marks, budgets, capex, instruments, assets, rules, settings }) and throw an English sentence when
// something is not allowed. They used to be database functions; with end-to-end encryption the database cannot read the
// data, so the same checks run here before the vault is encrypted and saved.
import { r2, uid, isDebitKind } from './engine.js';

const KINDS = ['cash', 'card', 'loan', 'payable', 'receivable', 'stock', 'investment', 'expense', 'income', 'equity'];
const str = v => (v == null ? '' : String(v));
const trim = v => str(v).trim();
const orNull = v => { const s = trim(v); return s === '' ? null : s; };
const numOrNull = v => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const intOrNull = v => { const n = numOrNull(v); return n == null ? null : Math.round(n); };
const bool = v => v === true || v === 'true';
const low = s => str(s).toLowerCase();
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const strip = o => { const r = {}; for (const k of Object.keys(o)) if (o[k] !== null && o[k] !== undefined) r[k] = o[k]; return r; };
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(str(s));
const isMonth = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(str(s));
const sortAccounts = d => d.accounts.sort((a, b) => (a.sort - b.sort) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

export function emptyData() { return { accounts: [], entries: [], marks: [], budgets: [], capex: [], instruments: [], assets: [], rules: [], settings: {} }; }
// entries newest first, as every list expects
export function sortEntries(d) { d.entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (str(a.created) < str(b.created) ? 1 : str(a.created) > str(b.created) ? -1 : 0))); }

/* ---------- starter set ---------- */
export function seedDefaults(d, lang) {
  const tr = low(lang || 'en').startsWith('tr'), L = (a, b) => (tr ? a : b);
  const G1 = L('Sürekli giderler', 'Essentials'), G2 = L('Kişisel giderler', 'Personal'), G3 = L('Sosyal giderler', 'Social'), G4 = L('Diğer giderler', 'Other');
  const rows = [
    [L('Nakit', 'Cash'), 'cash', 10], [L('Kredi Kartı', 'Credit card'), 'card', 20],
    [L('Market', 'Groceries'), 'expense', 100, '🛒', G1], [L('Yemek', 'Eating out'), 'expense', 110, '🍽️', G1], [L('Kira ve Faturalar', 'Rent & bills'), 'expense', 120, '🏠', G1],
    [L('Ulaşım', 'Transport'), 'expense', 130, '🚌', G2], [L('Alışveriş', 'Shopping'), 'expense', 140, '🛍️', G2], [L('Kişisel Bakım', 'Health & personal care'), 'expense', 150, '💈', G2],
    [L('Abonelikler', 'Subscriptions'), 'expense', 160, '📱', G2],
    [L('Eğlence', 'Going out'), 'expense', 170, '🎉', G3], [L('Hediye', 'Gifts'), 'expense', 180, '🎁', G3], [L('Tatil', 'Travel'), 'expense', 190, '✈️', G3],
    [L('Komisyon', 'Fees'), 'expense', 200, '🧾', G4, 'fees'], [L('Faiz', 'Interest'), 'expense', 210, '🏦', G4], [L('Diğer', 'Other'), 'expense', 220, '📦', G4, 'reconcile'],
    [L('Maaş', 'Salary'), 'income', 300, '💼'], [L('Ek Gelir', 'Other income'), 'income', 310, '💰', null, 'reconcile_gain'], [L('Yatırım Geliri', 'Investment gains'), 'income', 320, '📈', null, 'invest_gain'],
    [L('Sosyal Alacak', 'Friends owe me'), 'receivable', 400, null, null, null, { per_party: true, due_mode: 'statement', netting_group: 'social' }],
    [L('İş Alacak', 'Work expenses to claim'), 'receivable', 410, null, null, null, { due_days: 10 }],
    [L('Sosyal Borç', 'I owe friends'), 'payable', 420, null, null, null, { per_party: true, netting_group: 'social' }],
    [L('Sarf Malzemeler', 'Consumables'), 'stock', 500], [L('Yatırımlar', 'Investments'), 'investment', 510],
    [L('Açılış Bakiyeleri', 'Opening balances'), 'equity', 900, null, null, 'opening'], [L('Bakiye Düzeltmeleri', 'Balance adjustments'), 'equity', 910, null, null, 'adjust']
  ];
  for (const [name, kind, sort, emoji, group_name, system_key, extra] of rows) {
    if (d.accounts.some(a => a.kind === kind && low(a.name) === low(name))) continue;
    d.accounts.push(strip({ id: uid(), name, kind, normal_side: isDebitKind(kind) ? 'debit' : 'credit', system_key: system_key || null, group_name: group_name || null, emoji: emoji || null,
      sort, archived: false, restricted: false, excluded: false, per_party: false, due_mode: 'days', due_days: 30, capture_channel: 'none', ...(extra || {}) }));
  }
  sortAccounts(d);
}
function systemAccount(d, key, name, kind) {
  const hit = d.accounts.find(a => a.system_key === key);
  if (hit) return hit.id;
  let n = name, i = 1;
  while (d.accounts.some(a => a.kind === kind && low(a.name) === low(n))) { i++; n = name + ' ' + i; }
  const a = { id: uid(), name: n, kind, normal_side: isDebitKind(kind) ? 'debit' : 'credit', system_key: key, sort: 900, archived: false, restricted: false, excluded: false, per_party: false, due_mode: 'days', due_days: 30, capture_channel: 'none' };
  d.accounts.push(a); sortAccounts(d);
  return a.id;
}

/* ---------- entries ---------- */
// names of people (cari) keep the spelling they were first written with
function partyMap(d) { const m = new Map(); for (const e of d.entries) for (const l of e.lines || []) if (l.party && !m.has(low(l.party))) m.set(low(l.party), l.party); return m; }
export function writeEntry(d, p, ctx) {
  ctx = ctx || {};
  if (!ctx.parties) ctx.parties = partyMap(d);
  if (!ctx.acc) ctx.acc = new Map(d.accounts.map(a => [a.id, a]));
  const id = orNull(p.id) || uid(), date = orNull(p.date);
  if (!date || !isDate(date)) throw new Error('Date is required');
  if (!Array.isArray(p.lines)) throw new Error('An entry needs lines');
  const ref = orNull(p.ref);
  if (ref) {
    if (ref === id) throw new Error('An entry cannot refer to itself');
    if (!d.entries.some(e => e.id === ref)) throw new Error('Linked entry not found');
  }
  const old = d.entries.find(e => e.id === id);
  const lines = []; let sum = 0;
  for (const l of p.lines) {
    const amt = r2(l.amt);
    if (!amt) continue;
    const a = ctx.acc.get(l.acc);
    if (!a) throw new Error('Unknown account on line ' + (lines.length + 1));
    let party = orNull(l.party);
    if (party) { party = party.slice(0, 80); const k = low(party); if (ctx.parties.has(k)) party = ctx.parties.get(k); else ctx.parties.set(k, party); }
    if (a.per_party && !party) throw new Error('"' + a.name + '" needs a person (cari)');
    const ld = orNull(l.date);
    lines.push(strip({ acc: a.id, amt, date: ld && isDate(ld) ? ld : date, party, item: orNull(l.item), qty: numOrNull(l.qty), unit: orNull(l.unit) }));
    sum += Math.round(amt * 100);
  }
  if (lines.length < 2) throw new Error('An entry needs at least two lines');
  if (sum !== 0) throw new Error('Entry is not balanced: debits and credits differ by ' + (sum / 100));
  const rd = orNull(p.rdate);
  const e = { id, kind: orNull(p.kind) || 'expense', date, rdate: rd && isDate(rd) ? rd : date, merchant: trim(p.merchant).slice(0, 200), note: trim(p.note).slice(0, 500), ref,
    n: Math.max(1, Math.min(60, intOrNull(p.n) || 1)), src: old ? old.src : (orNull(p.src) || 'manual'), created: old ? old.created : new Date().toISOString(), lines };
  d.entries = [e].concat(d.entries.filter(x => x.id !== id));
  return e;
}
export function writeEntries(d, list, rules) {
  if (!Array.isArray(list) || !list.length) throw new Error('Nothing to save');
  if (list.length > 1000) throw new Error('Too many entries in one save (max 1000)');
  const ctx = {}, out = [];
  list.forEach((p, i) => { try { out.push(writeEntry(d, p, ctx)); } catch (e) { throw new Error('Entry ' + (i + 1) + ': ' + e.message); } });
  for (const r of rules || []) {
    const k = trim(r && r.k);
    if (k.length < 3 || !d.accounts.some(a => a.id === r.acc)) continue;
    d.rules = (d.rules || []).filter(x => x.k !== k).concat([{ k, acc: r.acc }]);
  }
  return out;
}
// a purchase goes with its returns and its marks
export function deleteEntry(d, id) {
  if (!d.entries.some(e => e.id === id)) throw new Error('Entry not found');
  const gone = new Set([id]);
  for (let grew = true; grew;) { grew = false; for (const e of d.entries) if (e.ref && gone.has(e.ref) && !gone.has(e.id)) { gone.add(e.id); grew = true; } }
  d.entries = d.entries.filter(e => !gone.has(e.id));
  d.marks = (d.marks || []).filter(z => !gone.has(z.entry));
  return [...gone];
}

/* ---------- accounts and categories ---------- */
const hasLines = (d, id) => d.entries.some(e => (e.lines || []).some(l => l.acc === id));
export function saveAccount(d, p) {
  const name = trim(p.name), kindIn = orNull(p.kind), key = orNull(p.system_key);
  if (!name) throw new Error('Name is required');
  let id = orNull(p.id), old = null;
  if (id) {
    old = d.accounts.find(a => a.id === id);
    if (!old) throw new Error('Account not found');
    if (kindIn && kindIn !== old.kind && hasLines(d, id)) throw new Error('The type of "' + old.name + '" cannot change because it already has transactions');
  } else {
    if (!kindIn) throw new Error('Type is required');
    id = uid();
  }
  const kind = kindIn || old.kind;
  if (!KINDS.includes(kind)) throw new Error('Type is required');
  if (d.accounts.some(a => a.id !== id && a.kind === kind && low(a.name) === low(name))) throw new Error('"' + name + '" already exists');
  for (const k of ['statement_day', 'due_day']) if (has(p, k) && p[k] !== '' && p[k] != null && !(Number(p[k]) >= 1 && Number(p[k]) <= 31)) throw new Error('Days must be between 1 and 31.');
  if (key) d.accounts.forEach(a => { if (a.id !== id && a.system_key === key) delete a.system_key; });   // a role belongs to one account at a time

  const given = {
    emoji: orNull(p.emoji), group_name: orNull(p.group_name),
    sort: intOrNull(p.sort) != null ? intOrNull(p.sort) : d.accounts.filter(a => a.kind === kind).reduce((m, a) => Math.max(m, a.sort || 0), 0) + 10,
    archived: bool(p.archived), restricted: bool(p.restricted), excluded: bool(p.excluded),
    credit_limit: numOrNull(p.credit_limit) == null ? null : r2(p.credit_limit), statement_day: intOrNull(p.statement_day), due_day: intOrNull(p.due_day),
    per_party: bool(p.per_party), due_mode: orNull(p.due_mode) || 'days', due_days: intOrNull(p.due_days) != null ? intOrNull(p.due_days) : 30,
    netting_group: orNull(p.netting_group), capture_channel: orNull(p.capture_channel) || 'none',
    capture_last4: orNull(str(p.capture_last4).replace(/\D/g, '')), capture_sender: orNull(p.capture_sender), system_key: key
  };
  const a = { id, name, kind, normal_side: isDebitKind(kind) ? 'debit' : 'credit' };
  for (const k of Object.keys(given)) a[k] = !old || has(p, k) ? given[k] : (old[k] === undefined ? null : old[k]);
  const acc = strip(a);
  d.accounts = d.accounts.filter(x => x.id !== id).concat([acc]);
  sortAccounts(d);

  let entry = null;
  const open = p.opening ? r2(p.opening.amount) : 0;
  if (open) {
    if (!['cash', 'card', 'loan', 'payable', 'receivable'].includes(kind)) throw new Error('An opening balance only applies to money accounts');
    const amt = acc.normal_side === 'debit' ? open : -open;
    entry = writeEntry(d, { kind: 'opening', date: orNull(p.opening.date) || today(), merchant: acc.name, note: str(p.opening.note),
      lines: [{ acc: acc.id, amt, party: p.opening.party }, { acc: systemAccount(d, 'opening', 'Opening balances', 'equity'), amt: -amt }] });
  }
  return { account: acc, entry };
}
export function deleteAccount(d, id) {
  const a = d.accounts.find(x => x.id === id);
  if (!a) throw new Error('Account not found');
  if (a.system_key === 'opening' || a.system_key === 'adjust') throw new Error('"' + a.name + '" is used by the app and cannot be removed');
  if (hasLines(d, id)) { a.archived = true; return 'archived'; }
  d.accounts = d.accounts.filter(x => x.id !== id);
  d.rules = (d.rules || []).filter(r => r.acc !== id);
  d.marks = (d.marks || []).filter(z => z.acc !== id);
  return 'deleted';
}

/* ---------- normalization marks, budget ---------- */
export function setMarks(d, items, mode, months) {
  if (!['one_off', 'spread', 'clear'].includes(mode)) throw new Error('Unknown mode');
  let ms = [];
  if (mode === 'spread') {
    ms = [...new Set((months || []).filter(isMonth))].sort();
    if (!ms.length) throw new Error('Pick at least one month');
    if (ms.length > 60) throw new Error('Too many months');
  }
  for (const it of items || []) {
    d.marks = (d.marks || []).filter(z => !(z.entry === it.entry && z.acc === it.acc));
    if (mode === 'clear') continue;
    if (!d.entries.some(e => e.id === it.entry)) throw new Error('Purchase not found');
    if (!d.accounts.some(a => a.id === it.acc && a.kind === 'expense')) throw new Error('Category not found');
    d.marks.push({ entry: it.entry, acc: it.acc, mode, months: ms });
  }
}
export function setBudget(d, month, amount, note) {
  if (!isMonth(month)) throw new Error('Month must look like 2026-11');
  if (amount == null || amount === '' || !(Number(amount) >= 0)) throw new Error('Budget must be 0 or more');
  d.budgets = (d.budgets || []).filter(b => b.month !== month).concat([{ month, amount: r2(amount), note: str(note) }]).sort((a, b) => (a.month < b.month ? -1 : 1));
}

/* ---------- plan, investments, other assets ---------- */
export function saveCapex(d, p) {
  if (!isDate(p.date)) throw new Error('Date is required');
  if (numOrNull(p.price) == null) throw new Error('Amount must be a positive number.');
  const id = orNull(p.id) || uid(), row = { id, name: trim(p.name), price: Number(p.price), date: p.date, n: intOrNull(p.n) || 1, rate: numOrNull(p.rate) || 0 };
  d.capex = (d.capex || []).filter(c => c.id !== id).concat([row]).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
export function deleteCapex(d, id) { d.capex = (d.capex || []).filter(c => c.id !== id); }
export function saveInstrument(d, p) {
  const symbol = trim(p.symbol);
  if (!symbol) throw new Error('Instrument is required');
  const old = (d.instruments || []).find(i => i.symbol === symbol);
  const row = old ? { ...old } : { symbol, price: null, price_date: today(), class: '', cat2: '', cat3: '', horizon: '' };
  if (!old || has(p, 'price')) { row.price = numOrNull(p.price); row.price_date = orNull(p.price_date) || today(); }
  for (const k of ['class', 'cat2', 'cat3', 'horizon']) if (!old || has(p, k)) row[k] = str(p[k]);
  d.instruments = (d.instruments || []).filter(i => i.symbol !== symbol).concat([row]).sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
}
const sortAssets = d => d.assets.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
export function saveAsset(d, p) {
  const id = orNull(p.id) || uid();
  const row = { id, name: trim(p.name), group_name: trim(p.group_name), date: isDate(p.date) ? p.date : today(), cost: numOrNull(p.cost), value: numOrNull(p.value) || 0, note: str(p.note) };
  d.assets = (d.assets || []).filter(s => s.id !== id).concat([row]); sortAssets(d);
}
export function deleteAsset(d, id) { d.assets = (d.assets || []).filter(s => s.id !== id); }

/* ---------- backup, start again ---------- */
// keeps settings; everything else goes back to the starter set
export function wipe(d, lang) {
  const keep = d.settings || {};
  Object.assign(d, emptyData(), { settings: keep });
  seedDefaults(d, lang);
}
export function importBundle(d, p, replace) {
  if (!p || !Array.isArray(p.accounts) || !Array.isArray(p.entries)) throw new Error('This is not a Diligence backup file');
  if (d.entries.length && !replace) throw new Error('This account already has transactions. Choose "Replace my data" to load the backup over them.');
  const settings = d.settings || {};
  Object.assign(d, emptyData(), { settings });
  const accId = new Map(), entId = new Map();
  for (const r of p.accounts) {
    const id = uid(), kind = str(r.kind);
    if (!KINDS.includes(kind)) throw new Error('This is not a Diligence backup file');
    accId.set(r.id, id);
    d.accounts.push(strip({ id, name: trim(r.name), kind, normal_side: isDebitKind(kind) ? 'debit' : 'credit', system_key: orNull(r.system_key), group_name: orNull(r.group_name), emoji: orNull(r.emoji),
      sort: intOrNull(r.sort) || 0, archived: bool(r.archived), restricted: bool(r.restricted), excluded: bool(r.excluded), credit_limit: numOrNull(r.credit_limit),
      statement_day: intOrNull(r.statement_day), due_day: intOrNull(r.due_day), per_party: bool(r.per_party), due_mode: orNull(r.due_mode) || 'days', due_days: intOrNull(r.due_days) != null ? intOrNull(r.due_days) : 30,
      netting_group: orNull(r.netting_group), capture_channel: orNull(r.capture_channel) || 'none', capture_last4: orNull(r.capture_last4), capture_sender: orNull(r.capture_sender) }));
  }
  sortAccounts(d);
  for (const r of p.entries) entId.set(r.id, uid());            // ids first, so returns can point to purchases that come later in the file
  const ctx = {}, ordered = p.entries.filter(r => !orNull(r.ref)).concat(p.entries.filter(r => orNull(r.ref)));
  for (const r of ordered) {
    try {
      const lines = (r.lines || []).map(l => { if (!accId.has(l.acc)) throw new Error('Backup file refers to an account that is not in the file'); return { ...l, acc: accId.get(l.acc) }; });
      const e = writeEntry(d, { ...r, id: entId.get(r.id), ref: orNull(r.ref) ? entId.get(r.ref) : null, lines }, ctx);
      if (r.created) e.created = str(r.created);
    } catch (e) { throw new Error('Entry "' + str(r.merchant) + '" (' + str(r.date) + '): ' + e.message); }
  }
  sortEntries(d);
  let marks = 0;
  for (const r of p.marks || []) if (entId.has(r.entry) && accId.has(r.acc)) { d.marks.push({ entry: entId.get(r.entry), acc: accId.get(r.acc), mode: r.mode, months: (r.months || []).slice().sort() }); marks++; }
  for (const b of p.budgets || []) if (isMonth(b.month) && !d.budgets.some(x => x.month === b.month)) d.budgets.push({ month: b.month, amount: Number(b.amount) || 0, note: str(b.note) });
  d.budgets.sort((a, b) => (a.month < b.month ? -1 : 1));
  for (const c of p.capex || []) if (isDate(c.date)) d.capex.push({ id: uid(), name: str(c.name), price: Number(c.price) || 0, date: c.date, n: intOrNull(c.n) || 1, rate: numOrNull(c.rate) || 0 });
  d.capex.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const i of p.instruments || []) if (trim(i.symbol) && !d.instruments.some(x => x.symbol === trim(i.symbol)))
    d.instruments.push({ symbol: trim(i.symbol), price: numOrNull(i.price), price_date: orNull(i.price_date), class: str(i.class), cat2: str(i.cat2), cat3: str(i.cat3), horizon: str(i.horizon) });
  d.instruments.sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
  for (const s of p.assets || []) d.assets.push({ id: uid(), name: str(s.name), group_name: str(s.group_name), date: isDate(s.date) ? s.date : today(), cost: numOrNull(s.cost), value: numOrNull(s.value) || 0, note: str(s.note) });
  sortAssets(d);
  for (const x of p.rules || []) { const k = trim(x && x.k); if (k.length >= 3 && accId.has(x.acc) && !d.rules.some(r => r.k === k)) d.rules.push({ k, acc: accId.get(x.acc) }); }
  if (p.settings && typeof p.settings === 'object' && !Array.isArray(p.settings)) d.settings = strip({ ...settings, ...p.settings });
  return { accounts: accId.size, entries: ordered.length, marks };
}
