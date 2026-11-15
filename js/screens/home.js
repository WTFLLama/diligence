// home.js - Overview: the number for today, the net cash position, this month's spend, cards.
import { h, useState, Ic, P, Pie, PIEC, Em, Sw, MonthPick, cx } from '../lib.js';
import { overview, dim } from '../engine.js';
import { t, tf, PREF, tl, mlong, dshort, dmini, nfmt, mv } from '../prefs.js';
import { saveSettings, useStore } from '../store.js';

const SWC = ['#dfff00', '#ff8c77', '#bdedf2'];

export function Home({ m, go, nIb, openInbox, enter }) {
  const S = useStore();
  const [mo, setMo] = useState(''), [open, setOpen] = useState(false);
  const dil = PREF.dil, o = overview(m, mo || m.month, dil);
  const cats = o.categories.filter(c => c.amount > 0), sum = cats.reduce((a, c) => a + c.amount, 0);
  const top = cats.slice(0, 9), rest = cats.slice(9).reduce((a, c) => a + c.amount, 0);
  const pieItems = top.map((c, i) => ({ id: c.acc, label: c.name, value: c.amount, color: PIEC[i], display: mv(nfmt(c.amount, 0)) }))
    .concat(rest > 0 ? [{ id: '', label: t('All other categories'), value: rest, color: '#b8bbaf', display: mv(nfmt(rest, 0)) }] : []);
  // headline: the category that moved most in money terms (a percentage alone makes a tiny category look dramatic)
  const ins = o.insights.filter(x => Math.abs(x.pct) >= 8 && Math.abs(x.now - x.before) >= 1).sort((a, b) => Math.abs(b.now - b.before) - Math.abs(a.now - a.before))[0];
  const insText = !ins ? t('Not enough history for a comparison yet')
    : Math.abs(ins.pct) > 300 ? tf(ins.pct > 0 ? '{0} is up {1} on last month' : '{0} is down {1} on last month', ins.name, tl(Math.abs(ins.now - ins.before), 0))
      : tf(ins.pct > 0 ? '{0} is up {1}% on last month' : '{0} is down {1}% on last month', ins.name, Math.abs(ins.pct).toLocaleString('tr-TR', { maximumFractionDigits: 0 }));
  const over = o.monthLeft != null && o.monthLeft < 0;
  const budStatus = (ok, text) => h('div.bud-status', null, h(Ic, { n: ok ? 'check' : 'alert', s: 13 }), h('span', null, text));
  const budgetBox = o.current
    ? h('div', { className: 'sn bud' + (o.leftToday != null && o.leftToday >= 0 ? ' ok' : '') },
      h('div.sn-top', null, h('span.mono-label', t('Left to spend today'))),
      h('div.sn-v', null, o.leftToday == null ? '–' : P(o.leftToday, 0)),
      o.leftToday == null ? budStatus(false, t('No budget set'))
        : over ? budStatus(false, tf('{0} over budget', tl(-o.monthLeft, 0)))
          : budStatus(o.leftToday >= 0, tf('Room per day {0} · {1} days left', tl(o.roomPerDay, 0), o.daysLeft)))
    : h('div', { className: 'sn bud' + (o.monthLeft != null && o.monthLeft >= 0 ? ' ok' : '') },
      h('div.sn-top', null, h('span.mono-label', t('Left at month end'))),
      h('div.sn-v', null, o.monthLeft == null ? '–' : P(o.monthLeft, 0)),
      o.monthLeft == null ? budStatus(false, t('No budget set')) : budStatus(o.monthLeft >= 0, tf('Budget {0}', tl(o.budget, 0))));
  // no page title: the brand sits on the same line as the Diligence switch and the notifications button
  return h('div', { className: cx('home', enter && 'ov-enter') },
    h('header.hd.hd-home', null,
      h('div.hh-r', null,
        h('div.brand', null, h('img', { src: 'icons/icon-192.png', alt: '' }), t('Diligence'), S.syncing ? h('span.sync', { title: t('Syncing') }) : null),
        h('div.tools', null,
          h('label.dil', null, h('span.mono-label', { lang: 'en' }, 'Diligence'), h(Sw, { on: dil, set: v => saveSettings({ dil: v }), label: t('Diligence') })),
          h('button.ibtn2.bell', { onClick: openInbox, title: t('Notifications'), 'aria-label': t('Notifications') + (nIb ? ' (' + nIb + ')' : '') },
            h(Ic, { n: 'bell', s: 16 }), nIb ? h('span.bdg', nIb > 9 ? '9+' : String(nIb)) : null))),
      h(MonthPick, { months: o.months, v: o.month, cur: m.month, closed: !o.current, text: o.current ? dshort(m.today) : mlong(o.month), on: k => setMo(k === m.month ? '' : k), label: mlong })),
    h('div.ct', null,
    h('section.pos-net', null,
      h('div.pos-top', null, h('span.mono-label', t('Cash')),
        h('button.eyeb', { type: 'button', onClick: () => saveSettings({ priv: !PREF.priv }), title: t('Hide balances'), 'aria-label': t('Hide balances'), 'aria-pressed': PREF.priv }, h(Ic, { n: PREF.priv ? 'eyeoff' : 'eye', s: 17 }))),
      h('div.pos-amt', null, P(o.cash)),
      h('div.pos-foot', null,
        h('span', null, o.restricted > 0.005 ? tf('+ {0} on meal cards', tl(o.restricted, 0)) : ''),
        h('span', null, o.current ? t('As of today') : tf('At the end of {0}', mlong(o.month))))),
    h('section.pos-split', null,
      h('div.pm.debt', null, h('span.pm-h', null, h('span.mono-label', t('Card debt')), h(Ic, { n: 'card', s: 16 })), h('b.pm-v', null, P(o.cardDebt)),
        o.cardFuture > 0.005 ? h('small.pm-s', tf('incl. {0} future instalments', tl(o.cardFuture, 0))) : null),
      h('div.pm.net', null, h('span.pm-h', null, h('span.mono-label', t('Net cash position')), h(Ic, { n: 'equal', s: 16 })), h('b.pm-v', null, P(o.net)),
        o.loans > 0.005 ? h('small.pm-s', tf('loans {0} not included', tl(o.loans, 0))) : null)),
    h('section.snap', null,
      h('div.sn.exp', null,
        h('div.sn-top', null, h('span.mono-label', dil ? t('Normalized spend') : t('Spent this month')), dil ? h('span.dtag', 'D') : null),
        h('div.sn-v', null, P(o.spent)),
        h('div.bud-status', null, dil ? tf('Reported {0}', tl(o.reported, 0)) : tf('Normalized {0}', tl(o.normalized, 0)))),
      budgetBox,
      h('div', { className: 'sn cat' + (open ? ' open' : '') },
        h('button.cat-btn', { type: 'button', 'aria-expanded': open, onClick: () => setOpen(!open) },
          h('span.cat-top', null, h('span.mono-label', null, t(open ? 'Spending by category' : 'Top category'), dil ? ' · ' + t('normalized') : ''), h('span.cat-chev', null, h(Ic, { n: 'chev', s: 16 }))),
          cats[0] ? h('span.cat-row', null, h('span.cat-name', null, h(Em, { id: cats[0].acc }), h('span', null, cats[0].name)), h('span.cat-amt', null, mv(nfmt(cats[0].amount, 0))))
            : h('span.help', t('No expenses recorded for this month yet.'))),
        open && pieItems.length ? h(Pie, { items: pieItems, key: (dil ? 'd' : 'r') + o.month }) : null)),
    h('button.ins', { type: 'button', onClick: () => go('ins') },
      h('span.ins-ic', null, h(Ic, { n: 'spark', s: 18 })),
      h('span.ins-b', null, h('span.mono-label', t('Insights')),
        h('span.ins-t', null, insText)),
      h(Ic, { n: 'arrow', s: 18 })),
    o.cards.length ? h('section.ccs', null,
      h('div.cc-head', null, h('h2', null, t('Credit cards'), h('span', null, '/ ' + String(o.cards.length).padStart(2, '0')))),
      o.cards.map((c, i) => h('div.cc-row', { key: c.id },
        h('span.chipcard', { style: { background: SWC[i % 3] } }, h('i')),
        h('div.cc-main', null, h('b', null, c.name),
          h('span.cc-sub', null, c.cutOff ? tf('Cut-off {0}', dmini(c.cutOff)) : t('No cut-off day set')),
          c.future > 0.005 ? h('span.cc-sub', null, tf('{0} in instalments', tl(c.future, 0))) : null),
        h('div.cc-end', null, h('span.cc-lim', null, P(Math.abs(c.debt), 0)),
          h('span.cc-sub', null, c.debt < 0 ? t('in credit') : c.available != null ? tf('{0} available', mv(nfmt(c.available, 0))) : t('debt'))))))
      : null));
}
