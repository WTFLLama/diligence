// invest.js - Investments: holdings from the ledger (units and cost), valued at the prices you enter.
import { h, useState, Pg, F, In, NumIn, DateIn, Dd, Er, Metric, Dlg, Donut, PIEC, Frag, num, useAct, cx } from '../lib.js';
import { holdings, r2 } from '../engine.js';
import { postInvestSell } from '../posting.js';
import { t, tf, tl, nfmt, mv, qf, dshort, PREF } from '../prefs.js';
import { saveEntry, saveInstrument, say } from '../store.js';
import { payOpts } from '../ui.js';

const pc = v => (v >= 0 ? '+' : '−') + nfmt(Math.abs(v) * 100, 1) + '%';

// unit prices keep their decimals whatever the app-wide decimals setting is (a 0,35 coin must not show as 0)
const pfmt = v => Number(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) < 10 ? 4 : 2 });

export function Invest({ m, back, go }) {
  const H = holdings(m);
  const [dlg, setDlg] = useState(null), [f, setF] = useState({});
  const [run, busy, err, setErr] = useAct();
  const s = (k, v) => setF(p => ({ ...p, [k]: v }));
  const openPrice = x => { setErr(''); setF({ price: x.price != null ? String(x.price) : '', cls: x.class, horizon: x.horizon }); setDlg({ type: 'price', x }); };
  const openSell = x => { setErr(''); setF({ units: String(x.qty), proceeds: x.price != null ? String(r2(x.qty * x.price)) : '', pay: '', date: m.today }); setDlg({ type: 'sell', x }); };
  const save = () => run(async () => {
    if (dlg.type === 'price') {
      const p = f.price.trim() === '' ? null : num(f.price);
      if (p !== null && !(p >= 0)) throw new Error('Amount must be a positive number.');
      await saveInstrument({ symbol: dlg.x.symbol, price: p, class: (f.cls || '').trim(), horizon: f.horizon || '' });
    } else {
      const r = postInvestSell(m, { date: f.date, symbol: dlg.x.symbol, units: num(f.units), proceeds: num(f.proceeds), pay: f.pay });
      await saveEntry(r.entry);
    }
    say(t('Saved ✓')); setDlg(null);
  });
  const sl = H.classes.map((c, i) => ({ label: c.name || t('Unclassified'), value: c.value, color: PIEC[i % PIEC.length] }));
  const noPrice = H.rows.filter(x => x.price == null).length;
  return h(Pg, { title: t('Investments'), back, act: h('button.sb', { onClick: () => go('add', { mode: 'invest' }) }, '+ ' + t('Buy')) },
    !H.rows.length ? h('div.card', null, h('div.help', { style: { margin: 0 } }, t('No holdings yet. Record a purchase with + Buy; then enter the current price here whenever you want to see what it is worth.'))) : h(Frag, null,
      h('div.g2', null, Metric(t('Value'), tl(H.value, 0)), Metric(t('Cost'), tl(H.cost, 0))),
      h('div.card', null, h(Donut, { sl }, h('div.lb', t('Profit / loss')), h('div', { className: cx('v', H.pl >= 0 ? 'up' : 'dn') }, mv((H.pl >= 0 ? '+' : '−') + nfmt(Math.abs(H.pl), 0)) + ' ' + PREF.cur), h('div.help', { style: { margin: 0 } }, pc(H.plPct))),
        sl.map(x => h('div.li', { key: x.label }, h('span.dot', { style: { background: x.color } }), h('div', { style: { flex: 1, fontWeight: 600 } }, x.label), h('div.help', { style: { margin: 0 } }, Math.round(x.value / (H.value || 1) * 100) + '%'), h('b', null, tl(x.value, 0))))),
      h('div.card', null, h('div.lb', t('Holdings')),
        H.rows.map(x => h('div.hold', { key: x.symbol },
          h('div.nm', null, h('b', null, x.symbol), h('small', null, qf(x.qty) + ' × ' + (x.price != null ? mv(pfmt(x.price)) : t('no price')) + (x.class ? ' · ' + x.class : ''))),
          h('div.rt', null, h('b', null, tl(x.value, 0)), h('small', { className: x.pl >= 0 ? 'up' : 'dn' }, x.price != null ? pc(x.plPct) : t('at cost'))),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, h('button.sb.sm', { onClick: () => openPrice(x) }, t('Price')), h('button.sb.sm', { onClick: () => openSell(x) }, t('Sell')))))),
      h('div.help', null, noPrice ? tf('{0} holding(s) have no price yet and are shown at cost.', noPrice) + ' ' : '', t('Prices are the ones you enter: there is no live market feed. Tap Price to update one.'))),
    dlg ? h(Dlg, { title: (dlg.type === 'price' ? t('Price') : t('Sell')) + ' · ' + dlg.x.symbol, onClose: () => setDlg(null) },
      dlg.type === 'price' ? h(Frag, null,
        h('div.help', null, tf('{0} units · average cost {1}', qf(dlg.x.qty), nfmt(dlg.x.avg, 4)) + (dlg.x.priceDate ? ' · ' + tf('last price from {0}', dshort(dlg.x.priceDate)) : '')),
        F(t('Current price per unit (₺)'), NumIn(f.price, v => s('price', v), { placeholder: t('Leave empty to value at cost') })),
        F(t('Asset class'), In(f.cls, v => s('cls', v), { placeholder: t('e.g. Stocks, FX, Crypto') })),
        F(t('Horizon'), h(Dd, { v: f.horizon || '', on: v => s('horizon', v), opts: [['', t('Not set')], ['short', t('Short term')], ['medium', t('Medium term')], ['long', t('Long term')]].map(([v, l]) => ({ v, l })) })))
        : h(Frag, null,
          h('div.help', null, tf('{0} units held at an average cost of {1}', qf(dlg.x.qty), nfmt(dlg.x.avg, 4))),
          h('div.row', null, F(t('Units sold'), NumIn(f.units, v => s('units', v))), F(t('Total received (₺)'), NumIn(f.proceeds, v => s('proceeds', v), { placeholder: '0' }))),
          F(t('Received into'), h(Dd, { v: f.pay, on: v => s('pay', v), opts: payOpts(m, ['cash']) })),
          F(t('Date'), DateIn(f.date, v => s('date', v))),
          num(f.units) > 0 && num(f.proceeds) > 0 ? h('div.help', null, tf('Gain or loss on this sale: {0}', tl(r2(num(f.proceeds) - (num(f.units) >= dlg.x.qty - 1e-9 ? dlg.x.cost : num(f.units) * dlg.x.avg))))) : null),
      h(Er, { e: err }),
      h('div.row', { style: { marginTop: 16 } }, h('button.btn.gh', { onClick: () => setDlg(null) }, t('Cancel')), h('button.btn', { disabled: busy, onClick: save }, busy ? t('Saving...') : t('Save')))) : null);
}
