// pace.js - Pace: day-by-day and week-by-week spend against the budget per day.
// Uses the same reported / normalized figures as Spend & budget (engine.spend), so the two pages always agree:
// in the Diligence view a day = that day's ordinary purchases + that day's slice of the month's spread shares.
import { h, React, useState, useRef, useLayoutEffect, Frag, Ic, Em, Sw, P, cx } from '../lib.js';
import { spend, dim, pad2, ymd, toDate, fromDate, addDays } from '../engine.js';
import { t, tf, tl, nfmt, mv, PREF, LOC } from '../prefs.js';
import { saveSettings } from '../store.js';

const PCC = ['var(--txt)', '#ff8c77', '#bdedf2', '#dfff00'], PCO = '#8a8d80', SHARE = 'var(--bd)';
const nice = v => { const p = Math.pow(10, Math.floor(Math.log10(v))), r = v / p; return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p; };
const H = 132;

export function Pace({ m }) {
  const S = spend(m), dil = PREF.dil;
  const [view, setView] = useState('day'), [wo, setWo] = useState(0), [sel, setSel] = useState(null), [alt, setAlt] = useState(false), [cnt, setCnt] = useState(5);
  const scR = useRef(null), stR = useRef(0), tch = useRef(false), act = useRef(false), nPg = useRef(1);
  // week pager: one page per week, swiped sideways (scroll-snap); the settled page becomes the current week
  useLayoutEffect(() => { const el = scR.current; if (!el || !el.clientWidth || tch.current) return; const i = nPg.current - 1 + wo; if (Math.round(el.scrollLeft / el.clientWidth) !== i) el.scrollLeft = i * el.clientWidth; });
  const wk = view === 'week', today = m.today, tdy = toDate(today), ti = (tdy.getDay() + 6) % 7;
  const fmtD = (k, o) => toDate(k).toLocaleDateString(LOC(), o), short = { day: 'numeric', month: 'short' };
  const dlab = k => fmtD(k, { weekday: 'short', day: 'numeric', month: 'short' });
  const mkDays = start => Array.from({ length: 7 }, (_, i) => { const k = addDays(start, i); return { k, m: k.slice(0, 7), d: +k.slice(8, 10), fut: k > today, dim: dim(k.slice(0, 7)) }; });
  const lines = y => S.byDay.get(y.k) || [];
  const val = x => (dil && S.why(x) ? 0 : x.a);
  const share = y => (dil && !y.fut ? S.share(y.m) / y.dim : 0);            // the day's slice of spread purchases
  const tot = y => lines(y).reduce((s, x) => s + val(x), 0) + share(y);
  const bud = y => { const b = S.budget(y.m); return b ? b / y.dim : 0; };
  // weeks available: from the first month in the data up to this week
  const curMon = addDays(today, -ti), first = S.months[0] + '-01', firstMon = addDays(first, -((toDate(first).getDay() + 6) % 7));
  const nW = Math.min(52, Math.max(1, Math.round((toDate(curMon) - toDate(firstMon)) / 6048e5) + 1));
  nPg.current = nW;
  const offs = Array.from({ length: nW }, (_, i) => i - nW + 1);
  const wkOf = off => {
    const mon = addDays(curMon, off * 7), days = mkDays(mon), ldays = mkDays(addDays(mon, -7)), el = days.filter(y => !y.fut);
    // colours: the top 4 categories of the week keep a colour, the rest share grey
    const cw = {}; el.flatMap(lines).forEach(x => { cw[x.acc] = (cw[x.acc] || 0) + val(x); });
    const rank = Object.keys(cw).filter(c => cw[c] > 0).sort((a, b) => cw[b] - cw[a]), grp = c => { const i = rank.indexOf(c); return i > -1 && i < 4 ? i : 4; }, col = c => (grp(c) < 4 ? PCC[grp(c)] : PCO);
    const bl = bud(el.length ? el[el.length - 1] : days[0]);
    const dmax = Math.max(0, ...days.map(y => (y.fut ? 0 : tot(y))), ...(wk ? ldays.map(tot) : [0])), ym = nice(Math.max(dmax, bl * 1.2, 1));
    const cols = days.map((y, i) => {
      const g = [0, 0, 0, 0, 0]; lines(y).forEach(x => { g[grp(x.acc)] += val(x); });
      const segs = g.map((v, k) => ({ v, k })).filter(s => s.v > 0).map(s => ({ h: Math.max(2, Math.round(s.v / ym * H)), c: s.k < 4 ? PCC[s.k] : PCO }));
      if (share(y) > 0.5) segs.unshift({ h: Math.max(2, Math.round(share(y) / ym * H)), c: SHARE });
      return { y, t: tot(y), segs, ghost: wk ? Math.round(tot(ldays[i]) / ym * H) : 0 };
    });
    return { off, days, ldays, el, col, cols, ym, bl, rng: fmtD(days[0].k, short) + ' – ' + fmtD(days[6].k, short) };
  };
  const W = wkOf(wo), days = W.days, ldays = W.ldays, el = W.el, nEl = el.length, col = W.col;
  const sd = days.find(y => y.k === sel) || (wo === 0 ? days[ti] : days[6]);
  const sc = wk ? el : [sd], scLines = sc.flatMap(lines), prevSc = wk ? ldays.slice(0, nEl) : [];
  const amt = sc.reduce((s, y) => s + tot(y), 0), shareAmt = sc.reduce((s, y) => s + share(y), 0), leftOut = scLines.filter(x => S.why(x)).reduce((s, x) => s + x.a, 0);
  const prevAmt = prevSc.reduce((s, y) => s + tot(y), 0), pct = wk && prevAmt > 0.5 ? Math.round((amt / prevAmt - 1) * 100) : null;
  // the budget is always compared with normalized spend, also when the bars show reported spend
  const totN = y => lines(y).reduce((s, x) => s + (S.why(x) ? 0 : x.a), 0) + (y.fut ? 0 : S.share(y.m) / y.dim), amtN = sc.reduce((s, y) => s + totN(y), 0);
  const dB = bud(sd), wkB = days.reduce((s, y) => s + bud(y), 0), expB = el.reduce((s, y) => s + bud(y), 0), hasB = wk ? wkB > 0 : dB > 0, diff = (wk ? expB : dB) - amtN;
  // categories of the scope
  const cs = {}; scLines.forEach(x => { cs[x.acc] = (cs[x.acc] || 0) + val(x); });
  const cl = Object.keys(cs).filter(c => cs[c] > 0).sort((a, b) => cs[b] - cs[a]), csTot = cl.reduce((s, c) => s + cs[c], 0) || 1;
  const cp = {}; prevSc.flatMap(lines).forEach(x => { cp[x.acc] = (cp[x.acc] || 0) + val(x); });
  const chg = c => (cp[c] > 0.5 ? Math.round((cs[c] / cp[c] - 1) * 100) : null);
  const name = c => (m.acc.get(c) || {}).name || '?';
  let ins = null; if (wk) cl.forEach(c => { const p = chg(c); if (p !== null && Math.abs(p) >= 8 && (!ins || Math.abs(p) > Math.abs(ins.p))) ins = { c, p }; });
  const mode = wk ? (alt ? 'tx' : 'cat') : (alt ? 'cat' : 'tx');
  const txs = scLines.slice().sort((a, b) => val(b) - val(a) || b.a - a.a);
  const lt = x => ({ one: t('One-off'), spread: t('Normalized'), excl: t('Excluded') })[S.why(x)];
  const status = !hasB ? t('No budget set') : (diff >= 0 ? '▼ ' : '▲ ') + tf(wk ? (diff >= 0 ? '{0} under pace' : '{0} over pace') : (diff >= 0 ? '{0} under budget' : '{0} over budget'), tl(Math.abs(diff), 0)) + (dil ? '' : ' · ' + t('normalized'));
  const when = wk ? W.rng : (sd.k === today ? t('Today') : dlab(sd.k));
  const side = wk ? (pct === null ? null : (pct > 0 ? '▲ ' : '▼ ') + Math.abs(pct) + '% ' + t('vs last week')) : (dil && leftOut > 0 ? '−' + tl(leftOut, 0) + ' ' + t('left out') : null);
  const bTot = wk ? wkB : dB;
  // only a swipe by the user changes the week; any other scroll (resize, rotation) snaps back to the current week
  const onScroll = () => {
    clearTimeout(stR.current);
    stR.current = setTimeout(() => {
      const e = scR.current; if (!e || !e.clientWidth || tch.current) return;
      const i = Math.round(e.scrollLeft / e.clientWidth), o = offs[i];
      if (!act.current) { const j = nW - 1 + wo; if (i !== j) e.scrollLeft = j * e.clientWidth; return; }
      act.current = false;
      if (o !== undefined && o !== wo) { setWo(o); setSel(null); setCnt(5); }
    }, 110);
  };
  const page = Q => h('div.pc-pg', { key: Q.off }, h('div.pc-ch', null,
    h('div.pc-plot', null,
      h('div.pc-gl', { style: { bottom: 0, borderTopStyle: 'solid' } }), h('div.pc-gl', { style: { bottom: H / 2 } }), h('div.pc-gl', { style: { bottom: H } }),
      h('span.pc-ax', { style: { bottom: H - 6 } }, mv(nfmt(Q.ym, 0))), h('span.pc-ax', { style: { bottom: -6 } }, '0'),
      Q.bl > 0 ? h(Frag, null, h('div.pc-bud', { style: { bottom: Math.round(Q.bl / Q.ym * H) } }), h('div.pc-ax.pc-bl', { style: { bottom: Math.round(Q.bl / Q.ym * H), transform: 'translateY(50%)' } }, t('Bud./day'), h('br'), mv(nfmt(Q.bl, 0)))) : null),
    h('div.pc-cols', null, Q.cols.map(c => h('button', { key: c.y.k, type: 'button', className: cx('pc-col', !wk && Q.off === wo && c.y.k === sd.k && 'on'), disabled: c.y.fut, 'aria-label': dlab(c.y.k) + (c.y.fut ? '' : ', ' + tl(c.t, 0)), onClick: () => { setWo(Q.off); setSel(c.y.k); setView('day'); setAlt(false); setCnt(5); } },
      h('div.pc-bars', null, c.ghost > 0 ? h('div.pc-ghost', { style: { height: c.ghost } }) : null, h('div.pc-stack', null, c.segs.map((s, i) => h('i', { key: i, style: { height: s.h, background: s.c } })))),
      h('div.pc-lb', null, h('span', null, fmtD(c.y.k, { weekday: 'narrow' })), h('b', null, c.y.d)))))));
  const rowTx = x => {
    const w = S.why(x);
    return h('div.tx', { key: x.key + x.date }, h('i.dot', { style: { background: col(x.acc) } }),
      h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 700 } }, x.p || x.cat),
        h('div.help', { style: { marginTop: 2 } }, wk ? dlab(x.date) + ' · ' : '', h(Em, { id: x.acc }), x.cat + (x.s && x.s !== x.p ? ' · ' + x.s : '')),
        w ? h('span.tag.mx-t-sort', { style: { display: 'inline-block', marginTop: 5 } }, lt(x)) : null),
      h('div', { style: { fontWeight: 800, textDecoration: dil && w ? 'line-through' : 'none', whiteSpace: 'nowrap' } }, tl(x.a)));
  };
  const rowCat = c => {
    const p = wk ? chg(c) : null;
    return h('div.tx', { key: c }, h('i.dot', { style: { background: col(c) } }),
      h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 700 } }, h(Em, { id: c }), name(c)),
        h('div.help', { style: { marginTop: 2 } }, t('Share') + ' ' + Math.round(cs[c] / csTot * 100) + '%' + (p !== null ? ' · ' + (p === 0 ? t('Same as last week') : (p > 0 ? '▲ ' : '▼ ') + Math.abs(p) + '% ' + t('vs last week')) : ''))),
      h('div', { style: { fontWeight: 800, whiteSpace: 'nowrap' } }, tl(cs[c])));
  };
  const items = mode === 'tx' ? txs : cl;
  return h(Frag, null,
    h('div.pc-ctl', null,
      h('div.pc-tg', { role: 'tablist' }, [['week', t('Week')], ['day', t('Day')]].map(([k, l]) => h('button', { key: k, type: 'button', role: 'tab', className: view === k ? 'on' : '', 'aria-selected': view === k, onClick: () => { setView(k); setAlt(false); setCnt(5); } }, l))),
      h('div.pc-dil', null, h('span.mono-label', { lang: 'en' }, 'Diligence'), h(Sw, { on: dil, set: v => saveSettings({ dil: v }), label: t('Show Diligence balances') }))),
    h('div.pos-net.pc-sum', null,
      h('div.pc-r', null, h('span.mono-label', t(dil ? 'Spent · normalized' : 'Spent · reported')), h('span.pc-when', when)),
      h('div.pc-r', { style: { alignItems: 'baseline' } }, h('div.pc-amt', null, P(amt)), side ? h('span.pc-side', side) : null),
      hasB ? h('div.pc-bt', null, h('i', { style: { width: Math.min(Math.max(amt, 0) / bTot, 1) * 100 + '%', background: diff >= 0 ? 'var(--ink)' : '#b8321d' } }), wk && wo === 0 ? h('b', { style: { left: Math.min(expB / bTot, 1) * 100 + '%' } }) : null) : null,
      h('div.pc-r.pc-st', null, h('span', null, status), hasB ? h('span', null, t('Budget') + ' ' + tl(bTot, 0)) : null)),
    h('div.card.pc-cd', null,
      h('div.pc-hd', null, h('span.lb', t(wk ? 'Daily spend' : 'This week · tap a day')), h('span.lb', W.rng)),
      h('div.pc-pgr', { ref: scR, onScroll, onTouchStart: () => { tch.current = true; act.current = true; }, onWheel: () => { act.current = true; }, onTouchEnd: () => { tch.current = false; onScroll(); }, onTouchCancel: () => { tch.current = false; onScroll(); } }, offs.map(o => page(o === wo ? W : wkOf(o)))),
      nW > 1 ? h('div.pc-dots', { 'aria-hidden': true }, offs.slice(-12).map(o => h('i', { key: o, className: o === wo ? 'on' : '' }))) : null,
      h('div.pc-lg', null,
        wk ? h(Frag, null, h('span', null, h('i.pc-sw', { style: { background: 'var(--txt)' } }), t('This week')), h('span', null, h('i.pc-sw', { style: { border: '1px dashed var(--mut)' } }), t('Last week'))) : null,
        dil && shareAmt > 0.5 ? h('span', null, h('i.pc-sw', { style: { background: SHARE, border: '1px solid var(--mut)' } }), tf('Spread share {0}', tl(shareAmt, 0))) : null,
        wk && W.bl > 0 ? h('span', null, h('i.pc-ln'), t('Budget per day')) : null)),
    ins ? h('div.ins', { style: { cursor: 'default' } }, h('span.ins-ic', null, h(Ic, { n: 'spark', s: 16 })), h('span.ins-b', null, h('span.mono-label', t('Insights')),
      h('span.ins-t', null, tf(ins.p > 0 ? '{0} is up {1}% on last week' : '{0} is down {1}% on last week', name(ins.c), Math.abs(ins.p))))) : null,
    h('div.pc-lh', null, h('span.pc-lt', t(mode === 'tx' ? (wk ? 'Largest transactions' : 'Transactions') : 'Categories')),
      h('button.sb.nz', { type: 'button', onClick: () => { setAlt(!alt); setCnt(5); } }, t(mode === 'tx' ? 'Show categories' : 'Show transactions'))),
    h('div.card.pn', { style: { marginTop: 8 } },
      mode === 'cat' && cl.length ? h('div.pc-stk', { style: { margin: '12px 14px 4px' } }, cl.map(c => h('i', { key: c, style: { width: cs[c] / csTot * 100 + '%', background: col(c) } }))) : null,
      items.length ? items.slice(0, cnt).map(r => (mode === 'tx' ? rowTx(r) : rowCat(r))) : h('div.help', { style: { padding: 14, margin: 0 } }, t('No expenses in this period.')),
      items.length > cnt ? h('div', { style: { padding: '8px 14px 14px' } }, h('button.sb', { type: 'button', style: { width: '100%', padding: 11 }, onClick: () => setCnt(cnt + 10) }, tf('Show more ({0} left)', items.length - cnt))) : null),
    dil ? h('div.help', null, t('Normalized spend leaves out one-offs and excluded categories. Spread purchases count a little every day of the months they cover, so the days of a month add up to the month\'s normalized spend.')) : null);
}
