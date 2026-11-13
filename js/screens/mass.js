// mass.js - Mass entry: import a bank statement in three steps (import, review, save).
// The file is read on the device (statement.js). Only the lines the user keeps are saved, all in one transaction.
import { h, React, useState, useRef, Frag, Pg, F, In, DateIn, Dd, Sw, Er, Ic, Dlg, Confirm, cx } from '../lib.js';
import { MX } from '../statement.js';
import { accountsOf, merchantHistory, parties, natural, addMonths, r2, uid, systemAccount } from '../engine.js';
import { postExpense, postIncome, postTransfer } from '../posting.js';
import { t, tf, tl, mname, terr } from '../prefs.js';
import { saveEntries, saveSettings, say } from '../store.js';

const mxDate = s => { const p = String(s).split('-'); return p.length === 3 ? p[2] + ' ' + mname(+p[1] - 1) : s; };
const MxSteps = ({ n }) => h('div.mx-stp', null, [t('Import'), t('Review'), t('Save')].map((l, i) => h('div', { key: l, className: cx('mx-st', i + 1 < n ? 'dn' : i + 1 === n ? 'on' : '') }, (i + 1) + ' · ' + l)));

// everything the reader needs to know about the chosen account, taken from the ledger already in memory
function context(m, pmAcc, from, to) {
  const lo = addMonths(from, -4), hi = addMonths(to, 37), rows = [], tr = { into: {}, out: {} };
  for (const e of m.entries) {
    const mine = e.lines.filter(l => l.acc === pmAcc.id);
    if (!mine.length) continue;
    const cat = e.lines.map(l => m.acc.get(l.acc)).find(a => a && (a.kind === 'expense' || a.kind === 'income' || a.kind === 'receivable'));
    for (const l of mine) if (l.date >= lo && l.date <= hi) rows.push({ id: e.ref || e.id, d: l.date, f: natural(pmAcc, l.amt), pos: e.merchant || '', c1: cat ? cat.name : '', desc: e.note || '' });
    if (e.kind === 'transfer' && e.lines.length === 2) {
      const other = m.acc.get(e.lines.find(l => l.acc !== pmAcc.id).acc);
      if (other) { const side = mine[0].amt > 0 ? tr.into : tr.out; side[other.name] = (side[other.name] || 0) + 1; }
    }
  }
  return { rows, transfers: tr, merchants: merchantHistory(m), rules: (m.data.rules || []).map(r => ({ k: r.k, c: (m.acc.get(r.acc) || {}).name })).filter(r => r.c) };
}

export function Mass({ m, back, go }) {
  const money = accountsOf(m, ['cash', 'card']), others = accountsOf(m, ['cash', 'card', 'loan']);
  const pms = money.map(a => a.name), byName = new Map(others.map(a => [a.name, a]));
  const expA = accountsOf(m, ['expense', 'receivable']), incA = accountsOf(m, ['income']);
  const exp = expA.map(a => a.name), inc = incA.map(a => a.name), expId = new Map(expA.map(a => [a.name, a])), incId = new Map(incA.map(a => [a.name, a]));
  const cc = expA.filter(a => a.per_party).map(a => a.name);
  const fallbackA = systemAccount(m, 'reconcile') || accountsOf(m, ['expense']).slice(-1)[0], feeA = systemAccount(m, 'fees');
  const interestA = accountsOf(m, ['expense']).find(a => /^(faiz|interest)/i.test(a.name));
  const fallback = fallbackA ? fallbackA.name : '', fallbackInc = (systemAccount(m, 'reconcile_gain') || incA.slice(-1)[0] || {}).name || '';
  const ptype = p => (byName.get(p) && byName.get(p).kind !== 'cash' ? 'credit' : 'debit');
  const ST = m.data.settings || {};
  const [step, setStep] = useState('import'), [file, setFile] = useState(null), [pm, setPm] = useState(''), [det, setDet] = useState(''), [err, setErr] = useState(''), [perr, setPerr] = useState('');
  const [prog, setProg] = useState(0), [res, setRes] = useState(null), [rows, setRows] = useState([]), [purch, setPurch] = useState([]), [filter, setFilter] = useState('all'), [snap, setSnap] = useState([]);
  const [coach, setCoach] = useState(!ST.mxCoach), [sheet, setSheet] = useState(null), [similar, setSimilar] = useState(null), [rules, setRules] = useState([]), [busy, setBusy] = useState(false), [result, setResult] = useState(null);
  const parseRef = useRef(null), inp = useRef(null);
  const caris = parties(m);

  function pick(f) {
    if (!f) return;
    setErr(''); setPerr(''); setFile(f); setDet('');
    const p = MX.read(f); parseRef.current = p;
    p.then(r => {
      if (parseRef.current !== p) return;
      let d = '';
      const k4 = r.meta && r.meta.last4, m4 = ST.mxLast4 || {};
      if (k4 && pms.includes(m4[k4])) d = m4[k4];
      if (!d && k4) { const hit = money.filter(a => a.capture_last4 === k4); if (hit.length === 1) d = hit[0].name; }
      if (!d) d = MX.detectPm(r, pms);
      if (d) { setDet(d + (k4 ? ' · •••• ' + k4 : '')); setPm(x => x || d); }
    }).catch(e => { if (parseRef.current === p) setPerr(terr(e)); });
  }
  async function start() {
    setErr(''); setStep('load'); setProg(0.12);
    try {
      const r = await parseRef.current; setProg(0.5);
      const ds = r.rows.map(x => x.d).sort(), acc = byName.get(pm);
      const ctx = context(m, acc, ds[0], ds[ds.length - 1]); setProg(0.85);
      const b = MX.build(r, { pm, credit: ptype(pm) === 'credit', ctx, exp, inc, pms: others.map(a => a.name).filter(p => p !== pm).concat([pm]), fallbackExp: fallback, fallbackInc, feeCat: feeA ? feeA.name : '', interestCat: interestA ? interestA.name : '' });
      setRes({ ...r, ctx }); setRows(b.rows); setPurch(b.purch); setFilter('all'); setSnap([]); setSimilar(null); setRules([]); setProg(1);
      setTimeout(() => { setStep('review'); window.scrollTo(0, 0); }, 250);
    } catch (e) { setErr(terr(e)); setStep('import'); }
  }
  const up = (id, patch) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r)));
  const isDup = r => !!r.dup && !r.inc, active = r => !r.removed && !isDup(r), isExp = r => r.kind !== 'tr';
  const needCari = r => r.kind !== 'tr' && cc.includes(r.cat) && !String(r.cari || '').trim();
  const autoSrc = r => r.src === 'rule' || r.src === 'history';
  const act = rows.filter(active), nDup = rows.filter(r => !r.removed && isDup(r)).length;
  const cnt = { all: rows.filter(r => !r.removed).length, auto: act.filter(r => isExp(r) && autoSrc(r)).length, sort: act.filter(r => isExp(r) && r.src === 'none').length, dup: nDup };
  const outSum = act.filter(r => r.dirOut && r.kind !== 'tr').reduce((s, r) => s + r.a, 0), inSum = act.filter(r => !r.dirOut && r.kind !== 'tr').reduce((s, r) => s + r.a, 0), nTr = act.filter(r => r.kind === 'tr').length;
  const shown = rows.filter(r => { if (r.removed) return false; if (filter === 'auto') return active(r) && isExp(r) && autoSrc(r); if (filter === 'sort') return active(r) && snap.includes(r.id); if (filter === 'dup') return isDup(r); return true; });
  const setFilt = f => { setFilter(f); setSimilar(null); setSnap(rows.filter(r => active(r) && isExp(r) && r.src === 'none').map(r => r.id)); };
  function remove(r) { up(r.id, { removed: true }); setSimilar(null); say(tf('Removed {0}', r.n)); }
  function setVal(r, v) {
    if (v.indexOf('t:') === 0) { up(r.id, { kind: 'tr', acct: v.slice(2), src: 'manual', link: null }); setSimilar(null); return; }
    const c = v.slice(2), kind = r.dirOut ? 'exp' : (ptype(pm) === 'credit' || r.kind === 'ret' ? 'ret' : 'inc');
    const wasNone = r.src === 'none'; up(r.id, { cat: c, kind: r.kind === 'tr' ? kind : r.kind, src: 'manual' });
    const o = wasNone && r.key ? rows.filter(x => x.id !== r.id && x.key === r.key && !x.removed && x.src === 'none' && x.cat !== c && x.dirOut === r.dirOut).map(x => x.id) : [];
    setSimilar(o.length ? { id: r.id, ids: o, cat: c, key: r.key } : (r.key && wasNone ? { id: r.id, ids: [], cat: c, key: r.key, rule: true } : null));
    if (cc.includes(c) && !r.cari) openEdit({ ...r, cat: c });
  }
  function applySimilar() { const s = similar; setRows(rs => rs.map(r => (s.ids.includes(r.id) ? { ...r, cat: s.cat, src: 'manual' } : r))); setRules(x => x.filter(z => z.k !== s.key).concat([{ k: s.key, c: s.cat }])); say(tf('Rule saved: {0} → {1}', s.key, s.cat)); setSimilar(null); }
  function openEdit(r) { setSheet({ kind: 'edit', id: r.id, f: { n: r.n, desc: r.desc || '', a: String(r.a), d: r.d, cari: r.cari || '', rl: !!r.rl, rd: r.rd || r.d }, cari: cc.includes(r.cat), err: '' }); }
  function saveEdit() {
    const s = sheet, f = s.f, a = Number(String(f.a).replace(',', '.'));
    if (!(a > 0)) return setSheet({ ...s, err: t('Amount must be a positive number.') });
    if (!f.n.trim()) return setSheet({ ...s, err: t('Business name is required.') });
    if (s.cari && !f.cari.trim()) return setSheet({ ...s, err: t('Cari is required for receivable / payable categories.') });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.d)) return setSheet({ ...s, err: t('Transaction date is required.') });
    up(s.id, { n: f.n.trim(), desc: f.desc.trim(), a: Math.round(a * 100) / 100, d: f.d, cari: f.cari.trim(), rl: f.rl, rd: f.rl ? f.rd : '' }); setSheet(null);
  }
  function openLink(r) { const sg = r.sug; setSheet({ kind: 'link', id: r.id, type: r.link ? r.link.type : sg ? sg.type : (r.dirOut ? 'inst' : 'refund'), to: r.link ? r.link.to : sg ? sg.to : null, q: '' }); }
  function applyLink(id, type, to) {
    setRows(rs => rs.map(r => {
      if (r.id !== id) return r;
      const n = { ...r, link: { type, to }, sug: null };
      if (type === 'refund') { n.kind = 'ret'; if (to.cat && exp.includes(to.cat)) { n.cat = to.cat; if (n.src === 'none') n.src = 'manual'; } }
      else if (to.cat && exp.includes(to.cat) && n.src === 'none') { n.cat = to.cat; n.src = 'manual'; }
      return n;
    })); setSheet(null);
  }
  // the kept lines -> balanced ledger entries
  function toEntries(items) {
    const pmAcc = byName.get(pm), info = {}, out = [];
    const ordered = items.filter(x => !(x.link && x.link.imp)).concat(items.filter(x => x.link && x.link.imp));
    for (const x of ordered) {
      try {
        if (x.type === 'transfer') { out.push(postTransfer(m, { date: x.date, from: byName.get(x.from).id, to: byName.get(x.to).id, amount: x.amount, note: x.desc, src: 'import' })); continue; }
        const cat = (x.type === 'income' ? incId : expId).get(x.cat);
        if (!cat) throw new Error('Category is required.');
        let ref = null, rdate = x.rec || x.date;
        if (x.link) {
          const p = x.link.imp ? info[x.link.imp] : (() => { const e = m.byId.get(x.link.mv); return e ? { id: e.id, rdate: e.rdate } : null; })();
          if (!p) throw new Error('The linked line is not part of this import.');
          ref = p.id; rdate = p.rdate;
        }
        const party = cat.per_party ? { party: x.cari } : {};
        let e;
        if (x.type === 'return') {
          e = { id: uid(), kind: 'return', date: x.date, rdate, merchant: x.pos, note: x.desc || t('Return'), n: 1, src: 'import', lines: [{ acc: pmAcc.id, amt: x.amount, date: x.date }, { acc: cat.id, amt: -x.amount, date: rdate, ...party }] };
        } else if (x.type === 'income') {
          e = postIncome(m, { date: x.date, rdate, pay: pmAcc.id, merchant: x.pos, note: x.desc, acc: cat.id, amount: x.amount, src: 'import' });
        } else if (x.inst && !x.link && x.inst.of >= 2 && x.inst.no >= 1 && x.inst.no <= x.inst.of) {
          // statement shows instalment no/of: save the instalments that are still to come from this one on, as one purchase
          const n = x.inst.of - x.inst.no + 1, lines = [{ acc: cat.id, amt: r2(x.amount * n), date: rdate, ...party }];
          for (let k = x.inst.no; k <= x.inst.of; k++) lines.push({ acc: pmAcc.id, amt: -x.amount, date: addMonths(x.date, k - 1) });
          e = { id: uid(), kind: 'expense', date: x.date, rdate, merchant: x.pos, note: x.desc || '', n, src: 'import', lines };
        } else {
          e = postExpense(m, { date: x.date, rdate, pay: pmAcc.id, merchant: x.pos, note: x.desc, party: x.cari, splits: [{ acc: cat.id, amount: x.amount }], src: 'import' });
        }
        if (ref) e.ref = ref;
        if (x.key) info[x.key] = { id: e.id, rdate: e.rdate };
        out.push(e);
      } catch (z) { throw new Error(tf('Line "{0}": {1}', x.label, terr(z))); }
    }
    return out;
  }
  async function save() {
    const bad = rows.filter(r => active(r) && needCari(r));
    if (bad.length) { say(tf('Add a person to {0} line(s) first', bad.length), true); setFilter('all'); openEdit(bad[0]); return; }
    const badTr = rows.filter(r => active(r) && r.kind === 'tr' && (!r.acct || r.acct === pm));
    if (badTr.length) { say(t('Choose the other account for each transfer.'), true); return; }
    setBusy(true);
    try {
      const items = MX.payload(rows, pm), entries = toEntries(items);
      await saveEntries(entries, rules.map(r => ({ k: r.k, acc: (expId.get(r.c) || incId.get(r.c) || {}).id })).filter(r => r.acc));
      const k4 = res && res.meta && res.meta.last4;
      if (k4) saveSettings({ mxLast4: { ...(ST.mxLast4 || {}), [k4]: pm } });
      setResult({ lines: items.length, entries: entries.length, exp: act.filter(x => x.kind === 'exp').length, inc: act.filter(x => x.kind === 'inc' || x.kind === 'ret').length, tr: nTr, auto: act.filter(x => isExp(x) && autoSrc(x)).length, manual: act.filter(x => x.src === 'manual').length,
        other: act.filter(x => isExp(x) && x.cat === fallback).length, linked: act.filter(x => x.link).length, removed: rows.filter(x => x.removed).length, dups: nDup, out: outSum, inn: inSum });
      setStep('done'); window.scrollTo(0, 0);
    } catch (e) { say(terr(e), true); } finally { setBusy(false); }
  }
  function reset() { setStep('import'); setFile(null); setPm(''); setDet(''); setRes(null); setRows([]); setResult(null); setErr(''); setPerr(''); parseRef.current = null; window.scrollTo(0, 0); }

  /* --- import --- */
  if (step === 'import') {
    const ok = !!file && !!pm && !perr, kb = file ? file.size / 1024 : 0;
    return h(Pg, { title: t('Mass entry'), back, sub: t('Step 1 of 3 · Import') }, h(MxSteps, { n: 1 }), h(Er, { e: err }),
      h('input', { ref: inp, type: 'file', accept: '.pdf,.csv,.xls,.xlsx,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', style: { display: 'none' }, onChange: e => { pick(e.target.files && e.target.files[0]); e.target.value = ''; } }),
      h('div.card', null, h('div.lb', t('Statement file')),
        file ? h('div.mx-file', null, h('span.mx-fic', null, h(Ic, { n: 'file', s: 20 })), h('div.mx-fn', null, h('b', null, file.name), h('span.mono', kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(kb)) + ' KB')),
          h('button.sb', { onClick: () => inp.current.click() }, t('Replace')), h('button.mx-xb', { 'aria-label': t('Remove file'), onClick: () => { setFile(null); setDet(''); setPerr(''); parseRef.current = null; } }, h(Ic, { n: 'x', s: 14 })))
          : h('div.mx-drop', null, h('span.mx-uic', null, h(Ic, { n: 'up', s: 20 })), h('b', null, t('Choose your bank statement')), h('span.help', { style: { margin: 0 } }, t('Downloaded from your bank app or internet banking.')),
            h('div.mx-ext', null, ['PDF', 'CSV', 'XLS', 'XLSX'].map(x => h('span', { key: x }, x))),
            h('button.btn', { style: { marginTop: 10, width: '100%' }, onClick: () => inp.current.click() }, t('Choose file'))),
        perr ? h('div.err', perr) : null,
        det && !perr ? h('div.mx-det', null, h('span.tag', t('Detected')), h('span', null, det)) : null,
        h('div.help', null, t('The file is read on this phone and never uploaded. Only the lines you save go to your account.'))),
      h('div.card', null, h('div.lb', t('Which account is it for?')),
        h('div.fld', { style: { marginTop: 8 } }, h(Dd, { v: pm, on: setPm, ph: t('Choose an account'), opts: money.map(a => ({ v: a.name, l: a.name, e: a.emoji || '', k: t(a.kind === 'card' ? 'Credit' : 'Debit') })) })),
        h('div.help', null, !pm ? t('Every line in the file is added to this account.') : ptype(pm) === 'credit' ? t('Card: purchases become expenses, payments to the card become transfers, refunds are linked to the purchase.') : t('Bank account: money out becomes expenses, money in becomes income. Payments to your cards become transfers.'))),
      h('div.mx-next', null, [t('Every line in the file is read.'), t('Known merchants get a category from your past entries.'), t('Lines already in Diligence are skipped.'), t('You check the list, then save.')].map(x => h('div', { key: x }, h('i'), h('span', null, x)))),
      h('div.row', { style: { marginTop: 18 } }, h('button.btn.gh', { onClick: back }, t('Cancel')), h('button.btn', { disabled: !ok, onClick: start }, t('Import statement'))));
  }

  /* --- loading: just a bar --- */
  if (step === 'load') return h(Pg, { title: t('Mass entry') }, h('div.card.mx-ld', null, h('div.mx-pg', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(prog * 100), 'aria-label': t('Importing') }, h('div', { style: { width: Math.round(prog * 100) + '%' } }))));

  /* --- done --- */
  if (step === 'done') {
    const r = result;
    return h(Pg, { title: t('Saved'), sub: pm + ' · ' + (file ? file.name : '') }, h(MxSteps, { n: 4 }),
      h('div.mx-res', null, h('div.mx-res-a', null, h('span.mono-label', t('Added to your ledger')), h('div.mx-res-n', null, r.lines, h('small', null, ' ' + t('lines')))),
        h('div.mx-res-b', null, h('span', null, t('Entries created')), h('span', null, r.entries))),
      h('div.card', null,
        [[t('Expenses'), r.exp + ' · ' + tl(r.out)], [t('Income and refunds'), r.inc + ' · ' + tl(r.inn)], [t('Transfers'), r.tr], [t('Sorted automatically'), r.auto], [t('Sorted by you'), r.manual], [tf('Still in {0}', fallback), r.other], [t('Linked to another expense'), r.linked], [t('Removed by you'), r.removed], [t('Already in Diligence (skipped)'), r.dups]]
          .map(([a, b]) => h('div.br', { key: a }, h('span', null, a), h('b', null, String(b))))),
      h('div.row', { style: { marginTop: 16 } }, h('button.btn.gh', { onClick: reset }, t('Import another')), h('button.btn', { onClick: () => go('tx') }, t('See transactions'))));
  }

  /* --- review --- */
  const credit = ptype(pm) === 'credit', meta = (res && res.meta) || {};
  const allSum = Math.round(rows.reduce((s, r) => s + (r.dirOut ? r.a : -r.a), 0) * 100) / 100;
  const chk = credit && res && res.kind === 'pdf' && meta.prev != null && meta.debt != null ? Math.round((meta.prev + allSum - meta.debt) * 100) / 100 : null;
  const tagOf = r => (r.kind === 'tr' ? h('span.tag.mx-t-tr', t('Transfer')) : r.src === 'rule' || r.src === 'history' ? h('span.tag', t('Auto')) : r.src === 'manual' ? h('span.tag.mx-t-set', t('Set by you')) : h('span.tag.mx-t-sort', t('To sort')));
  const emo = n => { const a = expId.get(n) || incId.get(n); return a && a.emoji ? a.emoji : ''; };
  const optsFor = r => {
    const cats = r.dirOut || r.kind === 'ret' || credit ? exp : inc;
    const o = cats.map(c => ({ v: 'c:' + c, l: (r.kind === 'ret' ? t('Refund · ') : '') + c, e: emo(c) }));
    others.filter(a => a.name !== pm).forEach(a => o.push({ v: 't:' + a.name, l: (r.dirOut ? '→ ' : '← ') + a.name, k: t('Transfer') }));
    return o;
  };
  const valOf = r => (r.kind === 'tr' ? 't:' + r.acct : 'c:' + r.cat);
  const rowEl = r => {
    const dim = isDup(r), nc = needCari(r), lk = r.link;
    return h('div', { key: r.id, className: cx('mx-ln', dim && 'dim') },
      h('div.mx-l1', null,
        h('button.mx-xb', { 'aria-label': t('Remove') + ' ' + r.n, onClick: () => remove(r) }, h(Ic, { n: 'x', s: 14 })),
        h('div.mx-nm', null, h('b', { title: r.raw }, r.n),
          h('div.mx-sub', null, h('span', null, mxDate(r.d)), dim ? h('span.tag.mx-t-dup', t('In Diligence')) : tagOf(r),
            !dim && r.src !== 'none' && r.why && r.src !== 'manual' ? h('span', null, r.src === 'history' ? r.why : t(r.why)) : null,
            r.inst ? h('span.tag.mx-t-set', tf('Instalment {0}/{1}', r.inst.no, r.inst.of)) : null, r.card ? h('span', null, r.card) : null,
            nc && !dim ? h('span.tag.mx-t-sort', t('Person needed')) : null, r.rl && r.rd ? h('span', null, tf('Recognized {0}', mxDate(r.rd))) : null),
          r.desc ? h('div.mx-sub', { style: { fontFamily: 'var(--sans)', fontSize: 12 } }, r.desc) : null),
        h('div', { className: cx('mx-am', !r.dirOut && 'cr') }, (r.dirOut ? '' : '+') + tl(r.a))),
      dim ? h('div.mx-strip', null, h('span.mx-tx', null, t('Matches') + ' ', h('b', null, r.dup.n || '–'), ' · ' + mxDate(r.dup.d) + ' · ' + tl(r.dup.a)), h('button.sb.sm', { onClick: () => up(r.id, { inc: true }) }, t('Include anyway')))
        : h(Frag, null,
          h('div.mx-l2', null,
            h('button.mx-ib', { 'aria-label': t('Edit') + ' ' + r.n, onClick: () => openEdit(r) }, h(Ic, { n: 'pen', s: 16 })),
            r.kind === 'tr' ? h('span.mx-ibx') : h('button', { className: cx('mx-ib', lk && 'on'), 'aria-label': t('Link') + ' ' + r.n, onClick: () => openLink(r) }, h(Ic, { n: 'chain', s: 16 })),
            h('div', { className: cx('mx-dd', r.src === 'none' && r.kind !== 'tr' && 'todo') }, h(Dd, { v: valOf(r), on: v => setVal(r, v), opts: optsFor(r) }))),
          lk ? h('div.mx-lk', null, h(Ic, { n: 'chain', s: 14 }), h('span', null, tf(lk.type === 'refund' ? 'Refund of {0}' : lk.type === 'inst' ? 'Instalment of {0}' : 'Same purchase as {0}', lk.to.n) + ' · ' + mxDate(lk.to.d) + (lk.to.src === 'mv' ? ' ' + t('(in Diligence)') : '')), h('button', { 'aria-label': t('Remove link'), onClick: () => up(r.id, { link: null }) }, h(Ic, { n: 'x', s: 12 }))) : null,
          r.inst && !lk ? h('div.mx-lk', null, h(Ic, { n: 'stack', s: 14 }), h('span', null, tf('Saves {0} monthly instalments of {1} as one purchase.', r.inst.of - r.inst.no + 1, tl(r.a)))) : null,
          r.kind === 'tr' ? h('div.mx-lk', null, h(Ic, { n: 'arrow', s: 14 }), h('span', null, r.dirOut ? pm + ' → ' + r.acct : r.acct + ' → ' + pm)) : null,
          r.sug && !lk ? h('div.mx-strip', null, h('span.mx-tx', null, t('Looks like a refund of') + ' ', h('b', null, r.sug.to.n), ' (' + mxDate(r.sug.to.d) + ').'), h('button.sb.sm.ok', { onClick: () => applyLink(r.id, 'refund', r.sug.to) }, t('Link')), h('button.sb.sm', { onClick: () => up(r.id, { sug: null }) }, t('Dismiss'))) : null,
          similar && similar.id === r.id ? h('div.mx-strip', null, h('span.mx-tx', null, similar.ids.length ? tf('Put {0} more "{1}" line(s) in {2} and remember it?', similar.ids.length, similar.key, similar.cat) : tf('Remember "{0}" as {1} for next imports?', similar.key, similar.cat)),
            h('button.sb.sm.ok', { onClick: applySimilar }, similar.ids.length ? t('Apply') : t('Remember')), h('button.sb.sm', { onClick: () => setSimilar(null) }, t('Not now'))) : null));
  };
  const tile = (f, cls, lab, n) => h('button', { key: f, className: cx('mx-tl', cls, filter === f && 'sel'), 'aria-pressed': filter === f, onClick: () => setFilt(f) }, h('span.mono-label', lab), h('span.mx-tv', n));
  const editS = sheet && sheet.kind === 'edit' ? sheet : null, linkS = sheet && sheet.kind === 'link' ? sheet : null, abortS = sheet && sheet.kind === 'abort';
  const sf = (k, v) => setSheet(s => ({ ...s, f: { ...s.f, [k]: v } }));
  const lr = linkS ? rows.find(r => r.id === linkS.id) : null;
  const cands = lr ? (() => {
    const q = MX.compact(linkS.q || '');
    return purch.filter(p => !(p.src === 'imp' && p.id === lr.id) && !(p.src === 'imp' && rows.some(x => x.id === p.id && (x.removed || isDup(x)))) && (linkS.type !== 'refund' || p.a >= lr.a - 0.01))
      .filter(p => !q || MX.compact(p.n).indexOf(q) > -1)
      .map(p => ({ ...p, s: (lr.key && p.key && (p.key === lr.key || p.key.indexOf(lr.key) === 0 || lr.key.indexOf(p.key) === 0) ? 2 : 0) + (p.src === 'imp' ? 0.5 : 0) }))
      .sort((a, b) => b.s - a.s || (b.d > a.d ? 1 : -1)).slice(0, 40);
  })() : [];
  const nOther = act.filter(r => isExp(r) && r.cat === fallback).length;
  return h(Frag, null,
    h(Pg, { title: t('Review lines'), sub: pm + ' · ' + (file ? file.name : '') }, h(MxSteps, { n: 2 }),
      coach ? h('div.mx-coach', null, h('span.mono-label', t('How to review')), h('h2', null, t('Check each line before you save')),
        h('div.mx-leg', null, [['x', t('Remove a line you do not want to import.')], ['pen', t('Edit the name, amount, date, note or person.')], ['chain', t('Link a refund or an instalment to another expense.')], ['chev', tf('Pick a category. Auto lines come from your rules and past entries; everything else starts in {0}.', fallback)]].map(([i, x]) => h('div', { key: i }, h('span.mx-k', null, h(Ic, { n: i, s: 14 })), h('span', null, x)))),
        h('button.btn', { onClick: () => { setCoach(false); saveSettings({ mxCoach: true }); } }, t('Got it'))) : null,
      chk !== null ? h('div.card', null, h('div.lb', t('Statement check') + (meta.cut ? ' · ' + tf('cut-off {0}', mxDate(meta.cut)) : '')),
        h('div.br', null, h('span', null, t('Previous balance')), h('b', null, tl(meta.prev))), h('div.br', null, h('span', null, t('Lines on the statement')), h('b', null, (allSum < 0 ? '−' : '+') + tl(Math.abs(allSum)))),
        h('div.br', null, h('span', null, t('Period debt')), h('b', { className: Math.abs(chk) < 0.05 ? 'up' : 'dn' }, tl(meta.debt) + (Math.abs(chk) < 0.05 ? ' ✓' : ''))),
        h('div.help', null, Math.abs(chk) < 0.05 ? t("Every line was read: the lines add up to the statement's own total.") : tf('The lines differ from the statement total by {0}. Some lines may be missing; compare with the PDF before saving.', tl(Math.abs(chk))))) : null,
      nDup ? h('div.ban', null, tf('{0} line(s) are already in Diligence and will be skipped. Each one shows the entry it matches.', nDup)) : null,
      h('div.mx-tiles', { style: { gridTemplateColumns: 'repeat(' + (nDup ? 4 : 3) + ',1fr)' } }, tile('all', 'cy', t('All lines'), cnt.all), tile('auto', 'li', t('Auto-sorted'), cnt.auto), tile('sort', 'co', t('To sort'), cnt.sort), nDup ? tile('dup', 'gr', t('In Diligence'), cnt.dup) : null),
      h('div.card.mx-list', null, shown.length ? shown.map(rowEl) : h('div.help', { style: { padding: '18px 4px', textAlign: 'center' } }, filter === 'sort' ? t('Nothing left to sort.') : t('No lines in this view.')))),
    h('div.mx-fbar', null, h('div.mx-fin', null,
      h('div.mx-fsum', null, h('span', null, h('b', null, act.length), ' ' + t('lines') + (outSum ? ' · −' + tl(outSum) : '') + (inSum ? ' · +' + tl(inSum) : '')), h('span', null, nDup ? tf('{0} skipped', nDup) : tf('{0} in {1}', nOther, fallback))),
      h('div.row', null, h('button.btn.mx-ab', { onClick: () => setSheet({ kind: 'abort' }) }, t('Abort')), h('button.btn', { disabled: busy || !act.length, onClick: save }, busy ? t('Saving...') : act.length ? tf('Save {0} lines', act.length) : t('Nothing new'))))),
    abortS ? h(Confirm, { title: t('Abort this import?'), text: tf('{0} lines will be discarded. Nothing has been saved yet.', act.length), yes: t('Abort import'), danger: true, onYes: () => { setSheet(null); back(); }, onNo: () => setSheet(null) }) : null,
    editS ? h(Dlg, { title: t('Edit line'), onClose: () => setSheet(null) }, h('div.help', null, rows.find(r => r.id === editS.id).raw), h(Er, { e: editS.err }),
      F(t('Business name'), In(editS.f.n, v => sf('n', v))),
      F(t('Description'), In(editS.f.desc, v => sf('desc', v), { placeholder: t('e.g. Ticket / groceries / salary') })),
      h('div.row', null, F(t('Amount (₺)'), In(editS.f.a, v => sf('a', v), { inputMode: 'decimal' })), F(t('Date'), DateIn(editS.f.d, v => sf('d', v)))),
      editS.cari ? F(t('Cari (person)'), h(Frag, null, In(editS.f.cari, v => sf('cari', v), { list: 'mx-caris', placeholder: t('Who owes or is owed?') }), h('datalist', { id: 'mx-caris' }, caris.map(c => h('option', { key: c, value: c }))))) : null,
      h('div.tg', null, h('div', null, h('b', null, t('Recognize later')), h('span.help', t('Book the expense in a different month.'))), h(Sw, { on: editS.f.rl, set: v => sf('rl', v), label: t('Recognize later') })),
      editS.f.rl ? F(t('Recognition date'), DateIn(editS.f.rd, v => sf('rd', v))) : null,
      h('div.row', { style: { marginTop: 16 } }, h('button.btn.gh', { onClick: () => setSheet(null) }, t('Cancel')), h('button.btn', { onClick: saveEdit }, t('Save line')))) : null,
    linkS && lr ? h(Dlg, { title: t('Link to another expense'), onClose: () => setSheet(null) }, h('div.help', null, lr.n + ' · ' + (lr.dirOut ? '' : '+') + tl(lr.a)),
      h('div.pills', { style: { marginTop: 10 } }, (lr.dirOut ? [['inst', t('Instalment')], ['same', t('Same purchase')]] : [['refund', t('Refund')]]).map(([k, l]) => h('button', { key: k, className: cx('pill', linkS.type === k && 'on'), onClick: () => setSheet(s => ({ ...s, type: k, to: null })) }, l))),
      h('div.help', null, linkS.type === 'refund' ? t("This line gives back money from an earlier purchase. It is attached to that purchase, so the purchase's month nets down in Spend.") : linkS.type === 'inst' ? t('This line is one payment of an earlier purchase. It is attached to that purchase, so the purchase stays one expense.') : t('This line belongs to the same purchase as another line, for example a split receipt.')),
      h('div.fld', null, In(linkS.q, v => setSheet(s => ({ ...s, q: v })), { placeholder: t('Search by name') })),
      ['imp', 'mv'].map(src => {
        const L2 = cands.filter(c => c.src === src);
        return L2.length ? h(Frag, { key: src }, h('div.lb', { style: { marginTop: 12 } }, src === 'imp' ? t('In this import') : t('Already in Diligence')),
          h('div.mx-cand', null, L2.map(c => h('button', { key: c.src + c.id, type: 'button', className: cx('opt', linkS.to && linkS.to.id === c.id && linkS.to.src === c.src && 'sel'), onClick: () => setSheet(s => ({ ...s, to: c })) },
            h('span.mx-cn', null, h('b', null, c.n), h('small', null, mxDate(c.d) + (c.cat ? ' · ' + c.cat : '') + (c.k > 1 ? ' · ' + tf('{0} instalments', c.k) : ''))), h('span.mx-ca', tl(c.a)))))) : null;
      }),
      !cands.length ? h('div.help', null, t('No matching expenses found.')) : null,
      h('div.row', { style: { marginTop: 16 } }, h('button.btn.gh', { onClick: () => setSheet(null) }, t('Cancel')), h('button.btn', { disabled: !linkS.to, onClick: () => applyLink(lr.id, linkS.type, linkS.to) }, t('Link')))) : null);
}
