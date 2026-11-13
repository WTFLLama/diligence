// engine.js - every number the app shows is calculated here, from the ledger, in one way.
//
// The ledger rule (same as the database): a line amount > 0 is a DEBIT, < 0 is a CREDIT, and
// the lines of an entry add up to zero. An account's kind fixes its normal side:
//   debit  accounts: cash, receivable, stock, investment, expense
//   credit accounts: card, loan, payable, income, equity
// "natural" amounts (what the screens show) are simply debit-positive amounts turned around
// for credit accounts, so card debt, loans and income show as positive numbers.

export const DEBIT_KINDS = ['cash', 'receivable', 'stock', 'investment', 'expense'];
export const MONEY_KINDS = ['cash', 'card', 'loan', 'payable'];          // can be used to pay
export const KIND_CLASS = { cash: 'asset', receivable: 'asset', stock: 'asset', investment: 'asset', expense: 'expense',
  card: 'liability', loan: 'liability', payable: 'liability', income: 'income', equity: 'equity' };
export const isDebitKind = k => DEBIT_KINDS.includes(k);

/* ------------------------------------------------------------------ small helpers */
export const r2 = n => Math.round((Number(n) || 0) * 100 + (n < 0 ? -1e-7 : 1e-7)) / 100;
export const pad2 = n => String(n).padStart(2, '0');
export const ymd = (y, m, d) => y + '-' + pad2(m) + '-' + pad2(d);
export const todayStr = () => { const d = new Date(); return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
export const monthOf = d => String(d).slice(0, 7);
export const dim = k => new Date(+k.slice(0, 4), +k.slice(5, 7), 0).getDate();
export const addMonth = (k, n) => { let y = +k.slice(0, 4), m = +k.slice(5, 7) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + pad2(m + 1); };
export const addMonths = (date, k) => { const mk = addMonth(date.slice(0, 7), k); return mk + '-' + pad2(Math.min(+date.slice(8, 10), dim(mk))); };
export const toDate = s => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
export const fromDate = d => ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
export const addDays = (date, n) => { const d = toDate(date); d.setDate(d.getDate() + n); return fromDate(d); };
export const dayDiff = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
export const monthRange = (a, b) => { const o = []; for (let k = a; k <= b; k = addMonth(k, 1)) o.push(k); return o; };
export const splitCents = (total, n) => { const c = Math.round(Number(total || 0) * 100), b = Math.trunc(c / n), r = c - b * n; return Array.from({ length: n }, (_, i) => (b + (i < Math.abs(r) ? Math.sign(r) : 0)) / 100); };
export const trKey = s => String(s == null ? '' : s).trim().toLocaleLowerCase('tr');
export const uid = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
const sumBy = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
// first date on or after `date` that falls on day-of-month `day`
export const nextDayOfMonth = (date, day) => {
  const k = date.slice(0, 7); let d = k + '-' + pad2(Math.min(day, dim(k)));
  if (d < date) { const n = addMonth(k, 1); d = n + '-' + pad2(Math.min(day, dim(n))); }
  return d;
};

/* ------------------------------------------------------------------ model */
// data = what the database returns from app_bootstrap: { accounts, entries, marks, budgets, capex, instruments, assets, settings }
export function buildModel(data, today) {
  today = today || todayStr();
  const acc = new Map();
  (data.accounts || []).forEach(a => acc.set(a.id, { ...a, debit: isDebitKind(a.kind) }));
  const entries = data.entries || [];
  const byId = new Map(entries.map(e => [e.id, e]));
  const flat = [];
  for (const e of entries) for (const l of e.lines || []) {
    const a = acc.get(l.acc);
    if (a) flat.push({ e, l, a, amt: Number(l.amt), date: l.date, month: l.date.slice(0, 7) });
  }
  return { data, today, month: today.slice(0, 7), acc, accounts: [...acc.values()], entries, byId, flat, _c: new Map() };
}
const memo = (m, key, fn) => { if (!m._c.has(key)) m._c.set(key, fn()); return m._c.get(key); };
export const natural = (a, v) => r2(a.debit ? v : -v);
export const accountsOf = (m, kinds, withArchived) => m.accounts.filter(a => kinds.includes(a.kind) && (withArchived || !a.archived))
  .sort((x, y) => (x.sort - y.sort) || x.name.localeCompare(y.name, 'tr'));
export const systemAccount = (m, key) => m.accounts.find(a => a.system_key === key) || null;
export const rootOf = (m, e) => (e.ref && m.byId.has(e.ref)) ? m.byId.get(e.ref) : e;

/* ------------------------------------------------------------------ balances */
// posted  = lines dated up to asOf
// future  = instalments of purchases already made (entry dated up to asOf) that fall after asOf; cards only
// total   = posted + future  -> this is "card debt" everywhere in the app (the bank's "toplam borc")
export function balances(m, asOf) {
  asOf = asOf || m.today;
  return memo(m, 'bal:' + asOf, () => {
    const by = new Map();
    const get = id => { let b = by.get(id); if (!b) { b = { posted: 0, future: 0 }; by.set(id, b); } return b; };
    for (const f of m.flat) {
      if (f.date <= asOf) get(f.a.id).posted += f.amt;
      else if (f.a.kind === 'card' && f.e.date <= asOf) get(f.a.id).future += f.amt;
    }
    const rows = m.accounts.map(a => {
      const b = by.get(a.id) || { posted: 0, future: 0 };
      return { a, posted: natural(a, b.posted), future: natural(a, b.future), total: natural(a, b.posted + b.future) };
    });
    const sum = (kind, field, pred) => r2(sumBy(rows.filter(r => r.a.kind === kind && (!pred || pred(r))), r => r[field]));
    const cash = sum('cash', 'posted', r => !r.a.restricted), cardDebt = sum('card', 'total');
    return {
      asOf, rows, byId: new Map(rows.map(r => [r.a.id, r])),
      cash, restricted: sum('cash', 'posted', r => r.a.restricted),
      cardPosted: sum('card', 'posted'), cardFuture: sum('card', 'future'), cardDebt,
      loans: sum('loan', 'posted'), payables: sum('payable', 'posted'), receivables: sum('receivable', 'posted'),
      stock: sum('stock', 'posted'), investments: sum('investment', 'posted'),
      net: r2(cash - cardDebt)
    };
  });
}

/* ------------------------------------------------------------------ budget */
// One budget for the whole app: a month uses the latest row on or before it. 0 = no budget.
export function budgetFor(m, k) {
  let best = null;
  for (const b of m.data.budgets || []) if (b.month <= k && (!best || b.month >= best.month)) best = b;
  return best ? Number(best.amount) || 0 : 0;
}

/* ------------------------------------------------------------------ spend: reported and normalized */
// A purchase ("item") = root entry + expense category; instalments and returns belong to it.
// Reported   = expense lines in the month they are recognised (returns net against their purchase).
// Normalized = reported, minus excluded categories and one-offs, with "spread" purchases divided
//              equally over the months the user picked. Used by Overview, Spend, Pace and the plan.
export function spend(m) {
  return memo(m, 'spend', () => {
    const today = m.today, lineMap = new Map(), items = new Map();
    for (const f of m.flat) {
      if (f.a.kind !== 'expense') continue;
      const root = rootOf(m, f.e), key = root.id + '|' + f.a.id, lk = key + '|' + f.month;
      let x = lineMap.get(lk);
      if (!x) {
        x = { key, id: root.id, acc: f.a.id, cat: f.a.name, m: f.month, d: +f.date.slice(8, 10), date: f.date, a: 0,
          p: root.merchant || '', s: root.note || '', future: f.date > today, named: false };
        lineMap.set(lk, x);
      }
      x.a += f.amt;
      if (f.amt > 0 && !x.named) { x.d = +f.date.slice(8, 10); x.date = f.date; x.future = f.date > today; x.named = true; }
    }
    for (const x of lineMap.values()) {
      x.a = r2(x.a);
      let it = items.get(x.key);
      if (!it) {
        const root = m.byId.get(x.id);
        const inst = (root.n || 1) > 1 ? [...new Set(root.lines.filter(l => { const a = m.acc.get(l.acc); return a && MONEY_KINDS.includes(a.kind) && l.amt < 0; }).map(l => l.date.slice(0, 7)))].sort() : null;
        it = { key: x.key, id: x.id, acc: x.acc, cat: x.cat, p: x.p, s: x.s, date: root.date, inst: (root.n || 1), instMonths: inst, tot: 0, months: [], lines: [] };
        items.set(x.key, it);
      }
      it.tot += x.a; it.lines.push(x);
      if (!it.months.includes(x.m)) it.months.push(x.m);
    }
    const marks = new Map(), excluded = new Set(m.accounts.filter(a => a.kind === 'expense' && a.excluded).map(a => a.id));
    for (const z of m.data.marks || []) marks.set(z.entry + '|' + z.acc, z);

    const tx = [], parts = [];
    for (const it of items.values()) {
      it.tot = r2(it.tot); it.months.sort(); it.sm = it.months[0];
      const z = marks.get(it.key);
      it.mark = z && it.tot > 0.005 ? z : null;
      for (const x of it.lines) {
        if (x.future || Math.abs(x.a) < 0.005) continue;
        x.it = it; tx.push(x);
      }
      if (excluded.has(it.acc)) continue;
      if (!it.mark) { for (const x of it.lines) if (!x.future && Math.abs(x.a) >= 0.005) parts.push({ it, x, pm: x.m, a: x.a, spread: false }); continue; }
      if (it.mark.mode === 'one_off') continue;
      const n = it.mark.months.length;
      if (n) for (const pm of it.mark.months) parts.push({ it, x: null, pm, a: it.tot / n, spread: true });
    }
    const repBy = {}, nrmBy = {}, shareBy = {}, byDay = new Map();
    for (const x of tx) { repBy[x.m] = (repBy[x.m] || 0) + x.a; if (!byDay.has(x.date)) byDay.set(x.date, []); byDay.get(x.date).push(x); }
    for (const p of parts) { nrmBy[p.pm] = (nrmBy[p.pm] || 0) + p.a; if (p.spread) shareBy[p.pm] = (shareBy[p.pm] || 0) + p.a; }
    let first = m.month;
    for (const x of tx) if (x.m < first) first = x.m;
    const months = monthRange(first, m.month);
    // why a line is left out of normalized spend: '' | 'excl' | 'one' | 'spread'
    const why = x => excluded.has(x.acc) ? 'excl' : x.it.mark ? (x.it.mark.mode === 'one_off' ? 'one' : 'spread') : '';
    const S = {
      items, tx, parts, marks, excluded, months, byDay, why,
      rep: k => r2(repBy[k] || 0), nrm: k => r2(nrmBy[k] || 0), share: k => r2(shareBy[k] || 0),
      budget: k => budgetFor(m, k),
      // category totals of one month. maxDay limits ordinary lines to the first days of the month (same-days comparison).
      cats(k, normalized, maxDay) {
        const out = new Map(), add = (acc, a) => out.set(acc, (out.get(acc) || 0) + a);
        if (normalized) { for (const p of parts) if (p.pm === k && (p.spread || !maxDay || p.x.d <= maxDay)) add(p.it.acc, p.a); }
        else for (const x of tx) if (x.m === k && (!maxDay || x.d <= maxDay)) add(x.acc, x.a);
        return [...out].map(([acc, amount]) => ({ acc, name: (m.acc.get(acc) || {}).name || '?', amount: r2(amount) }))
          .filter(c => Math.abs(c.amount) > 0.005).sort((a, b) => b.amount - a.amount);
      },
      // how a month gets from reported to normalized
      bridge(k) {
        const rows = tx.filter(x => x.m === k);
        const ex = rows.filter(x => excluded.has(x.acc)), live = rows.filter(x => !excluded.has(x.acc));
        const one = live.filter(x => x.it.mark && x.it.mark.mode === 'one_off'), nor = live.filter(x => x.it.mark && x.it.mark.mode === 'spread');
        const rep = S.rep(k), b = {
          reported: rep, excluded: r2(sumBy(ex, x => x.a)), oneOff: r2(sumBy(one, x => x.a)), movedOut: r2(sumBy(nor, x => x.a)),
          spreadIn: S.share(k), nOne: new Set(one.map(x => x.key)).size, nSpread: new Set(nor.map(x => x.key)).size, count: rows.length
        };
        b.normalized = r2(b.reported - b.excluded - b.oneOff - b.movedOut + b.spreadIn);
        return b;
      },
      // spend of one day. Normalized: ordinary lines of that day + that day's slice of the month's spread shares.
      day(date, normalized) {
        const rows = byDay.get(date) || [];
        if (!normalized) return r2(sumBy(rows, x => x.a));
        return sumBy(rows.filter(x => !why(x)), x => x.a) + (shareBy[date.slice(0, 7)] || 0) / dim(date.slice(0, 7));   // not rounded: callers add days up
      }
    };
    return S;
  });
}

/* ------------------------------------------------------------------ overview */
// One function for the current month and for past months, so they can never disagree.
export function overview(m, month, normalized) {
  month = month && month <= m.month ? month : m.month;
  const S = spend(m), current = month === m.month;
  const asOf = current ? m.today : month + '-' + pad2(dim(month));
  const B = balances(m, asOf);
  const reported = S.rep(month), norm = S.nrm(month), spent = normalized ? norm : reported;
  const budget = S.budget(month), days = dim(month), day = current ? +m.today.slice(8, 10) : days;
  const o = {
    month, current, asOf, months: S.months, cash: B.cash, restricted: B.restricted, cardDebt: B.cardDebt, cardPosted: B.cardPosted,
    cardFuture: B.cardFuture, loans: B.loans, net: B.net, reported, normalized: norm, spent, budget,
    // the budget is always compared with NORMALIZED spend, whichever view is switched on
    daysLeft: current ? days - day + 1 : 0, leftToday: null, roomPerDay: null, monthLeft: budget > 0 ? r2(budget - norm) : null,
    categories: S.cats(month, normalized), insights: [], prev: null
  };
  if (current && budget > 0) {
    const rows = S.byDay.get(m.today) || [];
    const todaySpent = r2(sumBy(rows.filter(x => !S.why(x)), x => x.a));
    o.todaySpent = todaySpent;
    o.allowance = r2((budget - (norm - todaySpent)) / o.daysLeft);        // what today may cost, as of this morning
    o.leftToday = r2(o.allowance - todaySpent);                            // ... minus what was already spent today
    o.roomPerDay = r2((budget - norm) / o.daysLeft);
  }
  const prev = addMonth(month, -1);
  if (S.months.includes(prev)) {
    o.prev = prev;
    const before = new Map(S.cats(prev, normalized, current ? day : 0).map(c => [c.acc, c.amount]));
    o.insights = o.categories.filter(c => before.get(c.acc) > 0 && c.amount > 0)
      .map(c => ({ acc: c.acc, name: c.name, pct: Math.round((c.amount - before.get(c.acc)) / before.get(c.acc) * 1000) / 10, now: c.amount, before: before.get(c.acc) }));
  }
  o.cards = accountsOf(m, ['card']).map(a => {
    const b = B.byId.get(a.id), limit = a.credit_limit != null ? Number(a.credit_limit) : null;
    return { id: a.id, name: a.name, debt: b.total, posted: b.posted, future: b.future, limit, available: limit != null ? r2(limit - b.total) : null,
      statementDay: a.statement_day || null, dueDay: a.due_day || null, cutOff: a.statement_day ? nextDayOfMonth(m.today, a.statement_day) : null };
  }).sort((x, y) => (x.cutOff || '9') < (y.cutOff || '9') ? -1 : 1);
  o.cashAccounts = accountsOf(m, ['cash']).map(a => ({ id: a.id, name: a.name, restricted: !!a.restricted, balance: B.byId.get(a.id).posted }));
  return o;
}

/* ------------------------------------------------------------------ receivables and payables */
// Open items per account (+ person). A settlement closes the oldest open items first (FIFO).
// A receivable and a payable in the same netting group offset each other for the same person.
export function parties(m) {
  return memo(m, 'parties', () => {
    const seen = new Map();
    for (const f of m.flat) if (f.l.party && !seen.has(trKey(f.l.party))) seen.set(trKey(f.l.party), f.l.party);
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'tr'));
  });
}
function dueDate(m, a, date, entry) {
  if (a.due_mode === 'statement') {
    const card = (entry.lines || []).map(l => m.acc.get(l.acc)).find(c => c && c.kind === 'card' && c.statement_day);
    if (card) return nextDayOfMonth(date, card.statement_day);
  }
  return addDays(date, a.due_days || 30);
}
export function receivables(m) {
  return memo(m, 'recv', () => {
    const today = m.today, groups = new Map(), stats = { ar: { paid: [], all: [], created90: 0 }, ap: { paid: [], all: [], created90: 0 } };
    const evs = m.flat.filter(f => f.a.kind === 'receivable' || f.a.kind === 'payable')
      .map(f => ({ f, side: f.a.kind === 'receivable' ? 'ar' : 'ap', create: f.a.kind === 'receivable' ? f.amt > 0 : f.amt < 0 }))
      .sort((x, y) => x.f.date < y.f.date ? -1 : x.f.date > y.f.date ? 1 : (x.create ? 0 : 1) - (y.create ? 0 : 1));
    for (const { f, side, create } of evs) {
      const party = f.a.per_party ? (f.l.party || '?') : '', key = f.a.id + '|' + trKey(party);
      let g = groups.get(key);
      if (!g) { g = { key, side, acc: f.a.id, account: f.a.name, party, label: party || f.a.name, group: f.a.netting_group || '', queue: [], credit: 0, netted: 0 }; groups.set(key, g); }
      const st = stats[side], v = Math.abs(f.amt);
      if (create) {
        const it = { date: f.date, due: dueDate(m, f.a, f.date, f.e), merchant: f.e.merchant || '', note: f.e.note || '', amount: v, open: v, entry: f.e.id };
        if (g.credit > 0.005) { const t = Math.min(g.credit, it.open); it.open = r2(it.open - t); g.credit = r2(g.credit - t); }
        g.queue.push(it); st.all.push(it);
        if (dayDiff(f.date, today) <= 90) st.created90 += v;
      } else {
        let left = v;
        for (const it of g.queue) {
          if (left <= 0.005) break;
          if (it.open <= 0.005) continue;
          const t = Math.min(it.open, left);
          it.open = r2(it.open - t); left = r2(left - t);
          st.paid.push({ days: dayDiff(it.date, f.date), amt: t });
        }
        if (left > 0.005) g.credit = r2(g.credit + left);
      }
    }
    // netting (same group, same person)
    const openOf = g => r2(sumBy(g.queue, i => i.open > 0.005 ? i.open : 0));
    const take = (g, amt) => { for (const i of g.queue) { if (amt <= 0.005) break; if (i.open <= 0.005) continue; const t = Math.min(i.open, amt); i.open = r2(i.open - t); amt = r2(amt - t); } };
    for (const a of groups.values()) {
      if (a.side !== 'ar' || !a.group || !a.party) continue;
      for (const p of groups.values()) {
        if (p.side !== 'ap' || p.group !== a.group || trKey(p.party) !== trKey(a.party)) continue;
        const amt = r2(Math.min(openOf(a), openOf(p)));
        if (amt > 0.005) { take(a, amt); take(p, amt); a.netted = r2(a.netted + amt); p.netted = r2(p.netted + amt); }
      }
    }
    const finish = side => {
      const st = stats[side];
      const row = i => ({ ...i, age: dayDiff(i.date, today), overdueDays: dayDiff(i.due, today) });
      const open = st.all.filter(i => i.open > 0.005).map(row);
      const gs = [...groups.values()].filter(g => g.side === side).map(g => {
        const items = g.queue.filter(i => i.open > 0.005).map(row).sort((a, b) => b.age - a.age);
        return { key: g.key, acc: g.acc, account: g.account, party: g.party, label: g.label, outstanding: r2(sumBy(items, i => i.open)),
          overdue: r2(sumBy(items.filter(i => i.overdueDays > 0), i => i.open)), credit: g.credit > 0.005 ? g.credit : 0, netted: g.netted, count: items.length, items };
      }).filter(g => g.outstanding > 0.005 || g.credit > 0.005).sort((a, b) => (b.overdue - a.overdue) || (b.outstanding - a.outstanding));
      const outstanding = r2(sumBy(open, i => i.open)), paidTotal = sumBy(st.paid, x => x.amt);
      const bucket = (lo, hi) => r2(sumBy(open.filter(i => i.age >= lo && i.age <= hi), i => i.open));
      return {
        outstanding, overdue: r2(sumBy(open.filter(i => i.overdueDays > 0), i => i.open)),
        days: st.created90 ? outstanding / st.created90 * 90 : 0,
        avgDays: paidTotal ? sumBy(st.paid, x => x.days * x.amt) / paidTotal : null,
        buckets: [['0-30', bucket(-99999, 30)], ['31-60', bucket(31, 60)], ['61-90', bucket(61, 90)], ['90+', bucket(91, 99999)]].map(([label, amount]) => ({ label, amount })),
        groups: gs, raw: open.map(i => ({ due: i.due, open: i.open }))
      };
    };
    return { ar: finish('ar'), ap: finish('ap') };
  });
}

/* ------------------------------------------------------------------ consumables (stock) */
export function inventory(m) {
  return memo(m, 'inv', () => {
    const map = new Map();
    for (const f of m.flat) {
      if (f.a.kind !== 'stock') continue;
      const name = (f.l.item || f.e.merchant || '').trim();
      if (!name) continue;
      const key = f.a.id + '|' + trKey(name);
      let it = map.get(key);
      if (!it) { it = { key, acc: f.a.id, name, unit: '', qty: 0, value: 0, boughtQty: 0, boughtValue: 0, usedQty: 0, usedValue: 0, lastCat: '', lastAt: '', moves: [] }; map.set(key, it); }
      const q = Number(f.l.qty) || 0;
      it.qty += q; it.value += f.amt;
      if (f.l.unit) it.unit = f.l.unit;
      let cat = '';
      if (f.amt >= 0) { it.boughtQty += Math.abs(q); it.boughtValue += f.amt; }
      else {
        it.usedQty += Math.abs(q); it.usedValue += -f.amt;
        const ex = f.e.lines.map(l => m.acc.get(l.acc)).find(a => a && a.kind === 'expense');
        cat = ex ? ex.name : '';
        if (ex && f.date >= it.lastAt) { it.lastCat = ex.id; it.lastAt = f.date; }
      }
      it.moves.push({ date: f.date, qty: q, value: r2(f.amt), cat, entry: f.e.id });
    }
    const items = [...map.values()].map(it => {
      it.qty = Math.round(it.qty * 1e6) / 1e6; it.value = r2(it.value);
      it.status = it.qty <= 1e-6 && Math.abs(it.value) < 0.5 ? 'used' : 'active';
      it.unitCost = it.qty > 1e-6 ? it.value / it.qty : 0;
      it.moves.sort((a, b) => a.date < b.date ? 1 : -1);
      return it;
    }).sort((a, b) => a.status !== b.status ? (a.status === 'active' ? -1 : 1) : b.value - a.value);
    const active = items.filter(i => i.status === 'active');
    return { items, value: r2(sumBy(active, i => i.value)), active: active.length };
  });
}

/* ------------------------------------------------------------------ investments */
export function holdings(m) {
  return memo(m, 'hold', () => {
    const map = new Map(), meta = new Map((m.data.instruments || []).map(i => [trKey(i.symbol), i]));
    for (const f of m.flat) {
      if (f.a.kind !== 'investment') continue;
      const sym = (f.l.item || '').trim() || '?';
      let h = map.get(trKey(sym));
      if (!h) { h = { symbol: sym, acc: f.a.id, qty: 0, cost: 0 }; map.set(trKey(sym), h); }
      h.qty += Number(f.l.qty) || 0; h.cost += f.amt;
    }
    const rows = [...map.values()].map(h => {
      const i = meta.get(trKey(h.symbol)) || {};
      h.qty = Math.round(h.qty * 1e8) / 1e8; h.cost = r2(h.cost);
      h.avg = h.qty > 1e-9 ? h.cost / h.qty : 0;
      h.price = i.price != null ? Number(i.price) : null; h.priceDate = i.price_date || null;
      h.class = i.class || ''; h.cat2 = i.cat2 || ''; h.cat3 = i.cat3 || ''; h.horizon = i.horizon || '';
      h.value = h.price != null ? r2(h.qty * h.price) : h.cost;
      h.pl = r2(h.value - h.cost); h.plPct = h.cost > 0.005 ? h.pl / h.cost : 0;
      return h;
    }).filter(h => h.qty > 1e-9 || Math.abs(h.cost) > 0.005).sort((a, b) => b.value - a.value);
    const value = r2(sumBy(rows, h => h.value)), cost = r2(sumBy(rows, h => h.cost)), cls = new Map();
    rows.forEach(h => cls.set(h.class || '', (cls.get(h.class || '') || 0) + h.value));
    return { rows, value, cost, pl: r2(value - cost), plPct: cost > 0.005 ? (value - cost) / cost : 0,
      classes: [...cls].map(([name, v]) => ({ name, value: r2(v), share: value ? v / value : 0 })).sort((a, b) => b.value - a.value) };
  });
}

/* ------------------------------------------------------------------ cash-flow plan */
// Net position = cash - card debt. Per month: + income + collections due - spend - payables due - capex instalments.
// Spend assumption = the budget; without one, the average normalized spend of the full months that have data.
export function plan(m) {
  return memo(m, 'plan', () => {
    const S = spend(m), cur = m.month, keys = Array.from({ length: 60 }, (_, i) => addMonth(cur, i)), idx = new Map(keys.map((k, i) => [k, i]));
    const inc = {};
    for (const f of m.flat) if (f.a.kind === 'income') inc[f.month] = (inc[f.month] || 0) - f.amt;
    // averages only look at complete months that have data (a new user with 2 months of history divides by 2, not 6)
    let firstInc = cur, firstExp = cur;
    for (const f of m.flat) {
      if (f.a.kind === 'income' && f.month < firstInc) firstInc = f.month;
      if (f.a.kind === 'expense' && f.month < firstExp) firstExp = f.month;
    }
    const prevM = addMonth(cur, -1), fullInc = monthRange(firstInc, prevM).slice(-3), full = monthRange(firstExp, prevM).slice(-6);
    const avg = (ks, f) => ks.length ? sumBy(ks, f) / ks.length : 0;
    const incomeAuto = r2(avg(fullInc, k => inc[k] || 0)), spendAuto = r2(avg(full, k => S.nrm(k)));
    const set = (m.data.settings && m.data.settings.plan) || {};
    const incomeSet = Number(set.income) || 0, budget = S.budget(cur);
    // what the projection spends each month: the average of normalized spend (default, evidence based) or the budget
    const basis = (set.basis === 'budget' && budget) || !spendAuto ? (budget ? 'budget' : 'avg') : 'avg';
    const income = incomeSet || incomeAuto, spendA = basis === 'budget' ? budget : spendAuto;
    const B = balances(m), R = receivables(m);
    const capex = {}, items = (m.data.capex || []).map(it => {
      const r = (Number(it.rate) || 0) / 100, n = Number(it.n) || 1, price = Number(it.price) || 0;
      const pmt = r > 0 ? price * r / (1 - Math.pow(1 + r, -n)) : price / n;
      let left = 0;
      for (let j = 0; j < n; j++) { const k = addMonth(String(it.date).slice(0, 7), j); if (idx.has(k)) { capex[k] = (capex[k] || 0) + pmt; left += pmt; } }
      return { ...it, pmt: r2(pmt), total: r2(pmt * n), interest: r2(pmt * n - price), left: r2(left) };
    }).sort((a, b) => a.date < b.date ? -1 : 1);
    const byDue = list => { const o = {}; list.forEach(x => { const k = (x.due < m.today ? m.today : x.due).slice(0, 7); if (idx.has(k)) o[k] = (o[k] || 0) + x.open; }); return o; };
    const coll = byDue(R.ar.raw), pay = byDue(R.ap.raw);
    let closing = B.net;
    const rows = keys.map((k, i) => {
      const income_ = i === 0 ? Math.max(income - (inc[k] || 0), 0) : income;
      const spend_ = i === 0 ? Math.max(spendA - S.nrm(k), 0) : spendA;
      const c = coll[k] || 0, p = pay[k] || 0, cx = capex[k] || 0, net = income_ + c - spend_ - p - cx;
      closing += net;
      return { m: k, income: r2(income_), collections: r2(c), spend: r2(spend_), payables: r2(p), capex: r2(cx), net: r2(net), closing: r2(closing) };
    });
    const shown = rows.slice(0, 12), low = shown.reduce((a, b) => b.closing < a.closing ? b : a), be = rows.find(r => r.closing >= 0);
    return {
      items, months: shown,
      assumptions: { income, incomeAuto, incomeSet, spend: spendA, spendAuto, budget, basis, cash: B.cash, card: B.cardDebt, opening: B.net, months: full.length },
      summary: { lowest: low.closing, lowestMonth: low.m, freeCashFlow: r2(income - spendA), capexLeft: r2(sumBy(items, x => x.left)), breakEven: be ? be.m : null }
    };
  });
}

/* ------------------------------------------------------------------ statements */
export function incomeStatement(m) {
  return memo(m, 'is', () => {
    const tot = new Map(); let first = m.month, last = m.month;
    for (const f of m.flat) {
      if (f.a.kind !== 'income' && f.a.kind !== 'expense') continue;
      const k = f.a.id + '|' + f.month; tot.set(k, (tot.get(k) || 0) + f.amt);
      if (f.month < first) first = f.month;
      if (f.month > last && f.month <= addMonth(m.month, 12)) last = f.month;
    }
    const months = monthRange(first, last), val = (a, k) => natural(a, tot.get(a.id + '|' + k) || 0);
    const used = a => months.some(k => Math.abs(val(a, k)) > 0.005);
    const rows = [], addTotal = (label, list, cls) => rows.push({ type: cls || 'total', label, values: months.map(k => r2(sumBy(list, a => val(a, k)))) });
    const income = m.accounts.filter(a => a.kind === 'income' && used(a)).sort((x, y) => x.sort - y.sort);
    const expense = m.accounts.filter(a => a.kind === 'expense' && used(a)).sort((x, y) => x.sort - y.sort);
    income.forEach(a => rows.push({ type: 'row', label: a.name, acc: a.id, values: months.map(k => val(a, k)) }));
    addTotal('INCOME', income);
    const groups = [...new Set(expense.map(a => a.group_name || ''))];
    groups.forEach(g => {
      const list = expense.filter(a => (a.group_name || '') === g);
      list.forEach(a => rows.push({ type: 'row', label: a.name, acc: a.id, values: months.map(k => val(a, k)) }));
      if (g && groups.length > 1) addTotal(g, list, 'sub');
    });
    addTotal('EXPENSES', expense);
    rows.push({ type: 'total', label: 'NET', values: months.map(k => r2(sumBy(income, a => val(a, k)) - sumBy(expense, a => val(a, k)))) });
    return { months, rows };
  });
}
// Net worth at each month end (today for the current month). Card debt includes future instalments,
// investments are at cost, other assets at the value entered for them.
export function netWorth(m) {
  return memo(m, 'bs', () => {
    let first = m.month;
    for (const e of m.entries) if (e.kind !== 'opening' && e.date.slice(0, 7) < first) first = e.date.slice(0, 7);
    const months = monthRange(first, m.month), ends = months.map(k => k === m.month ? m.today : k + '-' + pad2(dim(k)));
    const B = ends.map(d => balances(m, d)), rows = [];
    const line = (label, f, type) => { const values = B.map((b, i) => r2(f(b, ends[i]))); if (type || values.some(v => Math.abs(v) > 0.005)) rows.push({ type: type || 'row', label, values }); return values; };
    const accRow = (a, field) => line(a.name, b => b.byId.get(a.id)[field]);
    const sortA = kinds => m.accounts.filter(a => kinds.includes(a.kind)).sort((x, y) => x.sort - y.sort);
    sortA(['cash']).forEach(a => accRow(a, 'posted'));
    sortA(['receivable']).forEach(a => accRow(a, 'posted'));
    line('@investments', b => b.investments);
    sortA(['stock']).forEach(a => accRow(a, 'posted'));
    const assetGroups = [...new Set((m.data.assets || []).map(s => s.group_name || ''))];
    const assetVal = (g, d) => sumBy((m.data.assets || []).filter(s => (s.group_name || '') === g && s.date <= d), s => Number(s.value) || 0);
    assetGroups.forEach(g => line(g || '@otherAssets', (b, d) => assetVal(g, d)));
    const assets = line('@totalAssets', (b, d) => b.cash + b.restricted + b.receivables + b.investments + b.stock + sumBy(assetGroups, g => assetVal(g, d)), 'total');
    sortA(['card']).forEach(a => accRow(a, 'total'));
    sortA(['loan']).forEach(a => accRow(a, 'posted'));
    sortA(['payable']).forEach(a => accRow(a, 'posted'));
    const liab = line('@totalLiabilities', b => b.cardDebt + b.loans + b.payables, 'total');
    rows.push({ type: 'total', label: '@netWorth', values: assets.map((v, i) => r2(v - liab[i])) });
    return { months, rows };
  });
}

/* ------------------------------------------------------------------ transactions list */
// Turns an entry into what the Transactions screen shows. Works from the lines, not from the entry kind.
export function describe(m, e) {
  const L = (e.lines || []).map(l => ({ l, a: m.acc.get(l.acc) })).filter(x => x.a);
  const money = L.filter(x => MONEY_KINDS.includes(x.a.kind)), deb = L.filter(x => x.l.amt > 0), cre = L.filter(x => x.l.amt < 0);
  const group = list => { const g = new Map(); list.forEach(x => { const k = x.a.id + '|' + (x.l.party || ''); const o = g.get(k) || { acc: x.a.id, name: x.a.name, kind: x.a.kind, party: x.l.party || '', amount: 0, item: x.l.item || '', qty: 0, unit: x.l.unit || '' }; o.amount = r2(o.amount + Math.abs(x.l.amt)); o.qty += Math.abs(Number(x.l.qty) || 0); g.set(k, o); }); return [...g.values()]; };
  const d = { id: e.id, kind: e.kind, date: e.date, rdate: e.rdate, merchant: e.merchant || '', note: e.note || '', n: e.n || 1, src: e.src, ref: e.ref || null, sign: 0, cats: [], pay: null, from: null, to: null };
  const name = x => x ? x.a.name : '';
  const firstDistinct = list => [...new Map(list.map(x => [x.a.id, x])).values()];
  const party = L.map(x => x.l.party).find(Boolean) || '';
  d.party = party;
  if (e.kind === 'transfer' || e.kind === 'settle') {
    d.from = name(cre[0]); d.to = name(deb[0]); d.fromId = cre[0] && cre[0].a.id; d.toId = deb[0] && deb[0].a.id;
    d.amount = r2(sumBy(deb, x => x.l.amt));
  } else if (e.kind === 'income' || e.kind === 'invest_sell' || e.kind === 'return') {
    const pay = deb.filter(x => MONEY_KINDS.includes(x.a.kind));
    d.pay = name(pay[0]); d.payId = pay[0] && pay[0].a.id; d.amount = r2(sumBy(pay, x => x.l.amt)); d.sign = 1; d.cats = group(cre);
  } else if (e.kind === 'opening' || e.kind === 'adjust' || e.kind === 'reconcile') {
    const main = L.filter(x => x.a.kind !== 'equity' && x.a.kind !== 'expense' && x.a.kind !== 'income');
    const x = main[0] || L[0];
    d.pay = name(x); d.payId = x && x.a.id;
    const v = r2(sumBy(main.length ? main : [x], y => natural(y.a, y.l.amt)));
    d.amount = Math.abs(v); d.sign = (x && x.a.debit ? v : -v) >= 0 ? 1 : -1;
    d.cats = group(L.filter(y => y !== x && (y.a.kind === 'expense' || y.a.kind === 'income')));
  } else {   // expense, stock_in, stock_use, invest_buy
    const pay = cre.filter(x => MONEY_KINDS.includes(x.a.kind) || x.a.kind === 'stock');
    const src = pay.length ? pay : cre, accs = firstDistinct(src);
    d.pay = name(accs[0]); d.payId = accs[0] && accs[0].a.id; d.amount = r2(-sumBy(src, x => x.l.amt)); d.sign = -1; d.cats = group(deb);
    d.firstDate = src.length ? src.map(x => x.l.date).sort()[0] : e.date;
  }
  return d;
}
export function txList(m) {
  return memo(m, 'tx', () => {
    const kids = new Map();
    const isKid = e => e.kind === 'return' && e.ref && m.byId.has(e.ref);        // returns are shown inside their purchase
    for (const e of m.entries) if (isKid(e)) { if (!kids.has(e.ref)) kids.set(e.ref, []); kids.get(e.ref).push(e); }
    return m.entries.filter(e => !isKid(e)).map(e => {
      const d = describe(m, e), rets = (kids.get(e.id) || []).map(r => describe(m, r));
      d.returns = rets; d.returned = r2(sumBy(rets, r => r.amount)); d.net = r2(d.amount - d.returned);
      // what is still left per expense category after returns
      d.left = d.cats.filter(c => c.kind === 'expense').map(c => ({ ...c, amount: r2(c.amount - sumBy(rets, r => sumBy(r.cats.filter(x => x.acc === c.acc), x => x.amount))) })).filter(c => c.amount > 0.005);
      return d;
    }).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  });
}

/* ------------------------------------------------------------------ merchants history (statement import) */
export function merchantHistory(m) {
  return memo(m, 'merch', () => {
    const out = new Map();
    for (const e of m.entries) {
      if (e.kind !== 'expense' && e.kind !== 'income') continue;
      const name = (e.merchant || '').trim(); if (!name) continue;
      const best = e.lines.map(l => ({ l, a: m.acc.get(l.acc) })).filter(x => x.a && (x.a.kind === 'expense' || x.a.kind === 'income'))
        .sort((x, y) => Math.abs(y.l.amt) - Math.abs(x.l.amt))[0];
      if (!best) continue;
      const k = best.a.kind + '|' + trKey(name) + '|' + best.a.id;
      const o = out.get(k) || { n: name, acc: best.a.id, c: best.a.name, k: best.a.kind === 'expense' ? 'exp' : 'inc', cnt: 0, t: '' };
      o.cnt++; if (e.date > o.t) o.t = e.date; out.set(k, o);
    }
    return [...out.values()].sort((a, b) => b.cnt - a.cnt);
  });
}
