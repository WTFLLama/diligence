// tutorial.js - shown once to a new member before the first Overview: payment methods, automatic capture (when a card was added),
// expense categories, Diligence features (placeholder), shortcut (placeholder). Page by page, no scrolling.
import { h, useState, useEffect, useRef, Ic, Er, EmPicker, Frag, num, cx } from '../lib.js';
import { accountsOf } from '../engine.js';
import { t, PREF, terr } from '../prefs.js';
import { getState } from '../store.js';
const getM = () => getState().model;
import { saveAccount, deleteAccount, changeAccounts, saveSettings } from '../store.js';

// page backgrounds: the Overview colours
const BG = { pay: ['#dfff00', 0], cap: ['#bdedf2', 0], cat: ['#ff8c77', 0], feat: ['#191b18', 1], sc: ['#f5f5ec', 0] };
const X = s => h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, 'aria-hidden': true }, h('path', { d: 'M6 6l12 12M18 6L6 18' }));
const BACK = h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, 'aria-hidden': true }, h('path', { d: 'M15 18l-6-6 6-6' }));

const Seg = ({ v, set, o, sm }) => h('div', { className: cx('tseg', sm && 'sm'), role: 'radiogroup' },
  o.map(([k, l]) => h('button', { key: k, type: 'button', role: 'radio', 'aria-checked': v === k, className: v === k ? 'on' : '', onClick: () => set(k) }, l)));

export function Tutorial({ m, leaving, done }) {
  const [page, setPage] = useState(0), [prev, setPrev] = useState(null), [rev, setRev] = useState(false), [leave, setLeave] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [shake, setShake] = useState(0);
  const [pms, setPms] = useState([]);
  const [f, setF] = useState({ amount: '', lim: '', name: '', kind: 'cash', day: '', det: false });
  const [cap, setCap] = useState({});
  const [cats, setCats] = useState(() => accountsOf(m, ['expense']).filter(a => !a.system_key).map(a => ({ id: a.id, name: a.name, orig: a.name, emoji: a.emoji || '', emo0: a.emoji || '' })));
  const [gone, setGone] = useState([]);
  const [feat, setFeat] = useState(0), [capOn, setCapOn] = useState(false), [pick, setPick] = useState(null);
  const nameRef = useRef(null);

  // the capture page only with a credit card; the shortcut page only when capture was turned on
  const pages = ['pay', ...(pms.some(p => p.kind === 'card') ? ['cap'] : []), 'cat', 'feat', ...(capOn ? ['sc'] : [])];
  const key = pages[Math.min(page, pages.length - 1)], [bg, dark] = BG[key];

  useEffect(() => {
    const b = document.body, o = b.style.overflow; b.style.overflow = 'hidden';
    return () => { b.style.overflow = o; };
  }, []);
  useEffect(() => {
    const mt = document.querySelector('meta[name=theme-color]'); if (!mt) return;
    const old = mt.content; mt.content = leave ? '#191b18' : bg;
    return () => { mt.content = old; };
  }, [bg, leave]);
  useEffect(() => {
    if (key !== 'feat') return;
    const id = setInterval(() => setFeat(x => (x + 1) % 3), 3200);
    return () => clearInterval(id);
  }, [key, feat]);

  const go = i => {
    setErr('');
    if (i >= pages.length) return finish();
    if (i < 0) return;
    setRev(i < page); setPrev({ key, i: page }); setPage(i);
    setTimeout(() => setPrev(null), 360);
  };
  const finish = () => { saveSettings({ onboarded: true }); setLeave(true); if (leaving) leaving(); setTimeout(done, 900); };
  const run = async fn => { if (busy) return; setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(terr(e)); } finally { setBusy(false); } };
  const nudge = () => { setShake(x => x + 1); if (nameRef.current) nameRef.current.focus(); };

  /* ---------- payment methods ---------- */
  const setAmount = (v, k) => {
    v = v.replace(/[^0-9.,]/g, '').replace(/\./g, ',');
    const i = v.indexOf(',');
    if (i > -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/,/g, '').slice(0, 2);
    setF(p => ({ ...p, [k || 'amount']: v.replace(',', '.') }));
  };
  // amount field in the style of Add entry; a card shows two of them side by side
  const amtIn = (id, label, k, sm) => h('label', { className: cx('tamt', sm && 'sm'), htmlFor: id },
    h('span.tl', null, label),
    h('span.amt-line', null, h('span.amt-cur', PREF.cur),
      h('input', { id, inputMode: 'decimal', autoComplete: 'off', placeholder: '0', value: String(f[k]).replace('.', ','), style: { width: Math.max(2, String(f[k]).length + 0.6) + 'ch', fontSize: sm ? (String(f[k]).length > 8 ? 20 : String(f[k]).length > 6 ? 24 : 30) : undefined }, onChange: e => setAmount(e.target.value, k) })),
    h('span.amt-rule'));
  async function addPm() {
    const name = f.name.trim();
    if (!name) return false;
    const p = { name, kind: f.kind };
    if (f.kind === 'card') {
      // the bank shows the actual (total) limit and the current (available) limit: the difference is today's debt
      const avail = num(f.amount), lim = num(f.lim);
      if (f.amount !== '' && f.lim === '') throw new Error('Enter the actual limit too.');
      if (f.lim !== '') {
        p.credit_limit = lim;
        const debt = Math.round((lim - avail) * 100) / 100;      // negative when the card is overpaid: it then lowers total card debt
        if (debt !== 0) p.opening = { amount: debt, date: m.today };
      }
    } else { const amt = num(f.amount); if (amt) p.opening = { amount: amt, date: m.today }; }
    if (f.kind === 'card' && f.day !== '') {
      const d = Number(f.day);
      if (!(d >= 1 && d <= 31)) throw new Error('Days must be between 1 and 31.');
      p.statement_day = d;
    }
    const a = await saveAccount(p);
    setPms(list => [...list, { id: a.id, name: a.name, kind: a.kind }]);
    setF(p0 => ({ amount: '', lim: '', name: '', kind: p0.kind, day: '', det: false }));
    return true;
  }
  const more = () => run(async () => { if (!f.name.trim()) return nudge(); await addPm(); if (nameRef.current) nameRef.current.focus(); });
  const next1 = () => run(async () => {
    if (!f.name.trim() && !pms.length) return nudge();
    const added = await addPm();
    if (document.activeElement) document.activeElement.blur();
    // the capture page depends on the list, which updates on the next render
    setTimeout(() => go(1), added ? 30 : 0);
  });
  const dropPm = p => run(async () => { await deleteAccount(p.id); setPms(list => list.filter(x => x.id !== p.id)); });

  const pPay = () => h(Frag, null,
    h('h1.tt.lg', null, t('Welcome to Diligence')),
    h('p.tsub', null, t('Enter your first payment method')),
    h('div.tbody', null,
      pms.length ? h('div.tchips', null, pms.map(p => h('span.tchip', { key: p.id }, h('span', null, p.name), h('small', null, t(p.kind === 'card' ? 'Credit card' : 'Cash & bank')),
        h('button', { type: 'button', 'aria-label': t('Remove'), disabled: busy, onClick: () => dropPm(p) }, X(12))))) : null,
      f.kind === 'card' ? h('div.tamt2', null, amtIn('tamt', t('Current limit (₺)'), 'amount', true), amtIn('tlim', t('Actual limit (₺)'), 'lim', true))
        : amtIn('tamt', t('Balance (₺)'), 'amount'),
      h('div', { key: 'n' + shake, className: shake ? 'shake' : '' },
        h('label.tl', { htmlFor: 'tnm' }, t('Payment method name')),
        h('input.ti', { id: 'tnm', ref: nameRef, value: f.name, placeholder: t('e.g. QNB Checking'), autoCapitalize: 'words', autoComplete: 'off', onChange: e => setF(p => ({ ...p, name: e.target.value })) })),
      h('div', null,
        h('span.tl', null, t('Type')),
        h(Seg, { v: f.kind, set: k => setF(p => ({ ...p, kind: k })), o: [['cash', t('Cash & bank')], ['card', t('Credit card')]] }),
        f.kind === 'card' ? h('div.tdet', null,
          h('button.tdet-b', { type: 'button', 'aria-expanded': f.det, onClick: () => setF(p => ({ ...p, det: !p.det })) }, t('Details'), h('span', { className: cx('tdet-c', f.det && 'on') }, h(Ic, { n: 'chev', s: 14 }))),
          f.det ? h('div.tdet-f', null, h('label.tl', { htmlFor: 'tday' }, t('Statement cut-off day')),
            h('input.ti', { id: 'tday', inputMode: 'numeric', placeholder: '1–31', value: f.day, onChange: e => setF(p => ({ ...p, day: e.target.value.replace(/\D/g, '').slice(0, 2) })) })) : null) : null),
      h(Er, { e: err })),
    h('div.tfoot', null,
      h('button.tadd', { type: 'button', disabled: busy, onClick: more }, h('b', null, '+'), t('Add another payment method')),
      h('button.tbtn', { type: 'button', disabled: busy, onClick: next1 }, t('Add'))));

  /* ---------- automatic capture (only when a credit card was added) ---------- */
  const cards = pms.filter(p => p.kind === 'card'), cmp = cards.length > 2;
  const cv = id => cap[id] || { ch: 'sms', last4: '', from: '' };
  const setCv = (id, patch) => setCap(c => ({ ...c, [id]: { ...cv(id), ...patch } }));
  const anyOn = cards.some(c => cv(c.id).ch !== 'none');
  const turnOn = () => run(async () => {
    const ops = cards.filter(c => cv(c.id).ch !== 'none').map(c => { const v = cv(c.id); return { save: { id: c.id, name: c.name, capture_channel: v.ch, capture_last4: v.last4, capture_sender: v.from.trim() } }; });
    if (ops.length) { await changeAccounts(ops); setCapOn(true); }
    setTimeout(() => go(page + 1), 30);      // the shortcut page depends on capOn, which updates on the next render
  });
  const pCap = () => h(Frag, null,
    h('h1.tt', null, t('Turn on automatic capture?')),
    h('div.tbody', null,
      h('div', { className: cx('tcap', cmp && 'cmp') }, cards.map(c => {
        const v = cv(c.id), seg = h(Seg, { sm: true, v: v.ch, set: k => setCv(c.id, { ch: k }), o: [['sms', 'SMS'], ['email', t('E-mail')], ['none', t('None')]] });
        return h('div', { key: c.id, className: cx('tcard', v.ch === 'none' && 'no') },
          h('div.tcard-h', null, h('span.chipcard', null, h('i')), h('b', null, c.name), cmp ? seg : null),
          cmp ? null : seg,
          h('div.fl', null, h('div.trow', null,
            h('div', null, h('label.tl', null, t('Last 4 digits')),
              h('input.ti', { inputMode: 'numeric', placeholder: '1234', value: v.last4, onChange: e => setCv(c.id, { last4: e.target.value.replace(/\D/g, '').slice(0, 4) }) })),
            h('div', null, h('label.tl', null, v.ch === 'email' ? t('E-mail sender') : t('SMS sender')),
              h('input.ti', { autoCapitalize: 'none', placeholder: v.ch === 'email' ? 'bilgi@banka.com.tr' : 'QNB', value: v.from, onChange: e => setCv(c.id, { from: e.target.value }) })))));
      })),
      h(Er, { e: err })),
    h('div.tfoot', null,
      anyOn ? h('button.tbtn', { type: 'button', disabled: busy, onClick: turnOn }, t('Turn on')) : null,
      h('button', { type: 'button', className: cx('tbtn', anyOn && 'gh'), disabled: busy, onClick: () => go(page + 1) }, t('Skip'))));

  /* ---------- expense categories ---------- */
  const saveCats = () => run(async () => {
    const ops = gone.map(id => ({ del: id }));
    for (const c of cats) {
      const name = c.name.trim();
      if (!name) { if (c.id) ops.push({ del: c.id }); continue; }
      if (!c.id) ops.push({ save: { name, kind: 'expense', emoji: c.emoji } });
      else if (name !== c.orig || c.emoji !== c.emo0) ops.push({ save: { id: c.id, name, emoji: c.emoji } });
    }
    if (ops.length) await changeAccounts(ops);
    setGone([]);
    setCats(accountsOf(getM(), ['expense']).filter(x => !x.system_key).map(x => ({ id: x.id, name: x.name, orig: x.name, emoji: x.emoji || '', emo0: x.emoji || '' })));
    go(page + 1);
  });
  const lastCat = useRef(false);
  useEffect(() => { if (lastCat.current) { lastCat.current = false; const ins = document.querySelectorAll('.tcat input'); if (ins.length) ins[ins.length - 1].focus(); } });
  const pCat = () => h(Frag, null,
    h('h1.tt', null, t('Edit expense categories')),
    h('div.tbody', null,
      h('div.tcats', null,
        cats.map((c, i) => h('div.tcat', { key: c.id || 'n' + i },
          h('button', { type: 'button', className: cx('teb', !c.emoji && 'none'), 'aria-label': t('Pick an emoji'), onClick: () => setPick(i) }, c.emoji ? h('span.em', null, c.emoji) : null),
          h('input', { value: c.name, 'aria-label': c.orig || t('Name'), onChange: e => setCats(list => list.map((x, j) => j === i ? { ...x, name: e.target.value } : x)) }),
          h('button', { type: 'button', 'aria-label': t('Remove'), onClick: () => { if (c.id) setGone(g => [...g, c.id]); setCats(list => list.filter((_, j) => j !== i)); } }, X(14)))),
        cats.length < 12 ? h('button.tcat.add', { type: 'button', 'aria-label': t('Add'), onClick: () => { lastCat.current = true; setCats(list => [...list, { id: '', name: '', orig: '' }]); } }, '+') : null),
      h(Er, { e: err })),
    h('div.tfoot', null, h('button.tbtn', { type: 'button', disabled: busy, onClick: saveCats }, t('Continue'))),
    pick != null && cats[pick] ? h(EmPicker, { title: cats[pick].name, current: cats[pick].emoji || '', onNo: () => setPick(null),
      onPick: e => { const i = pick; setPick(null); setCats(list => list.map((x, j) => (j === i ? { ...x, emoji: e || '' } : x))); } }) : null);

  /* ---------- Diligence features (placeholder) ---------- */
  const bars = [[38, 18, 0], [52, 10, 8], [44, 22, 0], [60, 8, 14], [48, 16, 0], [56, 12, 6]];
  const pFeat = () => h(Frag, null,
    h('h1.tt', null, t('Unlock Diligence features?')),
    h('div.tbody', null,
      h('div.tfeat', { 'aria-hidden': true },
        h('div', { className: cx('tfv', feat === 0 && 'on') }, h('div.fv-bars', null, bars.map((b, i) => h('div', { key: i },
          h('i.l', { style: { height: b[0] + '%' } }), h('i', { style: { height: b[1] + '%' } }), b[2] ? h('i.c', { style: { height: b[2] + '%' } }) : null)))),
        h('div', { className: cx('tfv', feat === 1 && 'on') }, h('div.fv-ring')),
        h('div', { className: cx('tfv', feat === 2 && 'on') }, h('svg.fv-line', { viewBox: '0 0 300 200', preserveAspectRatio: 'none' },
          h('path', { d: 'M0 150 C40 140 60 90 100 100 S160 160 200 80 S260 40 300 50', fill: 'none', stroke: '#bdedf2', strokeWidth: 5, strokeLinecap: 'round' }),
          h('path', { d: 'M0 170 L300 70', fill: 'none', stroke: '#dfff00', strokeWidth: 3, strokeDasharray: '8 8' }),
          h('circle', { cx: 200, cy: 80, r: 9, fill: '#ff8c77' })))),
      h('div.tfdots', null, [0, 1, 2].map(i => h('button', { key: i, type: 'button', className: feat === i ? 'on' : '', 'aria-label': String(i + 1), onClick: () => setFeat(i) })))),
    h('div.tfoot', null,
      h('button.tbtn', { type: 'button', disabled: true }, t('Purchase')),
      h('button.tbtn.gh', { type: 'button', onClick: () => go(page + 1) }, t('Skip'))));

  /* ---------- shortcut (placeholder) ---------- */
  const pSc = () => h(Frag, null,
    h('h1.tt', null, t('Set up shortcut')),
    h('div.tbody', null, h('div.tsc', { 'aria-hidden': true }, h('i'), h('i'), h('i'), h('i'))),
    h('div.tfoot', null, h('button.tbtn', { type: 'button', onClick: () => go(page + 1) }, t('Skip'))));

  const R = { pay: pPay, cap: pCap, cat: pCat, feat: pFeat, sc: pSc };
  return h('div', { className: cx('tut', dark && 'dark', leave && 'leave'), style: { '--tbg': bg } },
    h('div.tut-in', null,
      h('div.tut-top', null,
        h('button', { type: 'button', className: cx('tut-bk', page === 0 && 'hid'), 'aria-label': t('Back'), onClick: () => go(page - 1) }, BACK),
        h('div.tut-prog', null, pages.map((p, i) => h('i', { key: i, className: i <= page ? 'on' : '' }))),
        h('span.tut-sp')),
      h('div.tut-stage', null,
        prev ? h('section', { key: 'p' + prev.i, className: cx('tp exit', rev && 'rev') }, R[prev.key]()) : null,
        h('section', { key: 'c' + page, className: cx('tp', prev && 'enter', rev && 'rev') }, R[key]()))));
}
