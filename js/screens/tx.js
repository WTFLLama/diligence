// tx.js - the list of transactions, with return / edit / delete.
import { h, useState, useMemo, Pg, F, In, NumIn, DateIn, Dd, Er, P, Em, Frag, num, useAct, Confirm, Dlg, cx } from '../lib.js';
import { txList, accountsOf, r2 } from '../engine.js';
import { postReturn, toForm } from '../posting.js';
import { t, tf, tl, dshort, nfmt } from '../prefs.js';
import { saveEntry, deleteEntry, say } from '../store.js';
import { payOpts } from '../ui.js';

const KIND = { transfer: 'Transfer', settle: 'Settlement', opening: 'Opening balance', adjust: 'Adjustment', reconcile: 'Reconciliation', stock_in: 'Stock purchase', stock_use: 'Stock used', invest_buy: 'Investment', invest_sell: 'Investment sale', return: 'Return' };

export function Tx({ m, onEdit }) {
  const all = txList(m);
  const [acc, setAcc] = useState(''), [cat, setCat] = useState(''), [q, setQ] = useState(''), [n, setN] = useState(40), [del, setDel] = useState(null), [ret, setRet] = useState(null);
  const [run, busy, err, setErr] = useAct();
  const accO = [{ v: '', l: t('All accounts') }].concat(accountsOf(m, ['cash', 'card', 'loan', 'payable', 'stock'], true).map(a => ({ v: a.id, l: a.name, e: a.emoji || '' })));
  const catO = [{ v: '', l: t('All categories') }].concat(accountsOf(m, ['expense', 'income', 'receivable'], true).map(a => ({ v: a.id, l: a.name, e: a.emoji || '' })));
  const rows = useMemo(() => {
    const qq = q.trim().toLocaleLowerCase('tr');
    return all.filter(d => {
      if (acc && d.payId !== acc && d.fromId !== acc && d.toId !== acc) return false;
      if (cat && !d.cats.some(c => c.acc === cat)) return false;
      if (qq && !(d.merchant + ' ' + d.note + ' ' + d.party + ' ' + d.cats.map(c => c.name).join(' ')).toLocaleLowerCase('tr').includes(qq)) return false;
      return true;
    });
  }, [all, acc, cat, q]);
  const doDelete = () => run(async () => { await deleteEntry(del.id); setDel(null); say(t('Deleted ✓')); });
  const delText = d => {
    const parts = [];
    if (d.n > 1) parts.push(tf('all {0} instalments', d.n));
    if (d.returns.length) parts.push(tf('{0} return(s)', d.returns.length));
    if (d.kind === 'transfer') parts.push(t('both sides of the transfer'));
    return tf('"{0}" of {1} on {2} will be deleted', d.merchant || t(KIND[d.kind] || 'Transaction'), tl(d.amount), dshort(d.date)) + (parts.length ? ', ' + t('together with') + ' ' + parts.join(' ' + t('and') + ' ') : '') + '. ' + t('Normalize and one-off marks on it go too. This cannot be undone.');
  };
  return h(Pg, { title: t('Transactions'), sub: tf('{0} entries', all.length) },
    h('div.row', null, h(Dd, { v: acc, on: setAcc, opts: accO }), h(Dd, { v: cat, on: setCat, opts: catO })),
    h('div.srch', null, In(q, setQ, { placeholder: t('Search business, note, person…'), type: 'search' })),
    !rows.length ? h('div.card', null, h('div.help', { style: { margin: 0 } }, all.length ? t('Nothing matches these filters.') : t('No transactions yet. Add one with the + button.'))) : null,
    rows.slice(0, n).map(d => {
      const move = d.kind === 'transfer' || d.kind === 'settle';
      const editable = !!toForm(m, m.byId.get(d.id)) && !d.returns.length;
      const canReturn = d.kind === 'expense' && d.left.length > 0;
      return h('div.card', { key: d.id },
        h('div.fx', null,
          h('div.grow', null,
            h('div.lb', null, dshort(d.date), d.n > 1 ? ' · ' + tf('{0} instalments', d.n) : '', d.rdate !== d.date ? ' · ' + tf('counts in {0}', dshort(d.rdate)) : ''),
            h('div', { style: { fontWeight: 600, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis' } }, d.merchant || t(KIND[d.kind] || 'Transaction')),
            h('div.help', { style: { marginTop: 2 } }, move ? d.from + ' → ' + d.to : (d.pay || ''), d.party ? ' · ' + d.party : '', KIND[d.kind] && !move ? ' · ' + t(KIND[d.kind]) : '')),
          h('div', { className: cx('v', d.sign > 0 ? 'id' : d.sign < 0 ? 'iu' : ''), style: { marginTop: 0, whiteSpace: 'nowrap' } }, d.sign > 0 ? '+' : d.sign < 0 ? '−' : '', P(d.amount))),
        d.note && d.note !== d.merchant ? h('div.help', null, d.note) : null,
        d.cats.length ? h('div', null, d.cats.map((c, i) => h('span.chip', { key: i }, h(Em, { id: c.acc }), c.name, d.cats.length > 1 ? ' ' + nfmt(c.amount) : '', c.item && c.qty ? ' · ' + c.qty + (c.unit || '') : ''))) : null,
        d.returned > 0 ? h('div.help.up', null, tf('Returned {0} · net {1}', tl(d.returned), tl(d.net))) : null,
        h('div.row', { style: { marginTop: 10 } },
          canReturn ? h('button.sb', { style: { flex: 1 }, onClick: () => setRet(d) }, t('Return')) : null,
          editable ? h('button.sb', { style: { flex: 1 }, onClick: () => onEdit(m.byId.get(d.id)) }, t('Edit')) : null,
          h('button.sb.dl', { style: { flex: 1 }, onClick: () => { setErr(''); setDel(d); } }, t('Delete'))));
    }),
    rows.length > n ? h('button.btn.gh', { style: { width: '100%', marginTop: 12 }, onClick: () => setN(n + 60) }, tf('Show more ({0} left)', rows.length - n)) : null,
    del ? h(Confirm, { title: t('Delete this transaction?'), text: delText(del), yes: t('Delete'), danger: true, busy, error: err, onYes: doDelete, onNo: () => setDel(null) }) : null,
    ret ? h(ReturnDlg, { m, d: ret, close: () => setRet(null) }) : null);
}

// A return is saved against its purchase, so it lowers spending in the month the purchase counted.
function ReturnDlg({ m, d, close }) {
  const max = r2(d.left.reduce((a, c) => a + c.amount, 0));
  const [amount, setAmount] = useState(String(max)), [date, setDate] = useState(m.today), [pay, setPay] = useState(d.payId || ''), [manual, setManual] = useState(null);
  const [run, busy, err, setErr] = useAct();
  const a = num(amount);
  const auto = useMemo(() => { let left = r2(a); return d.left.map((c, i) => { const v = i === d.left.length - 1 ? left : Math.min(r2(a * c.amount / max), left); left = r2(left - v); return { acc: c.acc, amount: Math.max(v, 0) }; }); }, [a]);
  const allocs = manual ? manual.map(x => ({ acc: x.acc, amount: num(x.amount) })) : auto;
  const save = () => run(async () => {
    const sum = r2(allocs.reduce((s, x) => s + x.amount, 0));
    if (!(sum > 0)) throw new Error('Amount must be a positive number.');
    if (allocs.some(x => x.amount > d.left.find(c => c.acc === x.acc).amount + 0.005) || sum > max + 0.005) throw new Error('You cannot return more than what is left on the purchase.');
    await saveEntry(postReturn(m, { purchase: m.byId.get(d.id), date, pay, allocs }));
    say(t('Return saved ✓')); close();
  });
  return h(Dlg, { title: t('Return'), onClose: close },
    h('div.help', null, d.merchant + ' · ' + dshort(d.date) + ' · ' + tf('up to {0}', tl(max))),
    manual ? null : F(t('Amount returned'), NumIn(amount, setAmount)),
    d.left.length > 1 ? h(Frag, null,
      h('div.tg', null, h('div', null, h('b', null, t('Split by category myself')), h('span.help', t('Otherwise the return is shared in proportion to what is left.'))),
        h('button.sb', { type: 'button', onClick: () => setManual(manual ? null : auto.map(x => ({ acc: x.acc, amount: String(x.amount) }))) }, manual ? t('Auto') : t('Edit'))),
      (manual || auto).map((x, i) => h('div.kv', { key: x.acc }, h('span', null, h(Em, { id: x.acc }), m.acc.get(x.acc).name),
        manual ? h('div', { style: { width: 110 } }, NumIn(x.amount, v => setManual(manual.map((y, j) => j === i ? { ...y, amount: v } : y)))) : h('b', null, tl(x.amount))))) : null,
    F(t('Returned to'), h(Dd, { v: pay, on: setPay, opts: payOpts(m, ['cash', 'card']) })),
    F(t('Return date'), DateIn(date, setDate)),
    h(Er, { e: err }),
    h('div.row', { style: { marginTop: 14 } }, h('button.btn.gh', { disabled: busy, onClick: close }, t('Cancel')), h('button.btn', { disabled: busy, onClick: save }, busy ? t('Saving...') : t('Save return'))));
}
