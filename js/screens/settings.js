// settings.js - look & feel, accounts and categories, automatic capture, backup, account.
import { h, useState, useRef, Pg, Pills, F, In, NumIn, DateIn, Dd, Sw, Er, Dlg, Confirm, EmPicker, Frag, num, useAct, cx } from '../lib.js';
import { accountsOf, balances, isDebitKind } from '../engine.js';
import { t, tf, tl, PREF, terr } from '../prefs.js';
import { useStore, saveSettings, saveAccount, deleteAccount, rotateCaptureToken, exportBundle, importBundle, wipe, signOut, say } from '../store.js';
import { config, captureEndpoint } from '../api.js';
import { kindLabel, sideLabel, KIND_LABEL } from '../ui.js';

const GROUPS = { pay: ['cash', 'card', 'loan'], exp: ['expense'], inc: ['income'], oth: ['receivable', 'payable', 'stock', 'investment'] };
const KIND_HELP = {
  cash: 'Debit account: your own money. It goes up when money comes in and down when you pay.',
  card: 'Credit account: money you owe the bank. The debt goes up when you pay with it and down when you pay it off.',
  loan: 'Credit account: money you owe. It goes up when the loan is paid out and down with each principal payment.',
  expense: 'Debit account: spending. Everything booked here counts as spend in the month it is recognised.',
  income: 'Credit account: money you earn. It never counts as spending.',
  receivable: 'Debit account: money others owe you. Not spending; it stays on your balance sheet until collected.',
  payable: 'Credit account: money you owe to people. Use it as the payment method when someone pays for you.',
  stock: 'Debit account: things bought in bulk. Buying is not spending; using them is.',
  investment: 'Debit account: holdings at cost. Buying is not spending.'
};
const ROLES = { expense: [['', 'None'], ['reconcile', 'Reconciliation differences'], ['fees', 'Fees and commissions']], income: [['', 'None'], ['reconcile_gain', 'Reconciliation gains'], ['invest_gain', 'Investment gains']] };

/* ---------- add / edit an account or category ---------- */
function AccDlg({ m, acc, group, close }) {
  const isNew = !acc, kinds = GROUPS[group];
  const [f, setF] = useState(() => acc ? {
    name: acc.name, kind: acc.kind, group_name: acc.group_name || '', restricted: !!acc.restricted, excluded: !!acc.excluded, archived: !!acc.archived,
    credit_limit: acc.credit_limit == null ? '' : String(acc.credit_limit), statement_day: acc.statement_day || '', due_day: acc.due_day || '',
    per_party: !!acc.per_party, due_mode: acc.due_mode || 'days', due_days: String(acc.due_days || 30), netting: !!acc.netting_group, role: ['opening', 'adjust'].includes(acc.system_key) ? '' : (acc.system_key || ''), opening: ''
  } : { name: '', kind: kinds[0], group_name: '', restricted: false, excluded: false, archived: false, credit_limit: '', statement_day: '', due_day: '', per_party: true, due_mode: 'days', due_days: '30', netting: true, role: '', opening: '' });
  const [run, busy, err] = useAct(), [del, setDel] = useState(false);
  const s = (k, v) => setF(p => ({ ...p, [k]: v }));
  const k = f.kind, groups = [...new Set(m.accounts.filter(a => a.kind === 'expense' && a.group_name).map(a => a.group_name))];
  const dayIn = (v, key) => NumIn(v, x => s(key, x.replace(/\D/g, '').slice(0, 2)), { placeholder: '1–31', inputMode: 'numeric' });
  const save = () => run(async () => {
    if (!f.name.trim()) throw new Error('Name is required.');
    const day = v => { if (v === '' || v == null) return null; const n = Number(v); if (!(n >= 1 && n <= 31)) throw new Error('Days must be between 1 and 31.'); return n; };
    const p = { name: f.name.trim(), kind: k, archived: f.archived };
    if (acc) p.id = acc.id;
    if (k === 'cash') p.restricted = f.restricted;
    if (k === 'card') { p.credit_limit = f.credit_limit === '' ? null : num(f.credit_limit); p.statement_day = day(f.statement_day); p.due_day = day(f.due_day); }
    if (k === 'expense') { p.group_name = f.group_name.trim(); p.excluded = f.excluded; }
    if (k === 'expense' || k === 'income') p.system_key = f.role;
    if (k === 'receivable' || k === 'payable') { p.per_party = f.per_party; p.due_mode = k === 'receivable' ? f.due_mode : 'days'; p.due_days = Math.max(1, Math.round(num(f.due_days) || 30)); p.netting_group = f.netting && f.per_party ? 'social' : ''; }
    if (isNew && ['cash', 'card', 'loan'].includes(k) && f.opening.trim() !== '' && num(f.opening) !== 0) p.opening = { amount: num(f.opening), date: m.today };
    await saveAccount(p);
    say(t('Saved ✓')); close();
  });
  const remove = () => run(async () => { const mode = await deleteAccount(acc.id); say(mode === 'archived' ? t('It has transactions, so it was archived instead of deleted.') : t('Deleted ✓')); close(); });
  return h(Dlg, { title: isNew ? t('Add') : acc.name, onClose: close },
    F(t('Name'), In(f.name, v => s('name', v), { autoCapitalize: 'words' })),
    kinds.length > 1 ? F(t('Type'), h(Dd, { v: k, on: v => s('kind', v), disabled: !isNew, opts: kinds.map(x => ({ v: x, l: t(KIND_LABEL[x]), k: t(isDebitKind(x) ? 'Debit' : 'Credit') })) })) : null,
    h('div.help', null, t(KIND_HELP[k])),
    k === 'cash' ? h(Frag, null,
      isNew ? F(t("Today's balance (₺)"), NumIn(f.opening, v => s('opening', v), { placeholder: '0' })) : null,
      h('div.tg', null, h('div', null, h('b', null, t('Meal card or other restricted balance')), h('span.help', t('Shown, but left out of Cash and of the net cash position.'))), h(Sw, { on: f.restricted, set: v => s('restricted', v), label: t('Restricted balance') }))) : null,
    k === 'card' ? h(Frag, null,
      isNew ? F(t("Today's total debt (₺)"), NumIn(f.opening, v => s('opening', v), { placeholder: '0' }), t('What the bank shows as total debt, future instalments included.')) : null,
      F(t('Card limit (₺)'), NumIn(f.credit_limit, v => s('credit_limit', v), { placeholder: t('Optional') })),
      h('div.row', null, F(t('Statement cut-off day'), dayIn(f.statement_day, 'statement_day')), F(t('Payment due day'), dayIn(f.due_day, 'due_day')))) : null,
    k === 'loan' && isNew ? F(t('Remaining debt today (₺)'), NumIn(f.opening, v => s('opening', v), { placeholder: '0' })) : null,
    k === 'expense' ? h(Frag, null,
      F(t('Group on the income statement'), h('div', null, In(f.group_name, v => s('group_name', v), { placeholder: t('Optional, e.g. Essentials'), list: 'dl-grp' }), h('datalist', { id: 'dl-grp' }, groups.map(g => h('option', { key: g, value: g }))))),
      h('div.tg', null, h('div', null, h('b', null, t('Leave out of normalized spend')), h('span.help', t('For costs you do not want in your normal month, like interest.'))), h(Sw, { on: f.excluded, set: v => s('excluded', v), label: t('Leave out of normalized spend') }))) : null,
    ROLES[k] ? F(t('Used by the app for'), h(Dd, { v: f.role, on: v => s('role', v), opts: ROLES[k].map(([v, l]) => ({ v, l: t(l) })) }), t('One category per role. Picking a role here takes it from the category that had it.')) : null,
    k === 'receivable' || k === 'payable' ? h(Frag, null,
      h('div.tg', null, h('div', null, h('b', null, t('Track per person')), h('span.help', t('Each entry asks who it is. Off = one running total.'))), h(Sw, { on: f.per_party, set: v => s('per_party', v), label: t('Track per person') })),
      k === 'receivable' ? F(t('Due'), h(Dd, { v: f.due_mode, on: v => s('due_mode', v), opts: [{ v: 'days', l: t('A number of days after the transaction') }, { v: 'statement', l: t('At the next cut-off of the card that paid') }] })) : null,
      F(k === 'receivable' && f.due_mode === 'statement' ? t('Days (when not paid by card)') : t('Days until due'), NumIn(f.due_days, v => s('due_days', v.replace(/\D/g, '').slice(0, 3)), { inputMode: 'numeric' })),
      f.per_party ? h('div.tg', null, h('div', null, h('b', null, t('Net against the other side')), h('span.help', t('What a person owes you and what you owe them offset each other.'))), h(Sw, { on: f.netting, set: v => s('netting', v), label: t('Net against the other side') })) : null) : null,
    !isNew ? h('div.tg', null, h('div', null, h('b', null, t('Archived')), h('span.help', t('Hidden from pickers; history and balances stay.'))), h(Sw, { on: f.archived, set: v => s('archived', v), label: t('Archived') })) : null,
    h(Er, { e: err }),
    h('div.row', { style: { marginTop: 16 } },
      !isNew && !['opening', 'adjust'].includes(acc.system_key) ? h('button.btn.gh', { disabled: busy, style: { color: 'var(--rd)' }, onClick: () => setDel(true) }, t('Delete')) : h('button.btn.gh', { onClick: close }, t('Cancel')),
      h('button.btn', { disabled: busy, onClick: save }, busy ? t('Saving...') : t('Save'))),
    del ? h(Confirm, { title: tf('Delete "{0}"?', acc.name), text: t('If it has transactions it is archived instead, so your history stays intact.'), yes: t('Delete'), danger: true, busy, onYes: remove, onNo: () => setDel(false) }) : null);
}

function Accounts({ m }) {
  const [g, setG] = useState('pay'), [dlg, setDlg] = useState(null), [pick, setPick] = useState(null), [arch, setArch] = useState(false);
  const B = balances(m), all = accountsOf(m, GROUPS[g], true), list = all.filter(a => arch || !a.archived), nArch = all.filter(a => a.archived).length;
  const detail = a => {
    const b = B.byId.get(a.id), bits = [kindLabel(a)];
    if (a.kind === 'cash' || a.kind === 'loan' || a.kind === 'receivable' || a.kind === 'payable' || a.kind === 'stock' || a.kind === 'investment') bits.push(tl(b.posted, 0));
    if (a.kind === 'card') { bits.push(tf('debt {0}', tl(b.total, 0))); if (a.statement_day) bits.push(tf('cut-off day {0}', a.statement_day)); }
    if (a.restricted) bits.push(t('restricted'));
    if (a.excluded) bits.push(t('excluded'));
    if (a.group_name) bits.push(a.group_name);
    if (a.system_key && !['opening', 'adjust'].includes(a.system_key)) bits.push(t({ reconcile: 'Reconciliation differences', fees: 'Fees and commissions', reconcile_gain: 'Reconciliation gains', invest_gain: 'Investment gains' }[a.system_key] || ''));
    if (a.archived) bits.push(t('Archived'));
    return bits.filter(Boolean).join(' · ');
  };
  return h(Frag, null,
    h(Pills, { v: g, set: setG, o: [['pay', t('Payment methods')], ['exp', t('Expense categories')], ['inc', t('Income categories')], ['oth', t('Receivables & other')]] }),
    h('div.card', null,
      h('div.fx', null, h('div.grow.lb', null, tf('{0} items', list.length)), h('button.sb', { onClick: () => setDlg({ acc: null }) }, '+ ' + t('Add'))),
      list.map(a => h('div.acc-row', { key: a.id, style: { opacity: a.archived ? 0.55 : 1 } },
        h('button.emb', { type: 'button', 'aria-label': t('Pick an emoji'), onClick: () => setPick(a) }, a.emoji ? h('span.em', a.emoji) : '+'),
        h('div.nm', null, h('b', null, a.name), h('small', null, detail(a))),
        h('span', { className: cx('tagk', a.normal_side === 'credit' ? 'cr' : 'db') }, sideLabel(a)),
        h('button.sb.sm', { onClick: () => setDlg({ acc: a }) }, t('Edit')))),
      !list.length ? h('div.help', null, t('Nothing here yet.')) : null,
      nArch ? h('button.linkb', { style: { marginTop: 10, fontSize: 12 }, onClick: () => setArch(!arch) }, arch ? t('Hide archived') : tf('Show archived ({0})', nArch)) : null),
    h('div.help', null, t('Debit / Credit is set by the type and means the same thing everywhere: Debit accounts hold what you have or spend, Credit accounts hold what you owe or earn. Every entry debits one side and credits the other by the same amount.')),
    dlg ? h(AccDlg, { m, acc: dlg.acc, group: g, close: () => setDlg(null) }) : null,
    pick ? h(EmPicker, { title: pick.name, current: pick.emoji || '', onNo: () => setPick(null), onPick: async e => { setPick(null); try { await saveAccount({ id: pick.id, name: pick.name, emoji: e }); } catch (z) { say(terr(z), true); } } }) : null);
}

/* ---------- automatic capture ---------- */
function CapRow({ a }) {
  const [f, setF] = useState({ ch: a.capture_channel || 'none', last4: a.capture_last4 || '', from: a.capture_sender || '' }), [run, busy, err] = useAct();
  const dirty = f.ch !== (a.capture_channel || 'none') || f.last4 !== (a.capture_last4 || '') || f.from !== (a.capture_sender || '');
  const save = () => run(async () => { await saveAccount({ id: a.id, name: a.name, capture_channel: f.ch, capture_last4: f.last4, capture_sender: f.from.trim() }); say(t('Saved ✓')); });
  return h('div.cap', null,
    h('div.cap-h', null, h('b', null, a.name), h('div', { style: { width: 130 } }, h(Dd, { v: f.ch, on: v => setF({ ...f, ch: v }), opts: [{ v: 'none', l: t('None') }, { v: 'sms', l: 'SMS' }, { v: 'email', l: t('E-mail') }] }))),
    f.ch !== 'none' ? h('div.row', null,
      F(t('Last 4 digits'), In(f.last4, v => setF({ ...f, last4: v.replace(/\D/g, '').slice(0, 4) }), { inputMode: 'numeric', placeholder: '1234' })),
      F(f.ch === 'sms' ? t('SMS sender') : t('E-mail sender'), In(f.from, v => setF({ ...f, from: v }), { placeholder: f.ch === 'sms' ? 'QNB' : 'bilgi@banka.com.tr', autoCapitalize: 'none' }))) : null,
    h(Er, { e: err }),
    dirty ? h('button.sb.ok', { style: { marginTop: 8 }, disabled: busy, onClick: save }, busy ? t('Saving...') : t('Save')) : null);
}
function Capture({ m }) {
  const S = useStore(), token = S.data.capture_token || '', [run, busy] = useAct(), [ask, setAsk] = useState(false);
  const body = '{ "p_token": "' + token + '", "p_text": "(message text)", "p_sender": "(sender)", "p_channel": "sms" }';
  return h(Frag, null,
    h('div.card', null, h('div.lb', t('Which accounts send messages?')),
      h('div.help', null, t('Messages are matched to an account by the last 4 card digits, then by sender.')),
      accountsOf(m, ['cash', 'card']).map(a => h(CapRow, { key: a.id, a }))),
    h('div.card', null, h('div.lb', t('iPhone: send bank SMS to Diligence')),
      h('ol.steps', null,
        h('li', null, t('Shortcuts app > Automation > New > Message. Set "Message contains" to a word your bank always uses (e.g. TL) and choose "Run immediately".')),
        h('li', null, t('Add the action "Get contents of URL". URL:'), h('div.codebox', null, captureEndpoint())),
        h('li', null, t('Method POST. Add a header:'), h('div.codebox', null, 'apikey: ' + (config.supabaseKey || ''))),
        h('li', null, t('Request body JSON, with p_text set to the "Shortcut Input" (the message):'), h('div.codebox', null, body))),
      h('div.help', null, t('The message waits under the bell icon until you give it a category. Nothing is booked automatically.')),
      h('button.sb', { style: { marginTop: 10 }, disabled: busy, onClick: () => setAsk(true) }, t('Make a new secret token'))),
    h('div.card', null, h('div.lb', t('Bank e-mails (Gmail)')),
      h('div.help', { style: { marginTop: 6 } }, t('Use the small Google Apps Script in extras/gmail-forwarder.gs: it checks Gmail every 15 minutes and sends new bank mails to the same address. Paste your token and the sender addresses into it.'))),
    ask ? h(Confirm, { title: t('Make a new secret token?'), text: t('The old token stops working at once. Update your Shortcut and the Gmail script with the new one.'), yes: t('New token'), busy, onYes: () => run(async () => { await rotateCaptureToken(); setAsk(false); say(t('New token ready ✓')); }), onNo: () => setAsk(false) }) : null);
}

/* ---------- backup, account ---------- */
function Data({ m }) {
  const S = useStore(), inp = useRef(null), [ask, setAsk] = useState(null), [run, busy, err, setErr] = useAct();
  const download = () => {
    const blob = new Blob([JSON.stringify(exportBundle())], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'diligence-backup-' + m.today + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const pick = async file => {
    setErr('');
    try {
      const b = JSON.parse(await file.text());
      if (!b || !Array.isArray(b.accounts) || !Array.isArray(b.entries)) throw new Error('This is not a Diligence backup file');
      setAsk({ type: 'import', bundle: b });
    } catch (e) { setErr(/JSON/.test(String(e && e.message)) ? t('This is not a Diligence backup file') : terr(e)); }
  };
  const real = m.entries.length;
  return h(Frag, null,
    h('div.card', null, h('div.lb', t('Backup')),
      h('div.help', null, t('One file with everything: accounts, transactions, marks, budget, settings.')),
      h('div.row', { style: { marginTop: 10 } }, h('button.btn.gh', { onClick: download }, t('Download a backup')), h('button.btn.gh', { disabled: busy, onClick: () => inp.current.click() }, t('Load a backup'))),
      h('input', { ref: inp, type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) pick(f); } }),
      h(Er, { e: err })),
    h('div.card', null, h('div.lb', t('Account')),
      h('div.kv', null, h('span', null, t('Signed in as')), h('b', null, S.user ? S.user.email : '')),
      h('div.kv', null, h('span', null, t('In your ledger')), h('b', null, tf('{0} entries · {1} accounts', real, m.accounts.length))),
      h('div.row', { style: { marginTop: 12 } }, h('button.btn.gh', { onClick: signOut }, t('Sign out')), h('button.btn.gh', { style: { color: 'var(--rd)' }, onClick: () => setAsk({ type: 'wipe' }) }, t('Delete all my data'))),
      h('div.help', null, t('To change your password, sign out and use "Forgot your password?".'))),
    ask && ask.type === 'import' ? h(Confirm, { title: t('Load this backup?'), busy, error: err, danger: real > 0,
      text: tf('The file has {0} entries and {1} accounts.', ask.bundle.entries.length, ask.bundle.accounts.length) + ' ' + (real > 0 ? tf('It REPLACES everything in this account ({0} entries). Download a backup first if you are not sure.', real) : t('It will be loaded into this account.')),
      yes: real > 0 ? t('Replace my data') : t('Load'), onNo: () => setAsk(null),
      onYes: () => run(async () => { const r = await importBundle(ask.bundle, true); setAsk(null); say(tf('Loaded {0} entries ✓', r.entries)); }) }) : null,
    ask && ask.type === 'wipe' ? h(Confirm, { title: t('Delete all my data?'), danger: true, busy, error: err, text: t('Every account, category and transaction is removed and you start again with the starter set. This cannot be undone.'), yes: t('Delete everything'), onNo: () => setAsk(null),
      onYes: () => run(async () => { await wipe(); setAsk(null); say(t('Deleted ✓')); }) }) : null);
}

function Look() {
  const set = p => saveSettings(p);
  return h(Frag, null,
    h('div.card', null,
      F(t('Language'), h(Pills, { v: PREF.lang, set: v => set({ lang: v }), o: [['en', 'English'], ['tr', 'Türkçe']] })),
      F(t('Theme'), h(Pills, { v: PREF.theme, set: v => set({ theme: v }), o: [['system', t('System')], ['light', t('Light')], ['dark', t('Dark')]] }), PREF.theme === 'system' ? t('Follows your device setting.') : null),
      F(t('Glass'), h('div', null, h('input.rg', { type: 'range', min: 0, max: 100, step: 5, value: PREF.glass, 'aria-label': t('Glass'), onChange: e => set({ glass: Number(e.target.value) }) }), h('div.rgl', null, h('span', null, t('Clear')), h('span', null, PREF.glass + '%'), h('span', null, t('Solid'))))),
      F(t('Decimals'), h(Pills, { v: PREF.dec, set: v => set({ dec: v }), o: [[0, '1.234'], [1, '1.234,5'], [2, '1.234,56']] })),
      F(t('Currency symbol'), In(PREF.cur, v => set({ cur: v.slice(0, 4) || '₺' }), { style: { maxWidth: 120 } }))),
    h('div.help', null, t('Settings are saved to your account, so they follow you to every device.')));
}

export function Settings({ m, back }) {
  const [v, setV] = useState('acc');
  return h(Pg, { title: t('Settings'), back },
    h(Pills, { v, set: setV, o: [['acc', t('Accounts & categories')], ['look', t('Customize')], ['cap', t('Automatic capture')], ['data', t('Backup & account')]] }),
    v === 'acc' ? h(Accounts, { m }) : v === 'look' ? h(Look) : v === 'cap' ? h(Capture, { m }) : h(Data, { m }));
}
