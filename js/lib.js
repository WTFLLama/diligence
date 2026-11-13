// lib.js - React, the h() helper and the small building blocks every screen uses.
import React, { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback, isValidElement } from '../vendor/react.js';
import { PREF, t, nfmt, mv, parseNum, terr } from './prefs.js';
import { getState } from './store.js';

export { React, useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback };

// h('div.card.pn', { onClick }, child, child)  -  the props object is optional
export function h(tag, props, ...kids) {
  if (props != null && (typeof props !== 'object' || isValidElement(props) || Array.isArray(props))) { kids.unshift(props); props = null; }
  if (typeof tag === 'string' && tag.indexOf('.') > -1) {
    const [name, ...cls] = tag.split('.');
    props = { ...(props || {}) };
    props.className = cls.join(' ') + (props.className ? ' ' + props.className : '');
    tag = name || 'div';
  }
  return React.createElement(tag, props, ...kids);
}
export const Frag = React.Fragment;
export const cx = (...a) => a.filter(Boolean).join(' ');

/* ---------- icons ---------- */
const ICP = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', plus: 'M12 5v14M5 12h14',
  chart: 'M3 17l6-6 4 4 8-8M15 7h6v6', grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z', refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  equal: 'M5 9h14M5 15h14', wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2zM16 14h2',
  card: 'M3 6h18v12H3zM3 10h18M7 15h3', alert: 'M12 3l10 18H2zM12 10v5M12 18h.01', check: 'M4 12l5 5L20 6', tag: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01', chev: 'M6 9l6 6 6-6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', eyeoff: 'M3 3l18 18M10.6 6.1A9.6 9.6 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.7 8.4 2 12 2 12s4 7 10 7a9.7 9.7 0 0 0 4.4-1',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z', arrow: 'M5 12h14M13 6l6 6-6 6',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4', x: 'M6 6l12 12M18 6L6 18', pen: 'M4 20l4-1 11-11-3-3L5 16zM14 7l3 3',
  chain: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1', up: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4', stack: 'M4 7h16M4 12h16M4 17h10'
};
export const Ic = ({ n, s }) => h('svg', { width: s || 24, height: s || 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'square', strokeLinejoin: 'miter', 'aria-hidden': true }, h('path', { d: ICP[n] }));

/* ---------- money ---------- */
// amount with a small currency symbol; hidden as ***,* when "hide balances" is on
export const Cur = () => h('span.cur', ' ' + PREF.cur);
export const P = (n, d) => [mv(nfmt(n, d)), h(Cur, { key: 'c' })];
export const Money = ({ v, d, sign }) => h(Frag, null, sign && v > 0 ? '+' : '', mv(nfmt(v, d)), h(Cur));
// category / account emoji (muted so it blends in); name falls back to nothing
export const emojiOf = id => { const m = getState().model, a = m && m.acc.get(id); return a && a.emoji ? a.emoji : ''; };
export const Em = ({ id, e }) => { const v = e !== undefined ? e : emojiOf(id); return v ? h('span.em', { 'aria-hidden': true }, v) : null; };
export const accName = id => { const m = getState().model, a = m && m.acc.get(id); return a ? a.name : '?'; };

/* ---------- layout ---------- */
export const Pg = ({ title, back, sub, act, children, className }) => h(Frag, null,
  h('div.hd', null,
    back ? h('button.bk', { onClick: back, 'aria-label': t('Back') }, '‹') : null,
    h('div.tt', null, h('h1', null, title), sub ? (typeof sub === 'string' ? h('span.sub', sub) : sub) : null),
    act || null),
  h('div', { className: cx('ct', className) }, children));
export const F = (label, child, hint) => h('div.fld', null, h('label', null, label), child, hint ? h('div.help', hint) : null);
export const Er = ({ e }) => (e ? h('div.err', { role: 'alert' }, e) : null);
export const Sk = () => h(Frag, null, h('div.sk'), h('div.sk'), h('div.sk'));
export const Metric = (label, value) => h('div.card', null, h('div.lb', label), h('div.v', value));
export const KV = (k, v) => h('div.kv', { key: k }, h('span', k), h('b', v));
export const Sec = ({ children }) => h('div.sec', children);

/* ---------- inputs ---------- */
export const In = (value, on, props) => h('input', { className: 'box', value: value == null ? '' : value, onChange: e => on(e.target.value), ...(props || {}) });
export const NumIn = (value, on, props) => In(value, on, { inputMode: 'decimal', autoComplete: 'off', ...(props || {}) });
export const DateIn = (value, on, props) => In(value, on, { type: 'date', ...(props || {}) });
export const num = v => { const n = parseNum(v); return Number.isFinite(n) ? n : 0; };
export const Sw = ({ on, set, label, disabled }) => h('button', { type: 'button', className: 'sw', role: 'switch', 'aria-checked': !!on, 'aria-label': label, disabled, onClick: () => set(!on) });
export const Pills = ({ v, set, o, disabled }) => h('div.pills', { role: 'tablist' }, o.map(x => {
  const [val, label] = Array.isArray(x) ? x : [x, t(x)];
  return h('button', { key: val, type: 'button', role: 'tab', 'aria-selected': v === val, disabled, className: cx('pill', v === val && 'on'), onClick: () => set(val) }, label);
}));

export function useOut(ref, fn) {
  useEffect(() => {
    const f = e => { if (ref.current && !ref.current.contains(e.target)) fn(); };
    document.addEventListener('pointerdown', f);
    return () => document.removeEventListener('pointerdown', f);
  });
}
// Dropdown. opts = [{ v, l, k?, e? }]  (value, label, small type tag, emoji)
export function Dd({ v, on, opts, ph, style, disabled }) {
  const [open, setOpen] = useState(false), ref = useRef(null);
  useOut(ref, () => open && setOpen(false));
  const cur = opts.find(o => o.v === v);
  return h('div', { className: cx('dd', open && 'open'), ref },
    h('button.box', { type: 'button', style, disabled, 'aria-haspopup': 'listbox', 'aria-expanded': open, onClick: () => setOpen(!open) },
      h('span.dd-v', null, cur ? h(Frag, null, cur.e ? h('span.em', { 'aria-hidden': true }, cur.e) : null, cur.l) : h('span.dim', ph || t('Select'))),
      h('span.chev', null, h(Ic, { n: 'chev', s: 16 }))),
    open && h('div.menu', { role: 'listbox' }, opts.length ? opts.map(o => h('button', { type: 'button', key: o.v, role: 'option', 'aria-selected': o.v === v, className: cx('opt', o.v === v && 'sel'), onClick: () => { on(o.v); setOpen(false); } },
      h('span.dd-v', null, o.e ? h('span.em', { 'aria-hidden': true }, o.e) : null, o.l), o.k ? h('span.k', o.k) : null))
      : h('div.help', { style: { padding: '10px 12px', margin: 0 } }, t('Nothing to choose yet'))));
}
// options for account pickers
export const accOpts = (list, tag) => list.map(a => ({ v: a.id, l: a.name, e: a.emoji || '', k: tag ? tag(a) : '' }));

/* ---------- sheets and dialogs ---------- */
export const Sheet = ({ onClose, children, className }) => h('div.shw', { onClick: onClose }, h('div', { className: cx('sheet', className), role: 'dialog', 'aria-modal': true, onClick: e => e.stopPropagation() }, children));
export const Dlg = ({ title, onClose, children }) => h(Sheet, { onClose, className: 'dlg' },
  h('div.dlg-h', null, h('b', title), h('button.ibtn2', { type: 'button', 'aria-label': t('Close'), onClick: onClose }, h(Ic, { n: 'x', s: 16 }))), children);
export const Confirm = ({ title, text, yes, onYes, onNo, busy, danger, error }) => h(Sheet, { onClose: busy ? undefined : onNo },
  h('div', { style: { fontWeight: 700, fontSize: 18 } }, title),
  text ? h('div.help', { style: { fontSize: 13.5 } }, text) : null,
  h(Er, { e: error }),
  h('div.row', { style: { marginTop: 14 } },
    h('button.btn.gh', { disabled: busy, onClick: onNo }, t('Cancel')),
    h('button', { className: cx('btn', danger && 'dg'), disabled: busy, onClick: onYes }, busy ? t('Working...') : yes)));
// runs an async action with busy + error state:  const [run, busy, err, setErr] = useAct()
export function useAct() {
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const run = async fn => { setBusy(true); setErr(''); try { const r = await fn(); setBusy(false); return r === undefined ? true : r; } catch (e) { setErr(terr(e)); setBusy(false); return false; } };
  return [run, busy, err, setErr];
}

/* ---------- charts ---------- */
export const PIEC = ['#00d6d6', '#ff5d38', '#dfff00', '#a9c6f5', '#cfc7ff', '#f2c8b0', '#6f7bd9', '#8fcb9b', '#ffb000', '#e86bb0'];   // all readable on light and dark
export function Donut({ sl, children }) {
  const R = 70, C = 2 * Math.PI * R, sum = sl.reduce((a, x) => a + Math.max(x.value, 0), 0); let cum = 0;
  return h('div.donut', null,
    h('svg', { viewBox: '0 0 200 200' }, sum > 0 ? sl.map(x => {
      const len = Math.max(x.value, 0) / sum * C;
      const el = h('circle', { key: x.label, cx: 100, cy: 100, r: R, fill: 'none', stroke: x.color, strokeWidth: 26, strokeDasharray: Math.max(len - 1.5, 0) + ' ' + C, strokeDashoffset: -cum, transform: 'rotate(-90 100 100)' });
      cum += len; return el;
    }) : h('circle', { cx: 100, cy: 100, r: R, fill: 'none', stroke: 'var(--bd)', strokeWidth: 26 })),
    h('div.dc', null, children));
}
const pieTx = hex => { const n = parseInt(hex.slice(1), 16), lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); return lum > 140 ? '#191b18' : '#f5f5ec'; };
// items = [{ id, label, value, color, display }]; tap a slice or a row to highlight it
export function Pie({ items }) {
  const [sel, setSel] = useState(null);
  const tot = items.reduce((a, x) => a + x.value, 0) || 1, C = 120, R = 108; let ang = -Math.PI / 2;
  const key = x => x.id || x.label;
  const slices = items.map(x => {
    const fr = x.value / tot, nx = ang + fr * 2 * Math.PI, mid = (ang + nx) / 2, act = sel === key(x);
    const sh = { fill: x.color, stroke: '#191b18', strokeWidth: act ? 3 : 1.5, style: { cursor: 'pointer' }, onClick: () => setSel(act ? null : key(x)) };
    const lx = C + R * 0.64 * Math.cos(mid), ly = C + R * 0.64 * Math.sin(mid), ts = { textAnchor: 'middle', fill: pieTx(x.color), fontFamily: 'Inter,sans-serif', fontWeight: 600, style: { pointerEvents: 'none' } };
    const shape = fr > 0.999 ? h('circle', { cx: C, cy: C, r: R, ...sh })
      : h('path', { d: 'M' + C + ' ' + C + ' L' + (C + R * Math.cos(ang)).toFixed(2) + ' ' + (C + R * Math.sin(ang)).toFixed(2) + ' A' + R + ' ' + R + ' 0 ' + (fr > 0.5 ? 1 : 0) + ' 1 ' + (C + R * Math.cos(nx)).toFixed(2) + ' ' + (C + R * Math.sin(nx)).toFixed(2) + ' Z', ...sh });
    ang = nx;
    return h(Frag, { key: key(x) }, shape, fr >= 0.12 ? h('text', { x: lx, y: ly - 1, fontSize: 11, ...ts }, x.label.slice(0, 10)) : null, fr >= 0.12 ? h('text', { x: lx, y: ly + 12, fontSize: 10, ...ts }, x.display) : null);
  });
  const pk = items.find(x => key(x) === sel);
  return h('div.pie-wrap', null,
    h('svg.pie-svg', { viewBox: '0 0 240 240', role: 'img', 'aria-label': t('Expenses by category') }, slices),
    h('div.pie-cap', null, pk ? pk.label + ' · ' + pk.display + ' · ' + Math.round(pk.value / tot * 100) + '%' : t('Tap a slice or row for details')),
    items.map(x => h('button', { key: key(x), type: 'button', className: cx('pie-leg', sel === key(x) && 'on'), onClick: () => setSel(sel === key(x) ? null : key(x)) },
      h('span.dot', { style: { background: x.color } }), h('span.pie-name', null, x.id ? h(Em, { id: x.id }) : null, x.label), h('span.pie-amt', x.display), h('span.pie-pct', Math.round(x.value / tot * 100) + '%'))));
}

/* ---------- emoji picker ---------- */
export const EMS = ['🛒', '🍽️', '☕', '🍔', '🥗', '🍕', '🍷', '🚌', '🚕', '🚇', '🚗', '⛽', '🅿️', '✈️', '🏠', '💡', '💧', '🔥', '📶', '📱', '💻', '🎬', '🎮', '🎵', '📚', '🎓', '👕', '👟', '💈', '💊', '🏥', '🦷', '🏋️', '⚽', '🧘', '🎁', '🎉', '🧸', '👶', '🐾', '🪴', '🧹', '🧺', '🔧', '🛠️', '🧴', '🛍️', '📦', '✂️', '🧾', '💳', '💰', '💸', '🏦', '📈', '🪙', '💼', '🏖️', '🌐', '🔒', '🎟️', '🚬', '❤️', '⭐'];
export const EMS_STK = ['☕', '🫖', '🍵', '🥛', '🧃', '🥤', '🍶', '🍷', '🍺', '🧂', '🫒', '🍯', '🧈', '🥚', '🍞', '🥐', '🍝', '🍚', '🥫', '🫘', '🌾', '🥜', '🍫', '🍪', '🍬', '🍎', '🍋', '🍌', '🥑', '🧄', '🧅', '🌶️', '🥩', '🍗', '🐟', '🧀', '🧴', '🧼', '🧽', '🧻', '🪥', '🦷', '🪒', '💊', '🩹', '🧹', '🧺', '🧷', '🔋', '💡', '🕯️', '🪔', '🐾', '🦴', '🌱', '🪴', '🖊️', '📎', '🖨️', '🗑️', '🛢️', '⛽', '📦', '⭐'];
const firstG = v => { v = String(v || '').trim(); if (!v) return ''; try { if (window.Intl && Intl.Segmenter) for (const s of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(v)) return s.segment; } catch (e) { /* older browsers */ } return Array.from(v)[0] || ''; };
export function EmPicker({ title, current, color, onPick, onNo }) {
  const [v, setV] = useState('');
  return h(Sheet, { onClose: onNo },
    h('div', { style: { fontWeight: 700, fontSize: 18 } }, title),
    h('div.help', t(color ? 'Pick an emoji. It shows next to this item in full colour.' : 'Pick an emoji. It shows next to this category in muted grey.')),
    h('div.epk', null, (color ? EMS_STK : EMS).map(e => h('button', { key: e, type: 'button', className: current === e ? 'on' : '', 'aria-label': e, onClick: () => onPick(e) }, h('i', { className: cx('em', color && 'emc'), 'aria-hidden': true }, e)))),
    h('div.row', { style: { marginTop: 12, alignItems: 'center' } },
      h('div', { style: { flex: 1 } }, In(v, x => setV(firstG(x)), { placeholder: t('Or type your own emoji') })),
      h('button.btn', { disabled: !/\p{Extended_Pictographic}/u.test(v), onClick: () => onPick(v) }, t('Use'))),
    h('div.row', { style: { marginTop: 10 } },
      h('button.btn.gh', { disabled: !current, onClick: () => onPick('') }, t('Remove emoji')),
      h('button.btn.gh', { onClick: onNo }, t('Cancel'))));
}

/* ---------- month picker used on Overview / Spend ---------- */
export function MonthPick({ months, v, on, label, text, cur, closed }) {
  const [open, setOpen] = useState(false), ref = useRef(null);
  useOut(ref, () => open && setOpen(false));
  return h('div', { className: cx('mpick', open && 'open'), ref },
    h('span.d', text || label(v)), closed ? h('span.closed', t('Closed')) : null,
    months.length > 1 ? h('button.mbtn', { type: 'button', 'aria-label': t('Choose month'), 'aria-haspopup': 'listbox', 'aria-expanded': open, onClick: () => setOpen(!open) }, h(Ic, { n: 'chev', s: 12 })) : null,
    open ? h('div.mmenu', { role: 'listbox' }, months.slice().reverse().map(k => h('button', { key: k, type: 'button', role: 'option', 'aria-selected': k === v, className: cx('mo', k === v && 'sel'), onClick: () => { setOpen(false); on(k); } },
      h('span', null, label(k)), k === cur ? h('span.k', t('Current')) : null))) : null);
}
