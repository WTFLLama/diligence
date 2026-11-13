// inbox.js - Notifications: bank SMS / e-mails captured since the last visit, waiting for a category.
import { h, useState, useMemo, Frag, F, In, NumIn, DateIn, Dd, Er, Ic, Dlg, Pills, num, useAct, cx } from '../lib.js';
import { parseBankText, matchAccount } from '../capture.js';
import { postExpense, postIncome } from '../posting.js';
import { merchantHistory, trKey, uid, r2 } from '../engine.js';
import { t, tf, tl, dshort } from '../prefs.js';
import { saveEntry, updateInbox, refreshInbox, say } from '../store.js';
import { payOpts, expenseOpts, incomeOpts, PartyIn } from '../ui.js';

function Item({ m, n }) {
  const p = useMemo(() => parseBankText(n.text), [n.text]);
  const guess = useMemo(() => {
    if (!p || !p.pos) return '';
    const k = trKey(p.pos), hit = merchantHistory(m).find(x => x.k === (p.kind === 'income' ? 'inc' : 'exp') && (trKey(x.n) === k || k.includes(trKey(x.n)) || trKey(x.n).includes(k)));
    return hit ? hit.acc : '';
  }, [p]);
  const [f, setF] = useState(() => ({ kind: p ? p.kind : 'expense', amount: p ? p.amount.toFixed(2).replace('.', ',') : '', date: (p && p.date) || String(n.at).slice(0, 10), merchant: p ? p.pos : '', pay: p ? matchAccount(m.accounts, n.ch, n.sender, p.last4) : '', acc: guess, party: '' }));
  const [open, setOpen] = useState(false), [run, busy, err] = useAct();
  const s = (k, v) => setF(x => ({ ...x, [k]: v }));
  const cat = m.acc.get(f.acc), needParty = cat && cat.per_party;
  const save = () => run(async () => {
    const amount = num(f.amount);
    let e;
    if (f.kind === 'income') e = postIncome(m, { date: f.date, pay: f.pay, merchant: f.merchant || t('Captured'), acc: f.acc, amount, src: 'capture' });
    else if (f.kind === 'refund') {
      if (!(amount > 0)) throw new Error('Amount must be a positive number.');
      if (!m.acc.get(f.pay)) throw new Error('Payment method is required.');
      if (!cat || cat.kind !== 'expense') throw new Error('Category is required.');
      e = { id: uid(), kind: 'return', date: f.date, rdate: f.date, merchant: f.merchant || t('Captured'), note: t('Return'), n: 1, src: 'capture', lines: [{ acc: f.pay, amt: r2(amount), date: f.date }, { acc: f.acc, amt: -r2(amount), date: f.date }] };
    } else e = postExpense(m, { date: f.date, pay: f.pay, merchant: f.merchant || t('Captured'), party: f.party, splits: [{ acc: f.acc, amount }], src: 'capture' });
    const saved = await saveEntry(e);
    await updateInbox([n.id], 'saved', saved.id);
    say(t('Saved ✓'));
  });
  const dismiss = () => run(() => updateInbox([n.id], 'dismissed'));
  return h('div.nt', null,
    h('div.nt-h', null, h('b', null, p ? (f.merchant || t('Captured')) : t('Could not read an amount')), p ? h('span', { className: f.kind === 'expense' ? '' : 'up', style: { fontWeight: 700 } }, (f.kind === 'expense' ? '−' : '+') + tl(num(f.amount))) : null),
    h('div.help', { style: { marginTop: 2 } }, (n.ch === 'email' ? t('E-mail') : 'SMS') + (n.sender ? ' · ' + n.sender : '') + ' · ' + dshort(String(n.at).slice(0, 10))),
    h('button.linkb', { style: { fontSize: 12, marginTop: 6 }, onClick: () => setOpen(!open) }, open ? t('Hide message') : t('Show message')),
    open ? h('div.nt-x', null, n.text) : null,
    p ? h(Frag, null,
      h(Pills, { v: f.kind, set: v => setF(x => ({ ...x, kind: v, acc: '' })), o: [['expense', t('Expense')], ['refund', t('Refund')], ['income', t('Income')]] }),
      h('div.row', null, F(t('Amount (₺)'), NumIn(f.amount, v => s('amount', v))), F(t('Date'), DateIn(f.date, v => s('date', v)))),
      F(t('Business name'), In(f.merchant, v => s('merchant', v))),
      h('div.row', null,
        F(t('Payment method'), h(Dd, { v: f.pay, on: v => s('pay', v), opts: payOpts(m, ['cash', 'card']) })),
        F(t('Category'), h(Dd, { v: f.acc, on: v => s('acc', v), opts: f.kind === 'income' ? incomeOpts(m) : expenseOpts(m, f.kind === 'refund') }))),
      needParty ? F(t('Cari (person)'), h(PartyIn, { m, v: f.party, on: v => s('party', v) })) : null) : null,
    h(Er, { e: err }),
    h('div.row', { style: { marginTop: 10 } },
      h('button.sb', { style: { flex: 1 }, disabled: busy, onClick: dismiss }, t('Dismiss')),
      p ? h('button.sb.ok', { style: { flex: 1 }, disabled: busy, onClick: save }, busy ? t('Saving...') : t('Save')) : null));
}

export function Inbox({ m, close }) {
  const list = m.data.inbox || [], [run, busy] = useAct();
  return h(Dlg, { title: t('Notifications'), onClose: close },
    h('div.help', null, list.length ? tf('{0} captured message(s) waiting. Nothing is saved until you press Save.', list.length) : t('No new card messages. Set up automatic capture in Settings to have bank SMS and e-mails appear here.')),
    list.map(n => h(Item, { key: n.id, m, n })),
    h('div.row', { style: { marginTop: 14 } },
      h('button.btn.gh', { disabled: busy, onClick: () => run(refreshInbox) }, t('Check again')),
      list.length > 1 ? h('button.btn.gh', { disabled: busy, onClick: () => run(() => updateInbox(list.map(n => n.id), 'dismissed')) }, t('Dismiss all')) : null));
}
