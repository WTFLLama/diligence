// recon.js - Reconciliation: bring an account to the balance the bank shows; the difference becomes one entry.
import { h, useState, Pg, F, NumIn, Dd, Er, Frag, num, useAct, cx } from '../lib.js';
import { balances, accountsOf, systemAccount } from '../engine.js';
import { postReconcile } from '../posting.js';
import { t, tf, tl } from '../prefs.js';
import { saveEntry, say } from '../store.js';
import { sideLabel, kindLabel } from '../ui.js';

export function Recon({ m, back }) {
  const accs = accountsOf(m, ['cash', 'card', 'loan']), B = balances(m);
  const [acc, setAcc] = useState(''), [target, setTarget] = useState(''), [run, busy, err, setErr] = useAct();
  const a = m.acc.get(acc), b = a ? B.byId.get(a.id) : null, cur = b ? (a.kind === 'card' ? b.total : b.posted) : 0;
  let preview = null, perr = '';
  if (a && target.trim() !== '' && Number.isFinite(num(target))) { try { preview = postReconcile(m, { acc, target: num(target), date: m.today }); } catch (e) { perr = t(e.message); } }
  const save = () => run(async () => { await saveEntry(preview.entry); say(t('Reconciled ✓')); setTarget(''); });
  const loss = systemAccount(m, 'reconcile'), gain = systemAccount(m, 'reconcile_gain');
  return h(Pg, { title: t('Reconciliation'), back },
    h('div.card', null,
      F(t('Account'), h(Dd, { v: acc, on: v => { setAcc(v); setTarget(''); setErr(''); }, opts: accs.map(x => ({ v: x.id, l: x.name, e: x.emoji || '', k: sideLabel(x) })) })),
      a ? h(Frag, null,
        h('div.kv', { style: { marginTop: 12 } }, h('span', null, a.debit ? t('Balance in Diligence') : t('Debt in Diligence')), h('b', null, tl(cur))),
        a.kind === 'card' && b.future > 0.005 ? h('div.help', null, tf('{0} already on statements + {1} in instalments still to come. Compare with the total debt your bank shows, not only this period.', tl(b.posted), tl(b.future))) : null,
        F(a.debit ? t('Balance it should be (₺)') : t('Total debt it should be (₺)'), NumIn(target, setTarget, { placeholder: String(cur) })),
        preview ? h('div.card', { style: { background: 'var(--in)', boxShadow: 'none' } },
          h('div.lb', t('What will be added')),
          h('div.kv', null, h('span', null, preview.isLoss ? t('Expense') : (preview.contra.kind === 'income' ? t('Income') : t('Reduces expense'))), h('b', { className: preview.isLoss ? 'dn' : 'up' }, tl(Math.abs(preview.diff)))),
          h('div.kv', null, h('span', null, t('Category')), h('b', null, preview.contra.name)),
          h('div.help', null, t('One entry dated today. It shows in Transactions and can be deleted there.'))) : null,
        h(Er, { e: err || (target.trim() !== '' ? perr : '') }),
        h('div.row', { style: { marginTop: 14 } }, h('button.btn', { disabled: busy || !preview, onClick: save }, busy ? t('Saving...') : t('Reconcile')))) : null),
    h('div.card', null, h('div.lb', t('All balances today')),
      accs.map(x => { const r = B.byId.get(x.id); return h('div.kv', { key: x.id }, h('span', null, x.name + ' · ' + kindLabel(x)), h('b', null, tl(x.kind === 'card' ? r.total : r.posted))); })),
    h('div.help', null, tf('Losses go to "{0}"', loss ? loss.name : '—') + (gain ? tf('; gains go to "{0}"', gain.name) : tf('; gains reduce "{0}"', loss ? loss.name : '—')) + '. ' + t('Change these in Settings > Accounts & categories.')));
}
