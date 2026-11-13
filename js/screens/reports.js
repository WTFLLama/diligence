// reports.js - Income statement, net worth and the list of other assets. All straight from the ledger.
import { h, useState, useRef, useEffect, Pg, Pills, F, In, NumIn, DateIn, Er, Dlg, Frag, num, useAct, cx } from '../lib.js';
import { incomeStatement, netWorth } from '../engine.js';
import { t, tf, tl, nfmt, mv, ml, dshort } from '../prefs.js';
import { saveAsset, deleteAsset, say } from '../store.js';

const LABEL = { INCOME: 'Total income', EXPENSES: 'Total expenses', NET: 'Net (income − expenses)', '@investments': 'Investments (at cost)', '@otherAssets': 'Other assets', '@totalAssets': 'Total assets', '@totalLiabilities': 'Total liabilities', '@netWorth': 'Net worth' };

function Table({ data, mark }) {
  const ref = useRef(null);
  // open on the current month (months after it only hold spend that was recognised ahead)
  useEffect(() => { const el = ref.current; if (!el) return; const th = el.querySelector('th[data-mark]'); el.scrollLeft = th ? Math.max(0, th.offsetLeft + th.offsetWidth - el.clientWidth) : el.scrollWidth; }, [data]);
  return h('div.card', { style: { padding: '6px 0' } }, h('div.scrollx', { ref }, h('table.tbl', null,
    h('thead', null, h('tr', null, h('th', null, ''), data.months.map(k => h('th.lb', { key: k, 'data-mark': k === mark ? '' : undefined, style: k === mark ? { color: 'var(--txt)' } : null }, ml(k))))),
    h('tbody', null, data.rows.map((r, i) => h('tr', { key: i, className: r.type === 'total' ? 'tot' : r.type === 'sub' ? 'sub' : '' },
      h('td', null, LABEL[r.label] ? t(LABEL[r.label]) : r.label),
      r.values.map((v, j) => h('td', { key: j, className: v < -0.005 && r.type !== 'total' ? 'neg' : '' }, Math.abs(v) < 0.005 ? '–' : mv(nfmt(v, 0))))))))));
}

function Assets({ m }) {
  const list = (m.data.assets || []).slice().sort((a, b) => (a.group_name || '').localeCompare(b.group_name || '', 'tr') || (a.date < b.date ? -1 : 1));
  const [dlg, setDlg] = useState(null), [run, busy, err, setErr] = useAct();
  const s = (k, v) => setDlg(p => ({ ...p, [k]: v }));
  const open = a => { setErr(''); setDlg(a ? { id: a.id, name: a.name, group_name: a.group_name || '', date: a.date, cost: a.cost == null ? '' : String(a.cost), value: String(a.value), note: a.note || '' } : { name: '', group_name: '', date: m.today, cost: '', value: '', note: '' }); };
  const save = () => run(async () => {
    if (!dlg.name.trim()) throw new Error('Name is required.');
    await saveAsset({ id: dlg.id, name: dlg.name.trim(), group_name: dlg.group_name.trim(), date: dlg.date, cost: dlg.cost === '' ? null : num(dlg.cost), value: num(dlg.value), note: dlg.note });
    say(t('Saved ✓')); setDlg(null);
  });
  const groups = [...new Set(list.map(a => a.group_name || ''))], total = list.reduce((x, a) => x + Number(a.value || 0), 0);
  return h(Frag, null,
    h('div.card', null, h('div.fx', null, h('div.grow', null, h('div.lb', t('Other assets')), h('div.v', tl(total, 0))), h('button.sb', { onClick: () => open(null) }, '+ ' + t('Add'))),
      h('div.help', null, t('Things you own that are not money: car, electronics, deposits. Each row counts in net worth from its date; add a second row for a revaluation.'))),
    groups.map(g => h('div.card', { key: g }, h('div.lb', g || t('Ungrouped')),
      list.filter(a => (a.group_name || '') === g).map(a => h('div.li', { key: a.id, role: 'button', tabIndex: 0, style: { cursor: 'pointer' }, onClick: () => open(a) },
        h('div', { style: { flex: 1, minWidth: 0 } }, h('b', null, a.name), h('div.help', { style: { marginTop: 2 } }, dshort(a.date) + (a.note ? ' · ' + a.note : ''))),
        h('b', null, tl(a.value, 0)))))),
    dlg ? h(Dlg, { title: dlg.id ? t('Edit asset') : t('Add asset'), onClose: () => setDlg(null) },
      F(t('Name'), In(dlg.name, v => s('name', v), { placeholder: t('e.g. Car') })),
      F(t('Group'), In(dlg.group_name, v => s('group_name', v), { placeholder: t('e.g. Vehicles, Electronics'), list: 'dl-ag' })), h('datalist', { id: 'dl-ag' }, groups.filter(Boolean).map(g => h('option', { key: g, value: g }))),
      h('div.row', null, F(t('Value (₺)'), NumIn(dlg.value, v => s('value', v), { placeholder: '0' })), F(t('Cost (₺)'), NumIn(dlg.cost, v => s('cost', v), { placeholder: t('Optional') }))),
      F(t('Counts from'), DateIn(dlg.date, v => s('date', v))),
      F(t('Note (optional)'), In(dlg.note, v => s('note', v))),
      h(Er, { e: err }),
      h('div.row', { style: { marginTop: 16 } },
        dlg.id ? h('button.btn.gh', { disabled: busy, style: { color: 'var(--rd)' }, onClick: () => run(async () => { await deleteAsset(dlg.id); setDlg(null); }) }, t('Delete')) : h('button.btn.gh', { onClick: () => setDlg(null) }, t('Cancel')),
        h('button.btn', { disabled: busy, onClick: save }, busy ? t('Saving...') : t('Save')))) : null);
}

export function Reports({ m, back }) {
  const [v, setV] = useState('is');
  return h(Pg, { title: t('Reports'), back },
    h(Pills, { v, set: setV, o: [['is', t('Income statement')], ['bs', t('Net worth')], ['oa', t('Other assets')]] }),
    v === 'is' ? h(Frag, null, h(Table, { data: incomeStatement(m), mark: m.month }),
      h('div.help', null, t('Income and expenses are shown in the month they are recognised. Total expenses equals reported spend on the Spend page.')))
      : v === 'bs' ? h(Frag, null, h(Table, { data: netWorth(m), mark: m.month }),
        h('div.help', null, t('Month-end balances (today for the current month). Card debt includes instalments still to come. Investments are at cost; see Investments for their current value.')))
        : h(Assets, { m }));
}
