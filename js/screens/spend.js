// spend.js - Spend & budget: reported vs normalized spend, the bridge between them, one-off / normalize marks.
import { h, useState, Frag, Er, Em, cx, Sheet } from '../lib.js';
import { spend, addMonth, dim, r2 } from '../engine.js';
import { t, tf, tl, ml, ms, mn, PREF, terr } from '../prefs.js';
import { setMarks, saveAccount, say } from '../store.js';

const sum = a => a.reduce((s, x) => s + x.a, 0);
const same = (a, b) => a.length === b.length && a.slice().sort().join() === b.slice().sort().join();

function SpendChart({ stats, sel, onSel }) {
  const W = 300, H = 84, bw = W / stats.length, mx = Math.max(1, ...stats.map(s => Math.max(s.rep, s.bud, s.nrm))), y = v => H - v / mx * H;
  const path = stats.map((s, i) => s.bud ? (i && stats[i - 1].bud ? 'L' : 'M') + (i * bw) + ' ' + y(s.bud) + ' L' + ((i + 1) * bw) + ' ' + y(s.bud) : '').join(' '), last = stats[stats.length - 1];
  return h('svg', { viewBox: '0 0 ' + W + ' ' + (H + 20), width: '100%', role: 'img', 'aria-label': t('Reported and normalized spend by month') },
    stats.map((s, i) => {
      const x = i * bw + bw * 0.18, w = bw * 0.64, a = Math.max(s.rep, 0) / mx * H, b = Math.max(s.nrm, 0) / mx * H, on = s.k === sel;
      return h('g', { key: s.k, onClick: () => onSel(s.k), style: { cursor: 'pointer' }, opacity: on ? 1 : 0.55 },
        h('rect', { x, y: H - a, width: w, height: a, rx: 4, fill: 'var(--am)', opacity: 0.35 }),
        h('rect', { x, y: H - b, width: w, height: b, rx: 4, fill: 'var(--txt)' }),
        h('text', { x: x + w / 2, y: H + 14, fontSize: 9, fontWeight: on ? 800 : 500, fill: 'currentColor', textAnchor: 'middle' }, ms(s.k)));
    }),
    path.trim() ? h('path', { d: path, fill: 'none', stroke: 'var(--rd)', strokeWidth: 1.5, strokeDasharray: '4 3' }) : null,
    last.bud ? h('text', { x: W, y: y(last.bud) - 3, fontSize: 8, fill: 'var(--rd)', textAnchor: 'end', fontWeight: 800, style: { paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: 3 } }, tf('Budget {0}', tl(last.bud, 0))) : null);
}

// month grid used by both "Normalize" sheets
function MonthGrid({ win, sel, set, src, presets }) {
  return h(Frag, null,
    h('div.pills', { style: { marginTop: 8 } }, presets.map(([l, f]) => h('button.pill', { key: l, type: 'button', onClick: () => set(f()) }, l))),
    h('div.mg', null, win.map(k => h('button', { key: k, type: 'button', 'aria-pressed': sel.includes(k), className: cx('mc', sel.includes(k) && 'on', k === src && 'src'), onClick: () => set(sel.includes(k) ? sel.filter(z => z !== k) : sel.concat([k])) }, ms(k)))));
}

export function Spend({ m, goPlan }) {
  const S = spend(m), MONTHS = S.months, NOW = { m: m.month, d: +m.today.slice(8, 10), dim: dim(m.month) };
  const [m0, setM] = useState(null), [er, setEr] = useState(''), [view, setView] = useState('c'), [op, setOp] = useState(null), [sh, setSh] = useState({}), [q, setQ] = useState('');
  const [sid, setSid] = useState(null), [ds, setDs] = useState([]), [bc, setBc] = useState(null);
  const mo = MONTHS.includes(m0) ? m0 : NOW.m, cur = mo === NOW.m, mi = MONTHS.indexOf(mo), prevK = mi > 0 ? MONTHS[mi - 1] : null;
  const ex = S.excluded, rows = S.tx.filter(x => x.m === mo), partsM = S.parts.filter(p => p.pm === mo);
  const rep = S.rep(mo), nrm = S.nrm(mo), B = S.budget(mo), br = S.bridge(mo);
  const stats = MONTHS.slice(-6).map(k => ({ k, rep: S.rep(k), nrm: S.nrm(k), bud: S.budget(k) }));
  const act = async fn => { setEr(''); try { await fn(); } catch (e) { setEr(terr(e)); } };
  const mark = (it, mode, months) => act(() => setMarks([{ entry: it.id, acc: it.acc }], mode, months));
  const toggleEx = acc => act(async () => { const a = m.acc.get(acc); await saveAccount({ id: a.id, name: a.name, excluded: !a.excluded }); });
  const goM = k => { setM(k); setOp(null); };
  const isOne = it => it.mark && it.mark.mode === 'one_off', isN = it => it.mark && it.mark.mode === 'spread';
  const own = it => (it.instMonths && it.instMonths.length > 1 ? it.months : it.months);
  const openSheet = it => { setSid(it.key); setDs(isN(it) ? it.mark.months.slice() : it.months.slice()); };
  const saveSheet = () => { const it = S.items.get(sid); if (!ds.length) mark(it, 'one_off'); else if (same(ds, it.months)) mark(it, 'clear'); else mark(it, 'spread', ds.slice().sort()); setSid(null); };
  const future = (() => { const o = {}; S.parts.filter(p => p.pm > NOW.m).forEach(p => { o[p.pm] = (o[p.pm] || 0) + p.a; }); return Object.keys(o).sort().map(k => ({ k, a: o[k] })); })();

  // tiles: by category or by merchant
  const grp = (keyf, labelf) => {
    const keys = [], seen = new Set(), push = (k, l) => { if (!seen.has(k)) { seen.add(k); keys.push([k, l]); } };
    rows.forEach(x => push(keyf(x), labelf(x))); partsM.forEach(p => push(keyf(p.x || p.it.lines[0]), labelf(p.x || p.it.lines[0])));
    return keys.map(([k, label]) => {
      const r = rows.filter(x => keyf(x) === k).sort((a, b) => b.a - a.a), mine = partsM.filter(p => keyf(p.x || p.it.lines[0]) === k), sin = mine.filter(p => p.spread);
      const prev = prevK ? S.parts.filter(p => p.pm === prevK && keyf(p.x || p.it.lines[0]) === k && (!cur || p.spread || p.x.d <= NOW.d)).reduce((s, p) => s + p.a, 0) : 0;
      return { k, label, r, rep: sum(r), nrm: mine.reduce((s, p) => s + p.a, 0), sin, prev };
    }).sort((a, b) => Math.max(b.rep, b.nrm) - Math.max(a.rep, a.nrm));
  };
  const cats = grp(x => x.acc, x => x.cat), merch = grp(x => 'p:' + (x.p || ''), x => x.p || t('(no name)'));
  // fixed vs variable: same merchant + category in each of the last 3 months, within 25%
  const fv = (() => {
    if (mi < 2) return null;
    const ks = [MONTHS[mi - 2], MONTHS[mi - 1], mo];
    const T = ks.map(k => { const o = {}; S.tx.filter(x => x.m === k && !x.it.mark).forEach(x => { const key = x.p + '|' + x.acc; o[key] = (o[key] || 0) + x.a; }); return o; });
    const fixed = [];
    Object.keys(T[2]).forEach(key => { const v = T.map(o => o[key]); if (v.some(z => !(z > 0))) return; if (Math.max(...v) / Math.min(...v) <= 1.25) { const [p, acc] = [key.slice(0, key.lastIndexOf('|')), key.slice(key.lastIndexOf('|') + 1)]; fixed.push({ key, p, acc, cur: v[2], avg: (v[0] + v[1] + v[2]) / 3 }); } });
    const fk = new Set(fixed.map(f => f.key)), fixedN = partsM.filter(p => !p.spread && fk.has(p.x.p + '|' + p.x.acc)).reduce((s, p) => s + p.a, 0);
    return { fixed: fixed.sort((a, b) => b.cur - a.cur), fixedN, varN: nrm - fixedN };
  })();
  const qn = q.trim().toLocaleLowerCase('tr');
  const res = qn ? rows.filter(x => [x.p, x.s, x.cat, String(x.a)].join(' ').toLocaleLowerCase('tr').includes(qn)).sort((a, b) => b.a - a.a) : null;
  const delta = z => {
    if (!prevK || ex.has(z.k)) return null;
    if (z.prev <= 0.5) return z.nrm > 0 ? { t: tf('new vs {0}', mn(prevK)), good: false } : null;
    const pc = Math.round((z.nrm / z.prev - 1) * 100);
    return { t: (pc >= 0 ? '▲ ' : '▼ ') + Math.abs(pc) + '% ' + tf('vs {0}', mn(prevK)), good: pc <= 0 };
  };

  const txRow = (x, showCat) => {
    const it = x.it, one = isOne(it), nz = isN(it), credit = x.a < 0;
    return h('div.tx', { key: x.key + x.m },
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { fontWeight: 700 } }, x.p || x.cat),
        h('div.help', { style: { marginTop: 2 } }, String(x.d).padStart(2, '0') + ' ' + mn(x.m) + (showCat ? ' · ' + x.cat : '') + (x.s && x.s !== x.p ? ' · ' + x.s : '') + (it.inst > 1 ? ' · ' + tf('{0} instalments', it.inst) : '')),
        nz ? h('div.help', { style: { color: 'var(--txt)', fontWeight: 700 } }, tf('Total ÷ {0} months · {1} each', it.mark.months.length, tl(it.tot / it.mark.months.length))) : null),
      h('div', { style: { textAlign: 'right' } },
        h('div', { className: credit ? 'up' : '', style: { fontWeight: 800, textDecoration: one ? 'line-through' : 'none' } }, tl(x.a)),
        ex.has(x.acc) || it.tot <= 0.005 ? null : h('div', { style: { display: 'flex', gap: 5, marginTop: 6, justifyContent: 'flex-end' } },
          h('button', { className: cx('sb sm nz', nz && 'on'), onClick: () => openSheet(it) }, nz ? t('Spread ✓') : t('Normalize')),
          h('button', { className: cx('sb sm', one && 'am'), onClick: () => mark(it, one ? 'clear' : 'one_off') }, one ? t('One-off ✓') : t('One-off')))));
  };
  const more = (key, total, n) => total > n ? h('div', { style: { padding: '4px 14px 14px' } }, h('button.sb', { style: { width: '100%', padding: 11 }, onClick: () => setSh(p => ({ ...p, [key]: n + 10 })) }, tf('Show more ({0} left)', total - n))) : h('div', { style: { height: 10 } });
  const panel = (z, isCat) => {
    const key = mo + view + z.k, n = sh[key] || 10, exd = isCat && ex.has(z.k);
    return h('div.card.pn', { key: 'p-' + z.k },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' } },
        h('div', { style: { flex: 1, minWidth: 0 } }, h('b', null, isCat ? h(Em, { id: z.k }) : null, z.label),
          h('div.help', null, tf('{0} transactions in {1} · reported {2}', z.r.length, ml(mo), tl(z.rep)) + (exd ? '' : ' · ' + tf('normalized {0}', tl(z.nrm))))),
        isCat ? h('div', { style: { display: 'flex', gap: 6, flex: 'none' } },
          exd ? null : h('button.sb.nz', { onClick: () => { setBc(z.k); setDs([mo]); } }, t('Normalize all')),
          h('button', { className: cx('sb', exd && 'on'), onClick: () => toggleEx(z.k) }, exd ? t('Excluded') : t('Exclude'))) : null),
      z.r.slice(0, n).map(x => txRow(x, !isCat)), more(key, z.r.length, n),
      z.sin.length ? h('div', { style: { borderTop: '1px solid var(--bd)' } },
        h('div.lb', { style: { padding: '10px 14px 2px' } }, tf('Spread into {0}', ml(mo))),
        z.sin.map(p => h('div.tx', { key: p.it.key, style: { borderTop: 0 } },
          h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 700 } }, p.it.p || p.it.cat), h('div.help', { style: { marginTop: 2 } }, tf('from {0} · {1} ÷ {2}', ml(p.it.sm), tl(p.it.tot), p.it.mark.months.length))),
          h('div', { style: { fontWeight: 800 } }, tl(p.a)), h('button.sb.sm.nz', { onClick: () => openSheet(p.it) }, t('Edit')))), h('div', { style: { height: 8 } })) : null,
      exd ? h('div.help', { style: { padding: '0 14px 12px' } }, t('Category excluded, so one-off / normalize is off.')) : null);
  };
  const grid = (items, isCat) => {
    const mxr = Math.max(1, ...items.map(y => Math.max(y.rep, y.nrm))), oi = items.findIndex(y => y.k === op);
    return h('div.cg', null, items.flatMap((z, i) => {
      const open = op === z.k, exd = isCat && ex.has(z.k), nO = z.r.filter(x => isOne(x.it)).length, nN = z.r.filter(x => isN(x.it)).length, dl = isCat ? delta(z) : null, dimmed = isCat ? exd : z.nrm === 0;
      const sub = exd ? tf('Excl. {0}', tl(z.rep, 0)) : nO ? tf('{0} one-off', nO) : nN ? tf('{0} normalized', nN) : z.sin.length ? tf('+{0} spread in', z.sin.length) : Math.abs(z.rep - z.nrm) > 0.5 ? tf('of {0}', tl(z.rep, 0)) : z.r.length + ' tx';
      const tile = h('div', { key: z.k, role: 'button', tabIndex: 0, 'aria-expanded': open, className: cx('tile', open && 'sel', dimmed && 'exd'), onClick: () => setOp(open ? null : z.k), onKeyDown: e => { if (e.key === 'Enter') setOp(open ? null : z.k); } },
        h('div.nm', null, isCat ? h(Em, { id: z.k }) : null, z.label),
        isCat ? h('button', { className: cx('x', exd && 'on'), title: exd ? t('Include again') : t('Exclude category'), 'aria-label': exd ? t('Include again') : t('Exclude category'), onClick: e => { e.stopPropagation(); toggleEx(z.k); } }, '⊘') : null,
        h('div.am', null, tl(z.nrm, 0)), h('div.sub', null, sub),
        dl ? h('div.sub', { style: { fontWeight: 700, color: dl.good ? 'var(--gn)' : 'var(--rd)' } }, dl.t) : null,
        h('div.bar', { style: { width: Math.max(4, Math.max(z.rep, z.nrm) / mxr * 100) + '%', background: dimmed ? 'var(--mut)' : 'var(--txt)', height: 4 } }));
      const out = [tile];
      if (oi >= 0 && (i % 3 === 2 || i === items.length - 1) && Math.floor(oi / 3) === Math.floor(i / 3)) out.push(panel(items[oi], isCat));
      return out;
    }));
  };

  /* ---- sheet: normalize one purchase ---- */
  const st = sid ? S.items.get(sid) : null;
  let win = [];
  if (st) { const lo = addMonth(st.sm, -12), hi = [addMonth(st.sm, 12), ...st.months, ...(st.instMonths || [])].sort().pop(); for (let k = lo; k <= hi; k = addMonth(k, 1)) win.push(k); }
  const rng = (base, a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(addMonth(base, i)); return o; };
  const sheet = st ? h(Sheet, { onClose: () => setSid(null), className: 'dlg' },
    h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } }, h('b', { style: { fontSize: 18, flex: 1 } }, t('Normalize')), h('span.help', { style: { margin: 0 } }, ml(st.sm))),
    h('div.br', { style: { marginTop: 6 } }, h('span', null, (st.p || st.cat) + ' · ' + st.cat), h('b', null, tl(st.tot))),
    st.inst > 1 ? h('div.help', null, tf('One purchase paid in {0} instalments ({1}). It counts once, in {2}, unless you spread it.', st.inst, st.instMonths.map(ms).join(', '), ml(st.sm))) : null,
    h('div.help', null, t('Tap the months this spend should cover. The total is split equally across them. Outlined month = when it was first recognised.')),
    h(MonthGrid, { win, sel: ds, set: setDs, src: st.sm, presets: [
      ...(st.inst > 1 ? [[t('Instalment months'), () => st.instMonths.slice()]] : []),
      [t('Own months'), () => st.months.slice()], [t('Next 6'), () => rng(st.sm, 0, 5)], [t('Next 12'), () => rng(st.sm, 0, 11)], [t('Prev 12'), () => rng(st.sm, -11, 0)], [t('All 25'), () => rng(st.sm, -12, 12)], [t('Clear'), () => []]] }),
    h('div.card', { style: { marginTop: 12, boxShadow: 'none', background: 'var(--in)' } },
      !ds.length ? h('div.help', { style: { margin: 0 } }, t('Nothing selected → treated as a one-off (removed from normalized spend).'))
        : same(ds, st.months) ? h('div.help', { style: { margin: 0 } }, t('Same months as it is recognised now → no change.'))
          : h(Frag, null, h('div.v', { style: { marginTop: 0 } }, tf('{0} per month', tl(st.tot / ds.length))), h('div.help', null, tf('× {0} months', ds.length))),
      h('div.help', null, t('Months outside the data range are saved too; they appear in totals once those months exist.'))),
    h('div.row', { style: { marginTop: 14 } },
      h('button.btn.gh', { onClick: () => setSid(null) }, t('Cancel')),
      isN(st) ? h('button.btn.gh', { onClick: () => { mark(st, 'clear'); setSid(null); } }, t('Remove')) : null,
      h('button.btn', { onClick: saveSheet }, t('Save')))) : null;

  /* ---- sheet: normalize every unmarked purchase of a category in this month ---- */
  const bItems = bc ? [...new Map(rows.filter(x => x.acc === bc).map(x => [x.it.key, x.it])).values()] : [];
  const bTodo = bItems.filter(it => !it.mark && it.tot > 0.005), bSum = bTodo.reduce((s, it) => s + it.tot, 0);
  const saveBatch = () => { const ms2 = ds.slice().sort(), items = bTodo.filter(it => !same(ms2, it.months)); if (items.length) act(() => setMarks(items.map(it => ({ entry: it.id, acc: it.acc })), 'spread', ms2)); setBc(null); };
  const bsheet = bc ? h(Sheet, { onClose: () => setBc(null), className: 'dlg' },
    h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } }, h('b', { style: { fontSize: 18, flex: 1 } }, t('Normalize all')), h('span.help', { style: { margin: 0 } }, m.acc.get(bc).name + ' · ' + ml(mo))),
    h('div.br', { style: { marginTop: 6 } }, h('span', null, tf('{0} purchases', bTodo.length)), h('b', null, tl(bSum))),
    bItems.length > bTodo.length ? h('div.help', null, tf('{0} already marked (one-off or normalized) stay as they are.', bItems.length - bTodo.length)) : null,
    h('div.help', null, t('Each purchase total is split equally across the months you tap, as if you pressed Normalize on every one.')),
    h(MonthGrid, { win: rng(mo, -12, 12), sel: ds, set: setDs, src: mo, presets: [[t('This month'), () => [mo]], [t('Next 6'), () => rng(mo, 0, 5)], [t('Next 12'), () => rng(mo, 0, 11)], [t('Prev 12'), () => rng(mo, -11, 0)], [t('All 25'), () => rng(mo, -12, 12)], [t('Clear'), () => []]] }),
    h('div.card', { style: { marginTop: 12, boxShadow: 'none', background: 'var(--in)' } },
      !ds.length ? h('div.help', { style: { margin: 0 } }, t('Pick at least one month.'))
        : !bTodo.length ? h('div.help', { style: { margin: 0 } }, t('Nothing to normalize in this category.'))
          : h(Frag, null, h('div.v', { style: { marginTop: 0 } }, tf('{0} per month', tl(bSum / ds.length))), h('div.help', null, tf('in total, × {0} months', ds.length)))),
    h('div.row', { style: { marginTop: 14 } }, h('button.btn.gh', { onClick: () => setBc(null) }, t('Cancel')),
      h('button.btn', { disabled: !ds.length || !bTodo.length, onClick: saveBatch }, tf('Apply to {0}', bTodo.length)))) : null;

  const diff = B - nrm, under = diff >= 0, pct = B ? Math.min(Math.max(nrm, 0) / B, 1) * 100 : 0;
  // pace: the budget's share for the days so far, against what those days cost (spread shares count day by day, like on the Pace page)
  const expected = cur && B ? B * NOW.d / NOW.dim : null, soFar = cur ? nrm - br.spreadIn + br.spreadIn * NOW.d / NOW.dim : nrm;
  const room = cur && B ? (B - nrm) / (NOW.dim - NOW.d + 1) : null;
  const mKey = 'M' + mo, mN = sh[mKey] || 12;
  return h(Frag, null, h(Er, { e: er }),
    h('div.g3', null,
      h('div.card', null, h('div.lb', t('Reported')), h('div.v', tl(rep, 0)), h('div.help', tf('{0} transactions', rows.length))),
      h('div.card', { style: { background: 'var(--lime)', color: '#191b18' } }, h('div.lb', { style: { color: 'rgba(25,27,24,.7)' } }, t('Normalized')), h('div.v', tl(nrm, 0)),
        h('div.help', { style: { color: 'rgba(25,27,24,.7)' } }, rep && Math.abs(nrm - rep) > 0.5 ? (nrm < rep ? '−' : '+') + Math.round(Math.abs(1 - nrm / rep) * 100) + t('% vs reported') : t('same as reported'))),
      h('div.card', null, h('div.lb', t('One-offs')), h('div.v', tl(br.oneOff, 0)), h('div.help', tf('{0} one-off · {1} spread', br.nOne, br.nSpread)))),
    h('div.card', null,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } }, h('div.lb', tf('Budget · {0}', ml(mo))), h('button.linkb', { style: { fontSize: 12 }, onClick: goPlan }, t('Set in Cashflow & capex'))),
      B ? h(Frag, null,
        h('div.v', { style: { fontSize: 24, color: under ? 'var(--gn)' : 'var(--rd)' } }, tf(under ? '{0} under budget' : '{0} over budget', tl(Math.abs(diff), 0))),
        h('div', { style: { position: 'relative', height: 10, background: 'var(--in)', borderRadius: 5, marginTop: 12 } },
          h('div', { style: { width: pct + '%', height: '100%', borderRadius: 5, background: under ? 'var(--txt)' : 'var(--rd)' } }),
          expected !== null ? h('div', { style: { position: 'absolute', left: expected / B * 100 + '%', top: -3, width: 2, height: 16, background: 'var(--txt)', borderRadius: 1 } }) : null),
        h('div.br', { style: { marginTop: 12 } }, h('span', null, t('Budget')), h('b', null, tl(B, 0))),
        h('div.br', null, h('span', null, t('Normalized spend')), h('b', null, tl(nrm, 0) + ' · ' + Math.round(nrm / B * 100) + '%')),
        cur ? h(Frag, null,
          h('div.br', null, h('span', null, tf('Expected by day {0} (marker)', NOW.d)), h('b', null, tl(expected, 0))),
          h('div.br', null, h('span', null, soFar > expected ? t('Above pace') : t('Below pace')), h('b', { className: soFar > expected ? 'dn' : 'up' }, tl(Math.abs(soFar - expected), 0))),
          h('div.br', null, h('span', null, tf('Room per remaining day ({0} days)', NOW.dim - NOW.d + 1)), h('b', null, room > 0 ? tl(room, 0) : '–'))) : null,
        h('div.help', null, t('Each month is compared with the budget that applied in that month.')))
        : h('div.help', { style: { marginTop: 8 } }, tf('No budget for {0} yet.', ml(mo)))),
    h('div.card', null, h('div.lb', t('Reported (light) vs normalized (solid)') + (stats.some(s => s.bud) ? ' ' + t('vs budget (dashed)') : '') + ' · ' + t('tap a month')), h(SpendChart, { stats, sel: mo, onSel: goM })),
    h('div.card', null, h('div.lb', tf('How {0} gets from reported to normalized', ml(mo))),
      h('div.br', null, h('span', null, t('Reported spend')), h('b', null, tl(br.reported))),
      h('div.br', null, h('span', null, t('Excluded categories')), h('b', { className: br.excluded ? 'up' : '' }, (br.excluded ? '−' : '') + tl(br.excluded))),
      h('div.br', null, h('span', null, t('One-offs')), h('b', { className: br.oneOff ? 'up' : '' }, (br.oneOff ? '−' : '') + tl(br.oneOff))),
      h('div.br', null, h('span', null, t('Normalized items moved out')), h('b', { className: br.movedOut ? 'up' : '' }, (br.movedOut ? '−' : '') + tl(br.movedOut))),
      h('div.br', null, h('span', null, t('Spread in from normalized items')), h('b', { className: br.spreadIn ? 'dn' : '' }, '+' + tl(br.spreadIn))),
      h('div.br', { style: { fontSize: 15 } }, h('b', null, t('Normalized')), h('b', null, tl(nrm)))),
    future.length ? h('div.card', null, h('div.lb', t('Already spread into coming months')),
      future.slice(0, 6).map(f => h('div.br', { key: f.k }, h('span', null, ml(f.k)), h('b', null, '+' + tl(f.a)))),
      future.length > 6 ? h('div.help', null, tf('+ {0} more months', future.length - 6)) : null) : null,
    h('div.pills', { style: { marginTop: 16 } }, [['c', t('Categories')], ['m', t('Merchants')], ['f', t('Fixed vs variable')]].map(([k, l]) => h('button', { key: k, className: cx('pill', view === k && 'on'), onClick: () => { setView(k); setOp(null); } }, l))),
    h('div', { style: { marginTop: 10 } }, h('input.box', { value: q, type: 'search', onChange: e => setQ(e.target.value), placeholder: tf('Search {0}: merchant, description, category or amount', ml(mo)) })),
    !rows.length && !partsM.length ? h('div.card', null, h('div.help', null, tf('No expenses recognised in {0} yet.', ml(mo))))
      : res ? h('div.card', { style: { padding: 0, overflow: 'hidden' } },
        h('div.help', { style: { padding: '12px 14px 6px', margin: 0 } }, tf('{0} results', res.length) + ' · ' + tl(sum(res))),
        res.slice(0, sh['S' + mo + qn] || 20).map(x => txRow(x, true)), more('S' + mo + qn, res.length, sh['S' + mo + qn] || 20))
        : view === 'c' ? h(Frag, null,
          h('div.lb', { style: { margin: '16px 4px 0' } }, t('Expense categories · tap a tile for the biggest transactions') + (prevK ? ' · ' + tf('change vs {0}', mn(prevK)) + (cur ? ' ' + t('(same days)') : '') : '')), grid(cats, true))
          : view === 'm' ? h(Frag, null,
            h('div.lb', { style: { margin: '16px 4px 0' } }, tf('Merchants in {0} · across all categories', ml(mo))), grid(merch.slice(0, mN), false),
            merch.length > mN ? h('div', { style: { marginTop: 10 } }, h('button.sb', { style: { width: '100%', padding: 11 }, onClick: () => setSh(p => ({ ...p, [mKey]: mN + 12 })) }, tf('Show more ({0} left)', merch.length - mN))) : null)
            : !fv ? h('div.card', null, h('div.help', null, t('Fixed vs variable needs 3 months of history (this month and the 2 before it).'))) : h(Frag, null,
              h('div.card', null, h('div.lb', tf('Normalized spend in {0}', ml(mo))),
                h('div', { style: { display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', marginTop: 10, background: 'var(--in)' } },
                  h('div', { style: { width: (nrm ? fv.fixedN / nrm * 100 : 0) + '%', background: 'var(--txt)' } }), h('div', { style: { flex: 1, background: 'var(--am)', opacity: 0.5 } })),
                h('div.br', { style: { marginTop: 12 } }, h('span', null, '● ' + t('Fixed (recurring)')), h('b', null, tl(fv.fixedN, 0) + ' · ' + (nrm ? Math.round(fv.fixedN / nrm * 100) : 0) + '%')),
                h('div.br', null, h('span', null, '● ' + t('Variable (incl. spread-in)')), h('b', null, tl(fv.varN, 0) + ' · ' + (nrm ? Math.round(fv.varN / nrm * 100) : 0) + '%')),
                h('div.help', null, t('Fixed = same merchant and category in each of the last 3 months, with monthly totals within 25% of each other.'))),
              h('div.card', { style: { padding: 0, overflow: 'hidden' } }, h('div.lb', { style: { padding: '12px 14px 6px' } }, tf('Recurring items ({0})', fv.fixed.length)),
                fv.fixed.map(f => h('div.tx', { key: f.key },
                  h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 700 } }, f.p), h('div.help', { style: { marginTop: 2 } }, (m.acc.get(f.acc) || {}).name + (ex.has(f.acc) ? ' · ' + t('excluded') : '') + ' · ' + tf('3-month avg {0}', tl(f.avg, 0)))),
                  h('div', { style: { fontWeight: 800, opacity: ex.has(f.acc) ? 0.5 : 1 } }, tl(f.cur, 0)))),
                fv.fixed.length ? null : h('div.help', { style: { padding: '4px 14px 14px' } }, t('None detected.')), h('div', { style: { height: 6 } }))),
    sheet, bsheet);
}
