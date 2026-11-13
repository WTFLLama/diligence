// posting.js - turns what the user typed into a balanced ledger entry (debits positive, credits negative).
// Every screen that saves something goes through one of these functions, so the sign rules live in one place:
//   "paying from an account"  = CREDIT that account  (cash goes down, card debt goes up)
//   "receiving into an account" = DEBIT that account (cash goes up, card debt goes down)
//   expense categories are debited, income categories are credited.
import { r2, uid, addMonths, splitCents, MONEY_KINDS, balances, inventory, holdings, systemAccount, describe } from './engine.js';

const line = (acc, amt, date, extra) => ({ acc, amt: r2(amt), date, ...(extra || {}) });
const need = (cond, msg) => { if (!cond) throw new Error(msg); };
const pos = v => { const n = r2(v); return Number.isFinite(n) && n > 0 ? n : 0; };

/* f = { id?, date, rdate?, pay, merchant, note?, party?, n?, splits: [{ acc, amount }], qty?, unit?, src? } */
export function postExpense(m, f) {
  const pay = m.acc.get(f.pay);
  need(pay && MONEY_KINDS.includes(pay.kind), 'Payment method is required.');
  need(f.date, 'Transaction date is required.');
  need((f.merchant || '').trim(), 'Business name is required.');
  const splits = (f.splits || []).filter(s => s.acc && pos(s.amount));
  need(splits.length, 'Category is required.');
  const rdate = f.rdate || f.date, n = Math.min(60, Math.max(1, Math.round(Number(f.n) || 1)));
  const total = r2(splits.reduce((s, x) => s + pos(x.amount), 0)), party = (f.party || '').trim();
  const lines = splits.map(s => {
    const a = m.acc.get(s.acc); need(a, 'Category is required.');
    const extra = {};
    if (a.per_party) { need(party, 'Cari is required for receivable / payable categories.'); extra.party = party; }
    if (a.kind === 'stock') { extra.item = f.merchant.trim(); if (Number(f.qty) > 0) { extra.qty = Number(f.qty); extra.unit = (f.unit || '').trim(); } }
    return line(a.id, pos(s.amount), a.kind === 'expense' ? rdate : f.date, extra);
  });
  const pextra = {};
  if (pay.per_party) { need(party, 'Cari is required for receivable / payable categories.'); pextra.party = party; }
  // instalment k is dated purchase date + k-1 months; the expense itself is recognised once
  if (n > 1) splitCents(total, n).forEach((v, i) => lines.push(line(pay.id, -v, addMonths(f.date, i), pextra)));
  else lines.push(line(pay.id, -total, f.date, pextra));
  return { id: f.id || uid(), kind: 'expense', date: f.date, rdate, merchant: f.merchant.trim(), note: (f.note || '').trim(), n, src: f.src || 'manual', lines };
}

/* f = { id?, date, rdate?, pay, merchant, note?, acc, amount, party? } */
export function postIncome(m, f) {
  const pay = m.acc.get(f.pay), cat = m.acc.get(f.acc), amount = pos(f.amount);
  need(amount, 'Amount must be a positive number.');
  need(pay && MONEY_KINDS.includes(pay.kind), 'Payment method is required.');
  need(cat && cat.kind === 'income', 'Category is required.');
  need(f.date, 'Transaction date is required.');
  need((f.merchant || '').trim(), 'Business name is required.');
  const pextra = {};
  if (pay.per_party) { need((f.party || '').trim(), 'Cari is required for receivable / payable categories.'); pextra.party = f.party.trim(); }
  return { id: f.id || uid(), kind: 'income', date: f.date, rdate: f.rdate || f.date, merchant: f.merchant.trim(), note: (f.note || '').trim(), n: 1, src: f.src || 'manual',
    lines: [line(pay.id, amount, f.date, pextra), line(cat.id, -amount, f.rdate || f.date)] };
}

/* f = { id?, date, from, to, amount, note?, party? }   money leaves "from" (credit) and arrives in "to" (debit) */
export function postTransfer(m, f) {
  const from = m.acc.get(f.from), to = m.acc.get(f.to), amount = pos(f.amount);
  need(amount, 'Amount must be a positive number.');
  need(f.date, 'Transaction date is required.');
  need(from, 'From account is required.'); need(to, 'To account is required.');
  need(from.id !== to.id, 'From and To accounts must be different.');
  const px = a => { if (!a.per_party) return {}; need((f.party || '').trim(), 'Cari is required for receivable / payable categories.'); return { party: f.party.trim() }; };
  return { id: f.id || uid(), kind: 'transfer', date: f.date, rdate: f.date, merchant: f.merchant || 'Transfer', note: (f.note || '').trim(), n: 1, src: f.src || 'manual',
    lines: [line(to.id, amount, f.date, px(to)), line(from.id, -amount, f.date, px(from))] };
}

/* A return: money comes back to "pay", the expense goes down in the month the purchase was recognised.
   f = { purchase (entry), date, pay, allocs: [{ acc, amount }] } */
export function postReturn(m, f) {
  const pay = m.acc.get(f.pay), p = f.purchase;
  need(p, 'Purchase not found.'); need(pay, 'Payment method is required.');
  const allocs = (f.allocs || []).filter(a => pos(a.amount));
  need(allocs.length, 'Enter an amount.');
  const total = r2(allocs.reduce((s, a) => s + pos(a.amount), 0));
  const lines = [line(pay.id, total, f.date)];
  allocs.forEach(a => {
    const src = p.lines.find(l => l.acc === a.acc && l.amt > 0);
    need(src, 'Category not on this purchase.');
    lines.push(line(a.acc, -pos(a.amount), src.date));
  });
  return { id: uid(), kind: 'return', date: f.date, rdate: p.rdate, ref: p.id, merchant: p.merchant, note: f.note || 'Return', n: 1, src: f.src || 'manual', lines };
}

/* Brings an account to the balance it should have. A loss is an expense in the reconcile category;
   a gain goes to the reconcile-gain income category when there is one, else it reduces the reconcile category.
   f = { acc, target, date }  target = balance (cash) or total debt (card, loan), as the bank shows it */
export function postReconcile(m, f) {
  const a = m.acc.get(f.acc); need(a, 'Account is required.');
  const target = Number(f.target); need(Number.isFinite(target), 'Target balance must be a number.');
  const now = balances(m).byId.get(a.id), current = a.kind === 'card' ? now.total : now.posted;
  const diff = r2(target - current); need(Math.abs(diff) >= 0.005, 'Already matches, nothing to add.');
  const dp = a.debit ? diff : -diff;                         // debit-positive change on the account
  const loss = systemAccount(m, 'reconcile'), gain = systemAccount(m, 'reconcile_gain');
  const contra = dp > 0 ? (gain || loss) : loss;
  need(contra, 'Choose a category for reconciliation differences in Settings first.');
  return { entry: { id: uid(), kind: 'reconcile', date: f.date, rdate: f.date, merchant: a.name, note: current.toFixed(2) + ' → ' + target.toFixed(2), n: 1, src: 'manual',
    lines: [line(a.id, dp, f.date), line(contra.id, -dp, f.date)] }, diff, current, isLoss: dp < 0, contra };
}

/* Collect a receivable / pay a payable.  f = { side: 'ar' | 'ap', acc, party, amount, money, date, note? } */
export function postSettle(m, f) {
  const a = m.acc.get(f.acc), money = m.acc.get(f.money), amount = pos(f.amount);
  need(amount, 'Amount must be a positive number.'); need(a, 'Account is required.'); need(money, 'Account is required.');
  const px = a.per_party ? { party: f.party } : {};
  const lines = f.side === 'ar' ? [line(money.id, amount, f.date), line(a.id, -amount, f.date, px)]
    : [line(a.id, amount, f.date, px), line(money.id, -amount, f.date)];
  return { id: uid(), kind: 'settle', date: f.date, rdate: f.date, merchant: f.party || a.name, note: (f.note || '').trim() || (f.side === 'ar' ? 'Collection' : 'Payment'), n: 1, src: 'manual', lines };
}

/* f = { stock, name, qty, unit, total, pay, date } */
export function postStockBuy(m, f) {
  const st = m.acc.get(f.stock), pay = m.acc.get(f.pay), total = pos(f.total), qty = Number(f.qty);
  need((f.name || '').trim(), 'Item name is required.'); need(qty > 0, 'Quantity must be a positive number.');
  need(total, 'Total cost must be a positive number.'); need(st && st.kind === 'stock', 'Account is required.'); need(pay, 'Account is required.');
  return { id: uid(), kind: 'stock_in', date: f.date, rdate: f.date, merchant: f.name.trim(), note: '', n: 1, src: 'manual',
    lines: [line(st.id, total, f.date, { item: f.name.trim(), qty, unit: (f.unit || '').trim() }), line(pay.id, -total, f.date)] };
}

/* Using stock moves its cost into an expense category. Cost = quantity x current average cost;
   using the last of an item takes exactly what is left.  f = { key (inventory item key), qty, cat, date, rdate? } */
export function postStockUse(m, f) {
  const it = inventory(m).items.find(i => i.key === f.key), cat = m.acc.get(f.cat), qty = Number(f.qty);
  need(it, 'Unknown item.'); need(qty > 0, 'Quantity must be a positive number.'); need(cat && cat.kind === 'expense', 'Category is required.');
  need(it.qty > 1e-6, 'This item is used up.'); need(qty <= it.qty + 1e-9, 'Not enough left.');
  const cost = qty >= it.qty - 1e-9 ? it.value : r2(qty * it.value / it.qty);
  return { entry: { id: uid(), kind: 'stock_use', date: f.date, rdate: f.rdate || f.date, merchant: it.name, note: '', n: 1, src: 'manual',
    lines: [line(cat.id, cost, f.rdate || f.date), line(it.acc, -cost, f.date, { item: it.name, qty: -qty, unit: it.unit })] }, cost };
}

/* f = { id?, date, symbol, units, price, commission?, pay, inv } */
export function postInvestBuy(m, f) {
  const inv = m.acc.get(f.inv), pay = m.acc.get(f.pay), units = Number(f.units), price = Number(f.price), com = r2(f.commission || 0);
  need((f.symbol || '').trim(), 'Instrument is required.'); need(units > 0, 'Amount (units) must be a positive number.');
  need(price > 0, 'Amount must be a positive number.'); need(com >= 0, 'Commission must be 0 or more.');
  need(inv && inv.kind === 'investment', 'Account is required.'); need(pay, 'Payment method is required.');
  const total = r2(units * price), lines = [line(inv.id, total, f.date, { item: f.symbol.trim(), qty: units })];
  if (com > 0) { const fees = systemAccount(m, 'fees'); need(fees, 'Choose a category for fees in Settings first.'); lines.push(line(fees.id, com, f.date)); }
  lines.push(line(pay.id, -(total + com), f.date));
  return { id: f.id || uid(), kind: 'invest_buy', date: f.date, rdate: f.date, merchant: f.symbol.trim(), note: (f.note || '').trim(), n: 1, src: 'manual', lines };
}

/* Selling takes the units out at average cost; the difference to the proceeds is a gain (or loss).
   f = { date, symbol, units, proceeds, pay } */
export function postInvestSell(m, f) {
  const h = holdings(m).rows.find(x => x.symbol === f.symbol), pay = m.acc.get(f.pay), units = Number(f.units), proceeds = pos(f.proceeds);
  need(h, 'Instrument is required.'); need(units > 0 && units <= h.qty + 1e-9, 'Not enough left.'); need(proceeds, 'Amount must be a positive number.'); need(pay, 'Account is required.');
  const cost = units >= h.qty - 1e-9 ? h.cost : r2(units * h.avg), gain = r2(proceeds - cost), g = systemAccount(m, 'invest_gain');
  const lines = [line(pay.id, proceeds, f.date), line(h.acc, -cost, f.date, { item: h.symbol, qty: -units })];
  if (Math.abs(gain) >= 0.005) { need(g, 'Add an income category for investment gains in Settings first.'); lines.push(line(g.id, -gain, f.date)); }
  return { entry: { id: uid(), kind: 'invest_sell', date: f.date, rdate: f.date, merchant: h.symbol, note: '', n: 1, src: 'manual', lines }, gain, cost };
}

/* Entry -> the fields of the Add / Edit form. Returns null when this kind of entry is not edited in the form. */
export function toForm(m, e) {
  const d = describe(m, e);
  const base = { id: e.id, date: e.date, rdate: e.rdate, later: e.rdate !== e.date, merchant: e.merchant || '', note: e.note || '', party: d.party || '' };
  if (e.kind === 'transfer') return { ...base, mode: 'transfer', from: d.fromId, to: d.toId, amount: d.amount };
  if (e.kind === 'income' && d.cats.length === 1) return { ...base, mode: 'income', pay: d.payId, acc: d.cats[0].acc, amount: d.amount };
  if (e.kind === 'invest_buy') {
    const iv = e.lines.map(l => ({ l, a: m.acc.get(l.acc) })).find(x => x.a && x.a.kind === 'investment');
    const fee = e.lines.map(l => ({ l, a: m.acc.get(l.acc) })).find(x => x.a && x.a.kind === 'expense');
    if (!iv || !Number(iv.l.qty)) return null;
    return { ...base, mode: 'invest', pay: d.payId, inv: iv.a.id, symbol: iv.l.item || e.merchant, units: Number(iv.l.qty), amount: r2(iv.l.amt / Number(iv.l.qty) * 1e6) / 1e6, commission: fee ? fee.l.amt : '' };
  }
  if (e.kind === 'expense') {
    const st = e.lines.find(l => { const a = m.acc.get(l.acc); return a && a.kind === 'stock' && l.amt > 0; });
    return { ...base, mode: 'expense', pay: d.payId, n: e.n || 1, amount: d.amount, splits: d.cats.map(c => ({ acc: c.acc, amount: c.amount })), qty: st && st.qty ? Number(st.qty) : '', unit: st && st.unit || '' };
  }
  return null;
}
