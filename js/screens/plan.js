// plan.js - Cashflow & capex: the one place the budget is set, plus a 12-month projection of the net cash position.
import { h, useState, useEffect, Frag, F, In, NumIn, DateIn, Dd, Er, Metric, Pills, num, useAct } from '../lib.js';
import { plan, r2 } from '../engine.js';
import { t, tf, tl, ml, mlong } from '../prefs.js';
import { setBudget, saveSettings, saveCapex, deleteCapex, say } from '../store.js';

function ClosingBars({ rows }) {
  const W = 300, H = 110, bw = W / rows.length, hi = Math.max(0, ...rows.map(r => r.closing)), lo = Math.min(0, ...rows.map(r => r.closing)), sp = Math.max(1, hi - lo), z = hi / sp * H;
  return h('svg', { viewBox: '0 0 ' + W + ' ' + (H + 18), width: '100%', role: 'img', 'aria-label': t('Projected net position by month') },
    h('line', { x1: 0, x2: W, y1: z, y2: z, stroke: 'var(--mut)', opacity: 0.4 }),
    rows.map((r, i) => {
      const bh = Math.abs(r.closing) / sp * H, x = i * bw + bw * 0.15;
      return h('g', { key: r.m }, h('rect', { x, y: r.closing >= 0 ? z - bh : z, width: bw * 0.7, height: Math.max(bh, 1), fill: r.closing >= 0 ? 'var(--txt)' : '#ff8c77', rx: 2 }),
        h('text', { x: x + bw * 0.35, y: H + 13, fontSize: 8, fill: 'var(--mut)', textAnchor: 'middle' }, ml(r.m).slice(0, 3)));
    }));
}

export function Plan({ m }) {
  const d = plan(m), a = d.assumptions, s = d.summary;
  const [inc, setInc] = useState(a.incomeSet ? String(a.incomeSet) : ''), [bud, setBud] = useState(a.budget ? String(a.budget) : '');
  const [nm, setNm] = useState(''), [pr, setPr] = useState(''), [dt, setDt] = useState(m.today), [n, setN] = useState(1), [rt, setRt] = useState('');
  const [run, busy, err] = useAct();
  useEffect(() => { setBud(a.budget ? String(a.budget) : ''); }, [a.budget]);
  const saveA = () => run(async () => {
    const b = bud.trim() === '' ? 0 : num(bud), i = inc.trim() === '' ? 0 : num(inc);
    if (b < 0 || i < 0) throw new Error('Values must be 0 or more.');
    if (r2(b) !== r2(a.budget)) await setBudget(m.month, b);
    saveSettings({ plan: { income: i || null, basis: a.basis } });
    say(t('Saved ✓'));
  });
  const addCapex = () => run(async () => {
    if (!nm.trim()) throw new Error('Name is required.');
    if (!(num(pr) > 0)) throw new Error('Price must be a positive number.');
    await saveCapex({ name: nm.trim(), price: num(pr), date: dt, n, rate: num(rt) });
    setNm(''); setPr(''); setN(1); setRt('');
  });
  return h(Frag, null,
    h('div.g2', null,
      Metric(t('Net position today'), tl(a.opening, 0)), Metric(t('Cash − card debt'), tl(a.cash, 0) + ' − ' + tl(a.card, 0)),
      Metric(t('Free cash flow / month'), tl(s.freeCashFlow, 0)), Metric(t('Capex committed'), tl(s.capexLeft, 0)),
      Metric(t('Lowest point (12 mo)'), tl(s.lowest, 0) + ' · ' + ml(s.lowestMonth)), Metric(t('Net position ≥ 0'), s.breakEven ? ml(s.breakEven) : t('Beyond 5 years'))),
    h('div.card', null, h('div.lb', t('Projected net position (cash − card debt), month-end')), h(ClosingBars, { rows: d.months })),
    h('div.card', null, h('div.lb', t('Budget and assumptions')),
      F(t('Monthly budget'), NumIn(bud, setBud, { placeholder: a.spendAuto ? tf('No budget · average normalized spend is {0}', tl(a.spendAuto, 0)) : t('e.g. 30000') }),
        tf('This is the app\'s only budget: Overview, Spend & budget and Pace all use it, starting {0}. Earlier months keep the budget they had. It is checked against normalized spend.', mlong(m.month))),
      a.budget && a.spendAuto ? F(t('The projection spends'), h(Pills, { v: a.basis, set: v => saveSettings({ plan: { income: a.incomeSet || null, basis: v } }),
        o: [['avg', tf('Average normalized spend · {0}', tl(a.spendAuto, 0))], ['budget', tf('The budget · {0}', tl(a.budget, 0))]] })) : null,
      F(t('Monthly income'), NumIn(inc, setInc, { placeholder: tf('Automatic · {0} (average of the last full months)', tl(a.incomeAuto, 0)) })),
      h(Er, { e: err }),
      h('div.row', { style: { marginTop: 10 } }, h('button.btn', { disabled: busy, onClick: saveA }, busy ? t('Saving...') : t('Save'))),
      h('div.help', null, tf('The projection spends {0} a month ({1}). Also included: receivables at their due dates, payables due, and every capex instalment below. Card debt already contains future instalments.', tl(a.spend, 0), a.basis === 'budget' ? t('the budget') : tf('average of {0} full months', a.months)))),
    h('div.card', null, h('div.lb', t('Planned capex')), !d.items.length ? h('div.help', t('Nothing planned yet.')) : null,
      d.items.map(it => h('div.li', { key: it.id },
        h('div', { style: { flex: 1 } }, h('b', null, it.name), h('div.help', { style: { marginTop: 2 } }, tf('{0} × {1} from {2}', it.n, tl(it.pmt, 0), ml(String(it.date).slice(0, 7))) + (it.interest > 1 ? ' · ' + tf('interest {0}', tl(it.interest, 0)) : ''))),
        h('b', null, tl(it.total, 0)), h('button.sb.dl', { disabled: busy, onClick: () => run(() => deleteCapex(it.id)) }, t('Delete')))),
      F(t('Item'), In(nm, setNm, { placeholder: t('Item (e.g. Phone)') })), F(t('Price (₺)'), NumIn(pr, setPr, { placeholder: '0' })), F(t('First payment date'), DateIn(dt, setDt)),
      F(t('Instalments'), h(Dd, { v: n, on: setN, opts: [1, 2, 3, 4, 6, 9, 12, 18, 24, 36].map(v => ({ v, l: v === 1 ? t('Single payment') : tf('{0} instalments', v) })) })),
      n > 1 ? F(t('Monthly interest %'), NumIn(rt, setRt, { placeholder: t('Optional') })) : null,
      h('div.row', { style: { marginTop: 10 } }, h('button.btn', { disabled: busy, onClick: addCapex }, t('Add to plan')))),
    h('div.card', { style: { padding: '14px 0' } }, h('div.lb', { style: { padding: '0 16px 8px' } }, t('Monthly projection')),
      h('div.scrollx', null, h('table.tbl', null,
        h('thead', null, h('tr', null, [t('Month'), t('In'), t('Out'), t('Capex'), t('Closing')].map(c => h('th.lb', { key: c }, c)))),
        h('tbody', null, d.months.map(r => h('tr', { key: r.m }, h('td', null, ml(r.m)), h('td', null, tl(r.income + r.collections, 0)), h('td', null, tl(r.spend + r.payables, 0)), h('td', null, r.capex ? tl(r.capex, 0) : '-'), h('td', { className: r.closing < 0 ? 'dn' : 'up' }, tl(r.closing, 0)))))))));
}
