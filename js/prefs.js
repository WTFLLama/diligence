// prefs.js - display preferences (language, decimals, currency symbol, theme, hide balances) and text / number formatting.
import { TR, TR_PATTERNS } from './i18n.js';

const DEF = { lang: 'en', dec: 2, cur: '₺', theme: 'system', glass: 50, priv: false, dil: false };
const KEY = 'dil:pref';
const clean = p => {
  p = p && typeof p === 'object' ? p : {};
  const o = {};
  if (p.lang === 'tr' || p.lang === 'en') o.lang = p.lang;
  if ([0, 1, 2, 3, 4].includes(Number(p.dec)) && p.dec !== '' && p.dec != null) o.dec = Number(p.dec);
  if (typeof p.cur === 'string' && p.cur.trim()) o.cur = p.cur.trim().slice(0, 4);
  if (['system', 'light', 'dark'].includes(p.theme)) o.theme = p.theme;
  if (Number.isFinite(Number(p.glass)) && p.glass !== '' && p.glass != null) o.glass = Math.max(0, Math.min(100, Math.round(Number(p.glass))));
  if (typeof p.priv === 'boolean') o.priv = p.priv;
  if (typeof p.dil === 'boolean') o.dil = p.dil;
  return o;
};
const readLocal = () => { try { return clean(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return {}; } };
const guessLang = () => ((navigator.language || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en');

export const PREF = { ...DEF, lang: guessLang(), ...readLocal() };
export const PREF_KEYS = Object.keys(DEF);

export function applyTheme() {
  const r = document.documentElement;
  r.lang = PREF.lang;
  r.style.setProperty('--gh', String(PREF.glass / 100));
  if (PREF.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', PREF.theme);
}
export function applyPrefs(p) {
  Object.assign(PREF, clean(p));
  try { localStorage.setItem(KEY, JSON.stringify(PREF)); } catch (e) { /* private mode */ }
  applyTheme();
}

/* ---------- text ---------- */
// English is the key; Turkish comes from i18n.js. "₺" in a text is replaced by the chosen currency symbol.
export const t = s => { const r = PREF.lang === 'tr' && TR[s] !== undefined ? TR[s] : s; return r.indexOf('₺') > -1 ? r.split('₺').join(PREF.cur) : r; };
// tf('Saved {0} instalments', 6)
export const tf = (s, ...a) => t(s).replace(/\{(\d)\}/g, (_, i) => (a[i] == null ? '' : a[i]));
// messages thrown by posting.js / the database are English sentences: translate when we know them (exact text, then patterns)
export const terr = e => {
  const s = String((e && e.message) || e || '');
  if (PREF.lang !== 'tr' || TR[s] !== undefined) return t(s);
  for (const [re, to] of TR_PATTERNS) if (re.test(s)) return s.replace(re, typeof to === 'function' ? (...a) => to(a, terr) : to);
  return s;
};

/* ---------- numbers ---------- */
export const MASK = '***,*';
export const nfmt = (n, d) => { const k = d == null ? PREF.dec : d, f = 10 ** k, v = Math.round(Number(n || 0) * f) / f; return (v === 0 ? 0 : v).toLocaleString('tr-TR', { minimumFractionDigits: k, maximumFractionDigits: k }); };   // never "-0"
export const mv = s => (PREF.priv ? MASK : s);
export const tl = (n, d) => mv(nfmt(n, d)) + ' ' + PREF.cur;
export const qf = n => Number(Math.round(n * 1000) / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 3 });
// "1.234,56" / "1234.56" / "12,5" typed by the user -> number
export function parseNum(v) {
  let s = String(v == null ? '' : v).replace(/[^0-9,.-]/g, '');
  const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
  if (c >= 0 && d >= 0) { const dec = c > d ? ',' : '.'; s = s.replace(dec === ',' ? /\./g : /,/g, '').replace(dec, '.'); }
  else if (c >= 0) s = /,\d{1,8}$/.test(s) && s.split(',').length === 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/* ---------- dates ---------- */
export const LOC = () => (PREF.lang === 'tr' ? 'tr-TR' : 'en-GB');
const D = (y, m, d) => new Date(y, m - 1, d || 1);
const dOf = s => D(+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10) || 1);
export const mlong = k => dOf(k).toLocaleDateString(LOC(), { month: 'long', year: 'numeric' });
export const mname = i => D(2000, i + 1).toLocaleDateString(LOC(), { month: 'short' }).replace('.', '');
export const mn = k => mname(+k.slice(5, 7) - 1);                                   // Nov
export const ml = k => mn(k) + ' ' + k.slice(2, 4);                                 // Nov 26
export const ms = k => mn(k) + k.slice(2, 4);                                       // Nov26
export const dshort = s => dOf(s).toLocaleDateString(LOC(), { day: '2-digit', month: '2-digit', year: 'numeric' });
export const dlong = s => dOf(s).toLocaleDateString(LOC(), { day: '2-digit', month: 'long', year: 'numeric' });
export const dday = s => dOf(s).toLocaleDateString(LOC(), { weekday: 'short', day: 'numeric', month: 'short' });
export const dmini = s => dOf(s).toLocaleDateString(LOC(), { day: 'numeric', month: 'short' });
