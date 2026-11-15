// auth.js - sign in, create an account, reset a password, unlock the encrypted data on a new device, show the recovery code.
// Also the "not connected yet" screen.
import { h, useState, F, In, Er, useAct, Pills, Confirm, Sk, Frag } from '../lib.js';
import { auth, config } from '../api.js';
import { t, PREF, terr } from '../prefs.js';
import { useStore, saveSettings, signIn, signUp, signOut, unlock, unlockWithCode, finishRecovery, startOver, vaultState, say } from '../store.js';

const Logo = () => h('div.auth-logo', null, h('img', { src: 'icons/icon-192.png', alt: '' }), h('b', 'Diligence'));
const Lang = () => h('div', { style: { marginTop: 22 } }, h(Pills, { v: PREF.lang, set: v => saveSettings({ lang: v }), o: [['en', 'English'], ['tr', 'Türkçe']] }));
const CodeIn = (v, set) => In(v, x => set(x.toUpperCase()), { autoCapitalize: 'characters', autoCorrect: 'off', autoComplete: 'off', spellCheck: false, placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', style: { fontFamily: 'var(--mono)', letterSpacing: '.5px' } });
const LOST = { title: 'Start over?', text: 'Without your password or recovery code nobody can read your data, not even us. Starting over erases it for good and gives you an empty account.', yes: 'Erase and start over' };

export function Auth({ error }) {
  const [mode, setMode] = useState('in'), [email, setEmail] = useState(''), [pw, setPw] = useState(''), [info, setInfo] = useState('');
  const [run, busy, err, setErr] = useAct();
  const sw = k => { setMode(k); setErr(''); setInfo(''); };
  const submit = e => {
    e.preventDefault(); setInfo('');
    const em = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(em)) return setErr(t('Enter your e-mail address.'));
    if (mode !== 'reset' && pw.length < 8) return setErr(t('Password must be at least 8 characters.'));
    run(async () => {
      if (mode === 'in') await signIn(em, pw);
      else if (mode === 'up') { const r = await signUp(em, pw); if (!r.session) setInfo(t('Almost there: open the link we just e-mailed you to confirm your address, then sign in.')); }
      else { await auth.reset(em); setInfo(t('If that address has an account, a reset link is on its way.')); }
    });
  };
  return h('form.auth', { onSubmit: submit, noValidate: true },
    h(Logo),
    h(Pills, { v: mode === 'reset' ? '' : mode, set: sw, o: [['in', t('Sign in')], ['up', t('Create account')]] }),
    F(t('E-mail'), In(email, setEmail, { type: 'email', autoComplete: 'email', inputMode: 'email', autoCapitalize: 'none', placeholder: 'you@example.com' })),
    mode !== 'reset' ? F(t('Password'), In(pw, setPw, { type: 'password', autoComplete: mode === 'in' ? 'current-password' : 'new-password', placeholder: mode === 'up' ? t('At least 8 characters') : '' })) : null,
    h(Er, { e: err || (error ? terr(error) : '') }),
    info ? h('div.ban', { role: 'status' }, info) : null,
    h('button.btn', { type: 'submit', disabled: busy }, busy ? t('Working...') : mode === 'in' ? t('Sign in') : mode === 'up' ? t('Create account') : t('Send reset link')),
    config.googleSignIn && mode !== 'reset' ? h('div', null, h('div.auth-or', t('or')),
      h('button.btn.gh', { type: 'button', disabled: busy, onClick: () => run(() => auth.google()) }, t('Continue with Google'))) : null,
    mode === 'in' ? h('button.auth-alt', { type: 'button', onClick: () => sw('reset') }, t('Forgot your password?'))
      : mode === 'reset' ? h('button.auth-alt', { type: 'button', onClick: () => sw('in') }, t('Back to sign in')) : null,
    h(Lang));
}

// Signed in, but this device does not hold the key to the data yet (new device, or the sign-in came from an e-mail link).
export function Lock() {
  const S = useStore(), create = S.lock === 'create';
  const [byCode, setByCode] = useState(false), [pw, setPw] = useState(''), [code, setCode] = useState(''), [ask, setAsk] = useState(false);
  const [run, busy, err, setErr] = useAct();
  const submit = e => {
    e.preventDefault();
    if (pw.length < 8) return setErr(t('Password must be at least 8 characters.'));
    run(() => (byCode && !create ? unlockWithCode(code, pw) : unlock(pw)));
  };
  return h('form.auth', { onSubmit: submit, noValidate: true },
    h(Logo),
    h('p.auth-tag', t('Enter your password to open your data on this device.')),
    byCode && !create ? F(t('Recovery code'), CodeIn(code, setCode)) : null,
    F(t('Password'), In(pw, setPw, { type: 'password', autoComplete: 'current-password' })),
    h(Er, { e: err }),
    h('button.btn', { type: 'submit', disabled: busy }, busy ? t('Working...') : create ? t('Continue') : t('Unlock')),
    create ? null : h('button.auth-alt', { type: 'button', onClick: () => { setByCode(!byCode); setErr(''); } }, byCode ? t('Back') : t('Use my recovery code')),
    byCode && !create ? h('button.auth-alt', { type: 'button', onClick: () => (pw.length < 8 ? setErr(t('Password must be at least 8 characters.')) : setAsk(true)) }, t('I lost my recovery code')) : null,
    h('button.auth-alt', { type: 'button', onClick: signOut }, t('Sign out')),
    ask ? h(Confirm, { title: t(LOST.title), text: t(LOST.text), yes: t(LOST.yes), danger: true, busy, error: err, onNo: () => setAsk(false), onYes: () => run(async () => { await startOver(pw); setAsk(false); }) }) : null);
}

// Shown once, right after the account's data key is made. The code is the only way back in if the password is forgotten.
export function RecoveryCode({ code }) {
  const [copied, setCopied] = useState(false), g = String(code || '').split('-');
  const copy = async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch (e) { /* the code stays on screen */ } };
  return h('div.tut.dark', { style: { '--tbg': '#191b18' } },
    h('div.tut-in', null,
      h('div.tut-stage', null, h('section.tp', null,
        h('h1.tt', null, t('Your recovery code')),
        h('p.tsub', null, t('If you forget your password, this code is the only way back to your data. Keep it somewhere safe.')),
        h('div.tbody', null,
          h('div.rcode', { 'aria-label': code }, [0, 2, 4].map(i => h('div', { key: i }, h('span', null, g[i]), h('span', null, g[i + 1])))),
          h('button.tadd', { type: 'button', onClick: copy }, copied ? t('Copied ✓') : t('Copy'))),
        h('div.tfoot', null, h('button.tbtn', { type: 'button', onClick: () => saveSettings({ rc_ack: true }) }, t('I saved it')))))));
}

// shown after the user opens the reset link from the e-mail
export function NewPassword() {
  const S = useStore(), v = vaultState(), settled = S.phase === 'lock' || S.phase === 'ready', needCode = settled && v.exists && !v.unlocked;
  const [pw, setPw] = useState(''), [code, setCode] = useState(''), [ask, setAsk] = useState(false), [run, busy, err, setErr] = useAct();
  const submit = e => {
    e.preventDefault();
    if (pw.length < 8) return setErr(t('Password must be at least 8 characters.'));
    run(async () => { await finishRecovery(pw, code); say(t('Password changed ✓')); });
  };
  return h('form.auth', { onSubmit: submit },
    h(Logo), h('p.auth-tag', t('Choose a new password.')),
    S.phase === 'loading' ? h(Sk) : h(Frag, null,
      needCode ? F(t('Recovery code'), CodeIn(code, setCode), t('Your data is encrypted. The recovery code lets the new password open it.')) : null,
      F(t('New password'), In(pw, setPw, { type: 'password', autoComplete: 'new-password', placeholder: t('At least 8 characters') })),
      h(Er, { e: err }),
      h('button.btn', { type: 'submit', disabled: busy }, busy ? t('Working...') : t('Save password')),
      needCode ? h('button.auth-alt', { type: 'button', onClick: () => (pw.length < 8 ? setErr(t('Password must be at least 8 characters.')) : setAsk(true)) }, t('I lost my recovery code')) : null),
    ask ? h(Confirm, { title: t(LOST.title), text: t(LOST.text), yes: t(LOST.yes), danger: true, busy, error: err, onNo: () => setAsk(false), onYes: () => run(async () => { await startOver(pw); setAsk(false); say(t('Password changed ✓')); }) }) : null);
}

// config.js still has the placeholders
export const Setup = () => h('div.auth', null,
  h(Logo),
  h('p.auth-tag', t('This copy of the app is not connected to a database yet.')),
  h('ol.steps', null,
    h('li', null, t('Create a free project at supabase.com and run supabase/schema.sql in its SQL Editor.')),
    h('li', null, t('Copy the Project URL and the publishable key into app/config.js.')),
    h('li', null, t('Upload the app folder again and reload this page.'))),
  h('p.note', t('The step-by-step guide is in DEPLOY.md.')),
  h(Lang));
