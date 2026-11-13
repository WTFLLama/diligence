// auth.js - sign in, create an account, reset a password. Also the "not connected yet" screen.
import { h, useState, F, In, Er, useAct, Pills } from '../lib.js';
import { auth, config } from '../api.js';
import { t, PREF, terr } from '../prefs.js';
import { saveSettings, endRecovery, say } from '../store.js';

const Logo = () => h('div.auth-logo', null, h('img', { src: 'icons/icon-192.png', alt: '' }), h('b', 'Diligence'));
const Lang = () => h('div', { style: { marginTop: 22 } }, h(Pills, { v: PREF.lang, set: v => saveSettings({ lang: v }), o: [['en', 'English'], ['tr', 'Türkçe']] }));

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
      if (mode === 'in') await auth.signIn(em, pw);
      else if (mode === 'up') { const r = await auth.signUp(em, pw); if (!r.session) setInfo(t('Almost there: open the link we just e-mailed you to confirm your address, then sign in.')); }
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

// shown after the user opens the reset link from the e-mail
export function NewPassword() {
  const [pw, setPw] = useState(''), [run, busy, err, setErr] = useAct();
  const submit = e => {
    e.preventDefault();
    if (pw.length < 8) return setErr(t('Password must be at least 8 characters.'));
    run(async () => { await auth.setPassword(pw); say(t('Password changed ✓')); endRecovery(); });
  };
  return h('form.auth', { onSubmit: submit },
    h(Logo), h('p.auth-tag', t('Choose a new password.')),
    F(t('New password'), In(pw, setPw, { type: 'password', autoComplete: 'new-password', placeholder: t('At least 8 characters') })),
    h(Er, { e: err }),
    h('button.btn', { type: 'submit', disabled: busy }, busy ? t('Working...') : t('Save password')));
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
