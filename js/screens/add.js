// add.js - add or edit an entry: expense, income, transfer, investment purchase.
import { h, useState, useMemo, Pg, F, In, NumIn, DateIn, Dd, Sw, Er, Ic, Pills, Frag, num, useAct } from '../lib.js';
import { r2, accountsOf, holdings, addMonths } from '../engine.js';
import { postExpense, postIncome, postTransfer, postInvestBuy, toForm } from '../posting.js';
import { t, tf, PREF, tl, dshort, nfmt } from '../prefs.js';
import { saveEntry, saveInstrument, say } from '../store.js';
import { payOpts, moneyOpts, expenseOpts, incomeOpts, PartyIn } from '../ui.js';

const INST = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 24, 36];
const lastPay = () => { try { return localStorage.getItem('dil:lastpay') || ''; } catch (e) { return ''; } };

export function Add({ m, edit, preset, done }) {
  const start = useMemo(() => {
    const base = { mode: 'expense', amount: '', date: m.today, rdate: m.today, later: false, pay: '', merchant: '', party: '', note: '', acc: '', extra: [], n: 1,
      from: '', to: '', symbol: '', units: '', commission: '', inv: '', cls: '', qty: '', unit: '' };
    if (edit) {
      const f = toForm(m, edit);
      if (f) {
        const o = { ...base, ...f, amount: String(f.amount) };
        if (f.mode === 'expense') { o.acc = f.splits[0] ? f.splits[0].acc : ''; o.extra = f.splits.slice(1).map(s => ({ acc: s.acc, amount: String(s.amount) })); }
        if (f.mode === 'invest') { o.units = String(f.units); o.commission = f.commission ? String(f.commission) : ''; }
        return o;
      }
    }
    const lp = lastPay();
    return { ...base, ...(preset && typeof preset === 'object' ? preset : {}), pay: m.acc.has(lp) && !m.acc.get(lp).archived ? lp : '' };
  }, []);
  const [f, setF] = useState(start), [more, setMore] = useState(!!(edit && (start.n > 1 || start.extra.length || start.later || start.note)));
  const [run, busy, err, setErr] = useAct();
  const s = (k, v) => setF(p => ({ ...p, [k]: v }));
  const mode = f.mode, A = id => m.acc.get(id);
  const total = num(f.amount), extraSum = r2(f.extra.reduce((a, x) => a + num(x.amount), 0)), main = r2(total - extraSum);
  const cats = mode === 'expense' ? [f.acc, ...f.extra.map(x => x.acc)].map(A).filter(Boolean) : [];
  const needParty = (mode === 'expense' && (cats.some(a => a.per_party) || (A(f.pay) && A(f.pay).per_party)))
    || (mode === 'income' && A(f.pay) && A(f.pay).per_party) || (mode === 'transfer' && [f.from, f.to].map(A).some(a => a && a.per_party));
  const hasStock = cats.some(a => a.kind === 'stock');
  const invAccs = accountsOf(m, ['investment']), syms = holdings(m).rows.map(x => x.symbol);
  const classes = [...new Set((m.data.instruments || []).map(i => i.class).filter(Boolean))];
  const nSet = (f.n > 1 ? 1 : 0) + (f.extra.length ? 1 : 0) + (f.later ? 1 : 0) + (f.note ? 1 : 0);
  const setAmount = v => {
    v = v.replace(/[^0-9.,]/g, '').replace(/\./g, ',');
    const i = v.indexOf(',');
    if (i > -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/,/g, '').slice(0, mode === 'invest' ? 6 : 2);
    s('amount', v.replace(',', '.'));
  };
  const instOpts = INST.map(n => ({ v: n, l: n === 1 ? t('Single payment') : tf('{0} instalments', n) }));

  function build() {
    if (!(total > 0)) throw new Error('Amount must be a positive number.');
    const rdate = f.later && f.rdate ? f.rdate : f.date, id = edit ? edit.id : undefined;
    if (mode === 'expense') {
      if (f.extra.some(x => (x.acc && !(num(x.amount) > 0)) || (!x.acc && num(x.amount) > 0))) throw new Error('Each additional category needs both a category and an amount.');
      if (!(main > 0)) throw new Error('Additional categories add up to more than the amount.');
      return postExpense(m, { id, date: f.date, rdate, pay: f.pay, merchant: f.merchant, note: f.note, party: f.party, n: f.n, qty: num(f.qty), unit: f.unit,
        splits: [{ acc: f.acc, amount: main }, ...f.extra.filter(x => x.acc).map(x => ({ acc: x.acc, amount: num(x.amount) }))] });
    }
    if (mode === 'income') return postIncome(m, { id, date: f.date, rdate, pay: f.pay, merchant: f.merchant, note: f.note, acc: f.acc, amount: total, party: f.party });
    if (mode === 'transfer') return postTransfer(m, { id, date: f.date, from: f.from, to: f.to, amount: total, note: f.note, party: f.party });
    return postInvestBuy(m, { id, date: f.date, symbol: f.symbol, units: num(f.units), price: total, commission: num(f.commission), pay: f.pay, inv: f.inv || (invAccs[0] && invAccs[0].id), note: f.note });
  }
  const save = () => run(async () => {
    const entry = build();
    await saveEntry(entry);
    if (mode === 'invest' && f.cls && !(m.data.instruments || []).some(i => i.symbol === entry.merchant)) await saveInstrument({ symbol: entry.merchant, class: f.cls });
    if (f.pay) { try { localStorage.setItem('dil:lastpay', f.pay); } catch (e) { /* ignore */ } }
    say(edit ? t('Saved ✓') : entry.n > 1 ? tf('Saved in {0} instalments ✓', entry.n) : t('Saved ✓'));
    if (edit) done(); else setF({ ...start, mode, date: f.date, rdate: f.date, pay: f.pay, from: f.from, to: f.to });
  });

  const perInst = mode === 'expense' && f.n > 1 && total > 0 ? r2(total / f.n) : 0;
  return h(Pg, { title: edit ? t('Edit transaction') : t('Add entry'), sub: edit ? dshort(edit.date) + ' · ' + (edit.merchant || '') : null },
    edit ? null : h(Pills, { v: mode, set: v => { setErr(''); setF(p => ({ ...p, mode: v, acc: '', extra: [] })); }, o: [['expense', t('Expense')], ['income', t('Income')], ['transfer', t('Transfer')], ['invest', t('Invest')]] }),
    h('label.amount', { htmlFor: 'amt' },
      h('span.lb', mode === 'invest' ? t('Price per unit (₺)') : t('Amount (₺)')),
      h('span.amt-line', null, h('span.amt-cur', PREF.cur),
        h('input', { id: 'amt', inputMode: 'decimal', autoComplete: 'off', placeholder: '0', value: String(f.amount).replace('.', ','), style: { width: Math.max(2, String(f.amount).length + 0.6) + 'ch' }, onChange: e => setAmount(e.target.value) })),
      h('span.amt-rule')),

    mode === 'transfer' ? h(Frag, null,
      F(t('From account'), h(Dd, { v: f.from, on: v => s('from', v), opts: moneyOpts(m) })),
      F(t('To account'), h(Dd, { v: f.to, on: v => s('to', v), opts: moneyOpts(m) })),
      h('div.help', t('Money leaves the From account and arrives in the To account. Paying a card: From your bank, To the card.')),
      needParty ? F(t('Cari (person)'), h(PartyIn, { m, v: f.party, on: v => s('party', v) })) : null,
      F(t('Transaction date'), DateIn(f.date, v => s('date', v))),
      F(t('Description'), In(f.note, v => s('note', v), { placeholder: t('e.g. Credit card payment') }))) : null,

    mode === 'expense' || mode === 'income' ? h(Frag, null,
      F(mode === 'income' ? t('Received into') : t('Payment method'), h(Dd, { v: f.pay, on: v => s('pay', v), opts: payOpts(m, mode === 'income' ? ['cash', 'card'] : undefined) })),
      F(t('Transaction date'), DateIn(f.date, v => s('date', v))),
      F(mode === 'income' ? t('From (payer)') : t('Business name'), In(f.merchant, v => s('merchant', v), { placeholder: mode === 'income' ? t('e.g. Employer') : t('e.g. Migros'), autoCapitalize: 'words' })),
      F(t('Category'), h(Dd, { v: f.acc, on: v => s('acc', v), opts: mode === 'income' ? incomeOpts(m) : expenseOpts(m) }),
        mode === 'expense' && A(f.acc) && A(f.acc).kind !== 'expense' ? t('This is not spending: it goes on your balance sheet until it is settled or used.') : null),
      needParty ? F(t('Cari (person)'), h(PartyIn, { m, v: f.party, on: v => s('party', v) })) : null,
      hasStock ? h('div.row', null, F(t('Quantity'), NumIn(f.qty, v => s('qty', v), { placeholder: '0' })), F(t('Unit'), In(f.unit, v => s('unit', v), { placeholder: t('g, ml, pcs') }))) : null,
      h('section', { className: 'more' + (more ? ' open' : '') },
        h('button.more-btn', { type: 'button', 'aria-expanded': more, onClick: () => setMore(!more) }, h('span', null, t('More details')),
          h('span.r', null, nSet ? h('span.tag', tf('{0} set', nSet)) : null, h('span.chev', null, h(Ic, { n: 'chev', s: 16 })))),
        more ? h('div.more-body', null,
          mode === 'expense' ? F(t('Instalments'), h(Dd, { v: f.n, on: v => s('n', v), opts: instOpts }),
            perInst ? tf('{0} x {1}, first on {2}, last on {3}. The whole purchase counts as spending on the recognition date.', f.n, tl(perInst), dshort(f.date), dshort(addMonths(f.date, f.n - 1))) : null) : null,
          F(t('Description'), In(f.note, v => s('note', v), { placeholder: t('Optional note') })),
          mode === 'expense' ? h(Frag, null,
            h('div.tg', null, h('div', null, h('b', null, t('Additional categories')), h('span.help', t('Split the amount, e.g. your share and a friend\'s share.'))),
              h('button.sb', { type: 'button', disabled: f.extra.length >= 4, onClick: () => s('extra', [...f.extra, { acc: '', amount: '' }]) }, '+ ' + t('Add'))),
            f.extra.map((x, i) => h('div.row', { key: i, style: { alignItems: 'flex-end' } },
              F(tf('Category {0}', i + 2), h(Dd, { v: x.acc, on: v => s('extra', f.extra.map((y, j) => j === i ? { ...y, acc: v } : y)), opts: expenseOpts(m) })),
              h('div', { style: { flex: '0 0 30%' } }, F(t('Amount'), NumIn(x.amount, v => s('extra', f.extra.map((y, j) => j === i ? { ...y, amount: v } : y)), { placeholder: '0' }))),
              h('button.sb.dl', { type: 'button', style: { flex: 'none', marginBottom: 2 }, 'aria-label': t('Remove'), onClick: () => s('extra', f.extra.filter((_, j) => j !== i)) }, '×'))),
            f.extra.length ? h('div.help', tf('{0} gets the rest: {1}', A(f.acc) ? A(f.acc).name : t('Category 1'), tl(Math.max(main, 0)))) : null) : null,
          h('div.tg', null, h('div', null, h('b', null, t('Recognize later')), h('span.help', t('Count it in another month than the payment date, e.g. a flight for next summer.'))),
            h(Sw, { on: f.later, set: v => setF(p => ({ ...p, later: v, rdate: v ? p.rdate || p.date : p.date })), label: t('Recognize later') })),
          f.later ? F(t('Recognition date'), DateIn(f.rdate, v => s('rdate', v))) : null) : null)) : null,

    mode === 'invest' ? h(Frag, null,
      F(t('Instrument'), h('div', null, In(f.symbol, v => s('symbol', v.toUpperCase()), { placeholder: t('e.g. THYAO, USD, BTC'), list: 'dl-sym', autoCapitalize: 'characters' }),
        h('datalist', { id: 'dl-sym' }, syms.map(x => h('option', { key: x, value: x }))))),
      h('div.row', null, F(t('Units'), NumIn(f.units, v => s('units', v), { placeholder: '0' })), F(t('Commission'), NumIn(f.commission, v => s('commission', v), { placeholder: '0' }))),
      f.symbol && !syms.includes(f.symbol) ? F(t('Asset class'), h('div', null, In(f.cls, v => s('cls', v), { placeholder: t('e.g. Stocks, FX, Crypto'), list: 'dl-cls' }), h('datalist', { id: 'dl-cls' }, classes.map(c => h('option', { key: c, value: c }))))) : null,
      F(t('Paid from'), h(Dd, { v: f.pay, on: v => s('pay', v), opts: payOpts(m, ['cash']) })),
      invAccs.length > 1 ? F(t('Investment account'), h(Dd, { v: f.inv || invAccs[0].id, on: v => s('inv', v), opts: invAccs.map(a => ({ v: a.id, l: a.name })) })) : null,
      F(t('Transaction date'), DateIn(f.date, v => s('date', v))),
      total > 0 && num(f.units) > 0 ? h('div.help', tf('Total cost {0}', tl(r2(total * num(f.units) + num(f.commission))))) : null) : null,

    h(Er, { e: err }),
    h('div.row', { style: { marginTop: 16 } },
      edit ? h('button.btn.gh', { disabled: busy, onClick: done }, t('Cancel')) : null,
      h('button.btn', { disabled: busy, onClick: save }, busy ? t('Saving...') : edit ? t('Save changes') : t('Save'))));
}
