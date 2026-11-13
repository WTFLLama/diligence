// stock.js - Consumables: things bought in bulk and used up over time. Buying is not spending; using is.
import { h, useState, Pg, F, In, NumIn, DateIn, Dd, Er, Metric, Dlg, EmPicker, Frag, num, useAct } from '../lib.js';
import { inventory, accountsOf, r2 } from '../engine.js';
import { postStockBuy, postStockUse } from '../posting.js';
import { t, tf, tl, qf, dshort } from '../prefs.js';
import { saveEntry, saveSettings, say } from '../store.js';
import { payOpts, expenseOpts } from '../ui.js';

export function Stock({ m, back }) {
  const inv = inventory(m), stockAccs = accountsOf(m, ['stock']), emo = (m.data.settings && m.data.settings.stockEmoji) || {};
  const [dlg, setDlg] = useState(null), [f, setF] = useState({}), [pick, setPick] = useState(null), [showUsed, setShowUsed] = useState(false);
  const [run, busy, err, setErr] = useAct();
  const s = (k, v) => setF(p => ({ ...p, [k]: v }));
  const openBuy = it => { setErr(''); setF({ name: it ? it.name : '', unit: it ? it.unit : '', qty: '', total: '', pay: '', date: m.today, stock: it ? it.acc : (stockAccs[0] && stockAccs[0].id) }); setDlg({ type: 'buy', it }); };
  const openUse = it => { setErr(''); setF({ qty: '', cat: it.lastCat || '', date: m.today }); setDlg({ type: 'use', it }); };
  const save = () => run(async () => {
    if (dlg.type === 'buy') await saveEntry(postStockBuy(m, { stock: f.stock, name: f.name, qty: num(f.qty), unit: f.unit, total: num(f.total), pay: f.pay, date: f.date }));
    else await saveEntry(postStockUse(m, { key: dlg.it.key, qty: num(f.qty), cat: f.cat, date: f.date }).entry);
    say(t('Saved ✓')); setDlg(null);
  });
  const useCost = dlg && dlg.type === 'use' && num(f.qty) > 0 ? (num(f.qty) >= dlg.it.qty - 1e-9 ? dlg.it.value : r2(num(f.qty) * dlg.it.unitCost)) : 0;
  const shown = inv.items.filter(i => showUsed || i.status === 'active'), nUsed = inv.items.length - inv.active;
  if (!stockAccs.length) return h(Pg, { title: t('Consumables'), back }, h('div.card', null, h('div.help', { style: { margin: 0 } }, t('Add a "Stock" account in Settings > Accounts & categories to track consumables.'))));
  return h(Pg, { title: t('Consumables'), back, act: h('button.sb', { onClick: () => openBuy(null) }, '+ ' + t('Buy')) },
    h('div.g2', null, Metric(t('Stock value'), tl(inv.value)), Metric(t('Items in stock'), String(inv.active))),
    !inv.items.length ? h('div.card', null, h('div.help', { style: { margin: 0 } }, t('Nothing in stock yet. Buy something in bulk and record each use: only what you use counts as spending.'))) : null,
    shown.map(it => h('div.card', { key: it.key, style: { opacity: it.status === 'used' ? 0.6 : 1 } },
      h('div.fx', null,
        h('button.emb.emc-b', { type: 'button', 'aria-label': t('Pick an emoji'), onClick: () => setPick(it) }, emo[it.name] ? h('span.em.emc', emo[it.name]) : '+'),
        h('div.grow', null, h('b', { style: { fontSize: 16 } }, it.name), h('div.help', { style: { marginTop: 2 } }, it.status === 'used' ? t('Used up') : tf('{0} {1} left · {2} per {3}', qf(it.qty), it.unit, tl(it.unitCost), it.unit || t('unit')))),
        h('div.v', { style: { marginTop: 0 } }, tl(it.value))),
      h('div.help', null, tf('Bought {0} {1} for {2} · used {3} {1} ({4})', qf(it.boughtQty), it.unit, tl(it.boughtValue, 0), qf(it.usedQty), tl(it.usedValue, 0))),
      it.moves.slice(0, 4).map((mv, i) => h('div.kv', { key: i }, h('span', null, dshort(mv.date) + (mv.cat ? ' · ' + mv.cat : '')), h('b', { className: mv.value < 0 ? '' : 'up' }, (mv.qty > 0 ? '+' : '') + qf(mv.qty) + ' ' + it.unit + ' · ' + tl(Math.abs(mv.value), 0)))),
      h('div.row', { style: { marginTop: 10 } },
        h('button.sb', { style: { flex: 1 }, onClick: () => openBuy(it) }, t('Restock')),
        it.status === 'active' ? h('button.sb.nz', { style: { flex: 1 }, onClick: () => openUse(it) }, t('Use')) : null))),
    nUsed ? h('button.btn.gh', { style: { width: '100%', marginTop: 12 }, onClick: () => setShowUsed(!showUsed) }, showUsed ? t('Hide used-up items') : tf('Show used-up items ({0})', nUsed)) : null,
    h('div.help', null, t('Unit cost is the moving average of what is left. Using the last of an item takes exactly its remaining value.')),
    dlg ? h(Dlg, { title: dlg.type === 'buy' ? (dlg.it ? tf('Restock {0}', dlg.it.name) : t('Buy stock')) : tf('Use {0}', dlg.it.name), onClose: () => setDlg(null) },
      dlg.type === 'buy' ? h(Frag, null,
        dlg.it ? null : F(t('Item name'), In(f.name, v => s('name', v), { placeholder: t('e.g. Coffee beans') })),
        h('div.row', null, F(t('Quantity'), NumIn(f.qty, v => s('qty', v), { placeholder: '0' })), F(t('Unit'), In(f.unit, v => s('unit', v), { placeholder: 'g, ml, pcs', disabled: !!(dlg.it && dlg.it.unit) }))),
        F(t('Total cost (₺)'), NumIn(f.total, v => s('total', v), { placeholder: '0' })),
        F(t('Paid from'), h(Dd, { v: f.pay, on: v => s('pay', v), opts: payOpts(m, ['cash', 'card']) })),
        stockAccs.length > 1 && !dlg.it ? F(t('Stock account'), h(Dd, { v: f.stock, on: v => s('stock', v), opts: stockAccs.map(a => ({ v: a.id, l: a.name })) })) : null)
        : h(Frag, null,
          h('div.help', null, tf('{0} {1} left, worth {2}', qf(dlg.it.qty), dlg.it.unit, tl(dlg.it.value))),
          F(tf('Quantity used ({0})', dlg.it.unit || t('unit')), h('div.row', null, NumIn(f.qty, v => s('qty', v), { placeholder: '0' }), h('button.sb', { style: { flex: 'none' }, onClick: () => s('qty', String(dlg.it.qty)) }, t('All')))),
          F(t('Expense category'), h(Dd, { v: f.cat, on: v => s('cat', v), opts: expenseOpts(m, true) })),
          useCost ? h('div.help', null, tf('This adds {0} to spending.', tl(useCost))) : null),
      F(t('Date'), DateIn(f.date, v => s('date', v))),
      h(Er, { e: err }),
      h('div.row', { style: { marginTop: 16 } }, h('button.btn.gh', { onClick: () => setDlg(null) }, t('Cancel')), h('button.btn', { disabled: busy, onClick: save }, busy ? t('Saving...') : t('Save')))) : null,
    pick ? h(EmPicker, { title: pick.name, current: emo[pick.name] || '', color: true, onNo: () => setPick(null), onPick: e => { const n = { ...emo }; if (e) n[pick.name] = e; else delete n[pick.name]; saveSettings({ stockEmoji: n }); setPick(null); } }) : null);
}
