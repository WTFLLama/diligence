// more.js - the More menu and the Insights page.
import { h, useState, Pg, Sw, Em, Frag, MonthPick, cx } from '../lib.js';
import { overview, spend, addMonth } from '../engine.js';
import { t, tf, tl, PREF, mlong, mn, ml } from '../prefs.js';
import { saveSettings } from '../store.js';

export function More({ go }) {
  const items = [
    ['stk', t('Consumables'), t('Stock, restock and use')],
    ['inv', t('Investments'), t('Portfolio and allocation')],
    ['rep', t('Reports'), t('Income statement, net worth, other assets')],
    ['ins', t('Insights'), t('Spending trends and category moves')],
    ['rec', t('Reconciliation'), t('Match a cash or card balance to the real amount')],
    ['mass', t('Mass entry'), t('Import a bank statement (PDF, CSV, XLS, XLSX)')],
    ['set', t('Settings'), t('Accounts, categories, capture, backup')]];
  return h(Pg, { title: t('More') },
    items.map(([k, title, sub]) => h('button.card', { key: k, type: 'button', style: { cursor: 'pointer', display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit' }, onClick: () => go(k) },
      h('div', { style: { flex: 1 } }, h('b', null, title), h('div.help', { style: { marginTop: 2 } }, sub)), h('span.lb', '›'))),
    h('div.card', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
      h('div', { style: { flex: 1 } }, h('b', null, t('Hide balances')), h('div.help', { style: { marginTop: 2 } }, t('Hide amounts everywhere (shown as ***,*)'))),
      h(Sw, { on: PREF.priv, set: v => saveSettings({ priv: v }), label: t('Hide balances') })));
}

// Insights: how this month compares with the one before (same days for the running month).
export function Insights({ m, back }) {
  const [mo0, setMo] = useState(''), dil = PREF.dil;
  const o = overview(m, mo0 || m.month, dil), S = spend(m), mo = o.month, prev = o.prev;
  const day = o.current ? +m.today.slice(8, 10) : 0;
  const prevTotal = prev ? S.cats(prev, dil, day).reduce((s, c) => s + c.amount, 0) : 0, nowTotal = o.categories.reduce((s, c) => s + c.amount, 0);
  const moves = o.insights.map(x => ({ ...x, diff: x.now - x.before })).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const up = moves.filter(x => x.diff > 0.5).slice(0, 5), down = moves.filter(x => x.diff < -0.5).slice(0, 5);
  const before = new Set(prev ? S.cats(prev, dil, 0).map(c => c.acc) : []);
  const fresh = prev ? o.categories.filter(c => c.amount > 0 && !before.has(c.acc)) : [];
  const big = S.tx.filter(x => x.m === mo && x.a > 0 && !S.why(x)).sort((a, b) => b.a - a.a).slice(0, 5);
  const row = x => h('div.li', { key: x.acc }, h('div', { style: { flex: 1 } }, h('b', null, h(Em, { id: x.acc }), x.name), h('div.help', { style: { marginTop: 2 } }, tf('{0} → {1}', tl(x.before, 0), tl(x.now, 0)))),
    h('b', { className: x.diff > 0 ? 'dn' : 'up' }, (x.diff > 0 ? '▲ ' : '▼ ') + tl(Math.abs(x.diff), 0)), h('span.help', { style: { margin: 0, minWidth: 44, textAlign: 'right' } }, Math.abs(x.pct).toLocaleString('tr-TR', { maximumFractionDigits: 0 }) + '%'));
  const pct = prevTotal > 0.5 ? Math.round((nowTotal / prevTotal - 1) * 100) : null;
  return h(Pg, { title: t('Insights'), back, sub: h(MonthPick, { months: o.months, v: mo, cur: m.month, text: mlong(mo) + ' · ' + (dil ? t('normalized') : t('reported')), on: k => setMo(k === m.month ? '' : k), label: mlong }) },
    !prev ? h('div.card', null, h('div.help', { style: { margin: 0 } }, t('Insights compare a month with the one before it. They appear once you have two months of data.'))) : h(Frag, null,
      h('div.g2', null,
        h('div.card', null, h('div.lb', o.current ? tf('{0}, first {1} days', mn(mo), day) : ml(mo)), h('div.v', tl(nowTotal, 0))),
        h('div.card', null, h('div.lb', o.current ? tf('{0}, same days', mn(prev)) : ml(prev)), h('div.v', tl(prevTotal, 0)),
          pct === null ? null : h('div', { className: cx('help', pct > 0 ? 'dn' : 'up') }, (pct > 0 ? '▲ ' : '▼ ') + Math.abs(pct) + '%'))),
      h('div.card', null, h('div.lb', t('Biggest increases')), up.length ? up.map(row) : h('div.help', t('Nothing went up.'))),
      h('div.card', null, h('div.lb', t('Biggest decreases')), down.length ? down.map(row) : h('div.help', t('Nothing went down.'))),
      fresh.length ? h('div.card', null, h('div.lb', tf('New this month (nothing in {0})', mn(prev))), fresh.slice(0, 6).map(c => h('div.li', { key: c.acc }, h('div', { style: { flex: 1 } }, h('b', null, h(Em, { id: c.acc }), c.name)), h('b', null, tl(c.amount, 0))))) : null),
    big.length ? h('div.card', null, h('div.lb', t('Largest purchases this month')),
      big.map(x => h('div.li', { key: x.key }, h('div', { style: { flex: 1, minWidth: 0 } }, h('b', null, x.p || x.cat), h('div.help', { style: { marginTop: 2 } }, h(Em, { id: x.acc }), x.cat + ' · ' + String(x.d).padStart(2, '0') + ' ' + mn(x.m))), h('b', null, tl(x.a, 0)))),
      h('div.help', null, t('If one of these will not repeat, mark it as a one-off or spread it in Diligence > Spend & budget.'))) : null,
    h('div.help', null, dil ? t('Showing normalized spend. Turn the Diligence switch off on Overview to compare reported spend.') : t('Showing reported spend. Turn the Diligence switch on on Overview to compare normalized spend.')));
}
