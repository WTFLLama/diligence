// main.js - the app shell: decides which screen to show and draws the top bar and bottom navigation.
import { createRoot } from '../vendor/react.js';
import { h, useState, useEffect, Ic, Sk, Pg, Er } from './lib.js';
import { useStore, boot, load } from './store.js';
import { t, applyTheme, terr } from './prefs.js';
import { Auth, Setup, NewPassword } from './screens/auth.js';
import { Home } from './screens/home.js';
import { Add } from './screens/add.js';
import { Tx } from './screens/tx.js';
import { Dil } from './screens/dil.js';
import { More, Insights } from './screens/more.js';
import { Stock } from './screens/stock.js';
import { Invest } from './screens/invest.js';
import { Reports } from './screens/reports.js';
import { Recon } from './screens/recon.js';
import { Mass } from './screens/mass.js';
import { Settings } from './screens/settings.js';
import { Inbox } from './screens/inbox.js';
import { Tutorial } from './screens/tutorial.js';

applyTheme();
const SUB = ['more', 'stk', 'inv', 'rep', 'ins', 'rec', 'mass', 'set'];

// the tutorial is decided once per signed-in user, when the data first arrives: a new member (no settings flag, nothing but opening
// balances) sees it; adding payment methods inside it must not make it disappear halfway
const tutFor = {};
const wantsTutorial = m => !((m.data.settings || {}).onboarded) && m.entries.every(e => e.kind === 'opening');

function hideSplash() { const s = document.getElementById('splash'); if (s && !s.classList.contains('out')) { s.classList.add('out'); setTimeout(() => s.remove(), 600); } }

function App() {
  const S = useStore();
  const [sc, setSc] = useState('home'), [edit, setEdit] = useState(null), [inbox, setInbox] = useState(false), [preset, setPreset] = useState(null), [, redraw] = useState(0);
  useEffect(() => { if (S.phase !== 'boot') hideSplash(); }, [S.phase]);
  const toast = S.toast ? h('div', { className: 'toast' + (S.toast.bad ? ' bad' : ''), role: 'status' }, S.toast.text) : null;

  if (S.phase === 'boot') return null;
  if (S.phase === 'setup') return h('div.app', null, h(Setup));
  if (S.recovering) return h('div.app', null, toast, h(NewPassword));
  if (S.phase === 'auth') return h('div.app', null, toast, h(Auth, { error: S.error }));
  if (S.phase === 'loading') return h('div.app', null, h(Pg, { title: t('Diligence') }, h(Sk)));
  if (S.phase === 'error') return h('div.app', null, h(Pg, { title: t('Diligence') }, h(Er, { e: terr(S.error) }),
    h('button.btn', { style: { width: '100%', marginTop: 12 }, onClick: load }, t('Try again'))));

  const m = S.model;
  const go = (k, p) => { if (k !== 'add') setEdit(null); setPreset(p || null); setSc(k); window.scrollTo(0, 0); };
  const back = () => go('more');
  const nIb = (S.data.inbox || []).length;
  const uid = S.user ? S.user.id : '';
  if (tutFor[uid] === undefined) tutFor[uid] = wantsTutorial(m);
  const tut = tutFor[uid];
  const scr =
    sc === 'home' ? h(Home, { m, go, nIb, openInbox: () => setInbox(true), enter: tut === 'leaving' || tut === 'done' }) :
    sc === 'tx' ? h(Tx, { m, onEdit: e => { setEdit(e); setSc('add'); window.scrollTo(0, 0); } }) :
    sc === 'add' ? h(Add, { m, edit, preset, key: edit ? edit.id : 'new', done: () => { setEdit(null); setSc('tx'); window.scrollTo(0, 0); } }) :
    sc === 'dil' ? h(Dil, { m, go, start: preset }) :
    sc === 'stk' ? h(Stock, { m, back }) :
    sc === 'inv' ? h(Invest, { m, back, go }) :
    sc === 'rep' ? h(Reports, { m, back }) :
    sc === 'ins' ? h(Insights, { m, back }) :
    sc === 'rec' ? h(Recon, { m, back }) :
    sc === 'mass' ? h(Mass, { m, back, go }) :
    sc === 'set' ? h(Settings, { m, back, go }) :
    h(More, { go });
  const on = k => (k === 'more' ? SUB.includes(sc) : sc === k);
  const nb = (k, label, icon) => h('button', { className: 'nb' + (on(k) ? ' on' : ''), 'aria-current': on(k) ? 'page' : undefined, onClick: () => go(k) }, h(Ic, { n: icon }), label);
  return h('div.app', null,
    h('div.sa-top'),
    toast, scr,
    inbox ? h(Inbox, { m, close: () => setInbox(false) }) : null,
    tut === true || tut === 'leaving' ? h(Tutorial, { m, leaving: () => { tutFor[uid] = 'leaving'; setSc('home'); setInbox(false); redraw(x => x + 1); }, done: () => { tutFor[uid] = 'done'; window.scrollTo(0, 0); redraw(x => x + 1); setTimeout(() => { tutFor[uid] = false; }, 1600); } }) : null,
    h('nav', { className: 'nav' + (tut === 'leaving' || tut === 'done' ? ' ov-nav' : ''), 'aria-label': t('Main') },
      nb('home', t('Overview'), 'home'), nb('tx', t('Transactions'), 'list'),
      h('button.fab', { onClick: () => go('add'), 'aria-label': t('Add') }, h(Ic, { n: 'plus' })),
      nb('dil', t('Diligence'), 'chart'), nb('more', t('More'), 'grid')));
}

createRoot(document.getElementById('root')).render(h(App));
boot();
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
