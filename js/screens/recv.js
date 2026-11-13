// recv.js - Receivables and Payables: who owes you, whom you owe, aging, collect / pay.
import { h, useState, Frag, F, In, NumIn, DateIn, Dd, Er, Metric, Em, Dlg, num, useAct } from '../lib.js';
import { receivables, accountsOf, r2 } from '../engine.js';
import { postSettle } from '../posting.js';
import { t, tf, tl, dshort } from '../prefs.js';
import { saveEntry, say } from '../store.js';
import { payOpts } from '../ui.js';

export function Recv({ m, kind }) {
  const ar = kind === 'ar', d = receivables(m)[kind], mx = Math.max(1, ...d.buckets.map(b => b.amount));
  const [op, setOp] = useState({}), [dlg, setDlg] = useState(null), [f, setF] = useState({});
  const [run, busy, err, setErr] = useAct();
  const s = (k, v) => setF(p => ({ ...p, [k]: v }));
  const verb = ar ? t('Collect') : t('Pay'), money = accountsOf(m, ar ? ['cash', 'card'] : ['cash', 'card']);
  const open = g => { setErr(''); setF({ amt: String(r2(g.outstanding)), date: m.today, acc: money[0] ? money[0].id : '', note: '' }); setDlg(g); };
  const save = () => run(async () => {
    const a = num(f.amt);
    if (!(a > 0)) throw new Error('Amount must be a positive number.');
    if (a > dlg.outstanding + 0.01) throw new Error('Amount is more than what is outstanding.');
    if (!f.acc) throw new Error('Account is required.');
    await saveEntry(postSettle(m, { side: kind, acc: dlg.acc, party: dlg.party, amount: a, money: f.acc, date: f.date, note: f.note }));
    say(ar ? t('Collected ✓') : t('Paid ✓')); setDlg(null);
  });
  const badge = (bad, text) => h('span.badge', { style: bad ? { background: 'rgba(225,29,72,.14)', color: 'var(--rd)' } : { background: 'rgba(22,163,74,.14)', color: 'var(--gn)' } }, text);
  const gcard = g => h('div.card', { key: g.key },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 10, cursor: 'pointer' }, role: 'button', tabIndex: 0, 'aria-expanded': !!op[g.key], onClick: () => setOp(p => ({ ...p, [g.key]: !p[g.key] })) },
      h('div', null, h('b', { style: { fontSize: 17 } }, g.party ? null : h(Em, { id: g.acc }), g.label),
        h('div.help', { style: { marginTop: 2 } }, (g.party ? g.account + ' · ' : '') + tf('{0} open items', g.count) + (op[g.key] ? ' ▴' : ' ▾'))),
      h('div', { style: { textAlign: 'right' } }, h('div.v', null, tl(g.outstanding)), g.overdue > 0 ? badge(true, tf('Overdue {0}', tl(g.overdue, 0))) : null)),
    g.credit > 0 ? h('div.help', null, tf('Unapplied credit: {0}', tl(g.credit))) : null,
    g.netted > 0 ? h('div.help', null, tf(ar ? 'Netted against what you owe them: {0}' : 'Netted against what they owe you: {0}', tl(g.netted))) : null,
    op[g.key] ? g.items.map((i, n) => h('div.li', { key: n },
      h('div', { style: { flex: 1 } }, h('b', null, i.merchant || g.account), h('div.help', { style: { marginTop: 2 } }, dshort(i.date) + ' → ' + dshort(i.due) + (i.note && i.note !== i.merchant ? ' · ' + i.note : ''))),
      h('div', { style: { textAlign: 'right' } }, h('b', null, tl(i.open)), i.open < i.amount - 0.005 ? h('div.help', { style: { margin: 0 } }, tf('of {0}', tl(i.amount))) : null,
        h('div', null, badge(i.overdueDays > 0, i.overdueDays > 0 ? tf('Overdue {0}d', i.overdueDays) : tf('Due in {0}d', -i.overdueDays)))))) : null,
    g.outstanding > 0.005 ? h('div.row', { style: { marginTop: 10, justifyContent: 'flex-end' } }, h('button.sb', { onClick: () => open(g) }, verb)) : null);
  const sl = d.groups.filter(g => !g.party), cl = d.groups.filter(g => g.party);
  const rules = accountsOf(m, [ar ? 'receivable' : 'payable']).map(a => a.name + ': ' + (a.due_mode === 'statement' ? t('card cut-off') : tf('{0} days', a.due_days))).join(' · ');
  return h(Frag, null,
    h('div.g2', null, Metric(t('Outstanding'), tl(d.outstanding)), Metric(t('Overdue'), tl(d.overdue)),
      Metric(ar ? t('Receivable days') : t('Payable days'), tf('{0} days', Math.round(d.days))), Metric(ar ? t('Avg. collection time') : t('Avg. payment time'), d.avgDays === null ? '-' : tf('{0} days', Math.round(d.avgDays)))),
    h('div.card', null, h('div.lb', t('Aging (days since transaction)')), d.buckets.map(b => h('div', { key: b.label, style: { marginTop: 12 } },
      h('div.row', { style: { justifyContent: 'space-between', fontSize: 13 } }, h('span', null, tf('{0} days', b.label)), h('b', { style: { flex: 'none' } }, tl(b.amount))),
      h('div.bar', { style: { width: b.amount / mx * 100 + '%', background: b.label === '90+' ? 'var(--rd)' : 'var(--txt)' } })))),
    sl.length ? h('div.lb', { style: { marginTop: 18 } }, t('Single line')) : null, sl.map(gcard),
    cl.length ? h('div.lb', { style: { marginTop: 18 } }, t('By person')) : null, cl.map(gcard),
    !d.groups.length ? h('div.help', { style: { marginTop: 12 } }, t('Nothing outstanding.')) : null,
    rules ? h('div.help', null, t('Due rules: ') + rules) : null,
    h('div.help', null, ar ? t('To add one: use the Add screen and pick a receivable as the category (or as an additional category for a friend\'s share).') : t('To add one: use the Add screen and pick the payable as the payment method.')),
    dlg ? h(Dlg, { title: verb + ' · ' + dlg.label, onClose: () => setDlg(null) },
      h('div.help', null, tf('Outstanding: {0} · matched against the oldest open items first', tl(dlg.outstanding))),
      F(t('Amount (₺)'), h('div.row', null, NumIn(f.amt, v => s('amt', v)), h('button.sb', { style: { flex: 'none' }, onClick: () => s('amt', String(r2(dlg.outstanding))) }, t('Full')))),
      F(ar ? t('Received into') : t('Paid from'), h(Dd, { v: f.acc, on: v => s('acc', v), opts: payOpts(m, ['cash', 'card']) })),
      F(t('Date'), DateIn(f.date, v => s('date', v))),
      F(t('Note (optional)'), In(f.note, v => s('note', v), { placeholder: ar ? t('Collection') : t('Payment') })),
      h(Er, { e: err }),
      h('div.row', { style: { marginTop: 16 } }, h('button.btn.gh', { onClick: () => setDlg(null) }, t('Cancel')), h('button.btn', { disabled: busy, onClick: save }, busy ? t('Saving...') : verb))) : null);
}
