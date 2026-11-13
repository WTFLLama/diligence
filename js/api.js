// api.js - the only file that talks to Supabase. Sign-in + one generic "call a database function" helper.
const cfg = window.DILIGENCE_CONFIG || {};
export const config = cfg;
export const configured = () => /^https:\/\/[^/]+\.[^/]+/.test(cfg.supabaseUrl || '') && !/YOUR-/.test((cfg.supabaseUrl || '') + (cfg.supabaseKey || '')) && (cfg.supabaseKey || '').length > 20;

let client = null;
export function sb() {
  if (!client) {
    if (!window.supabase || !window.supabase.createClient) throw new Error('Could not load the Supabase library. Check your connection and reload.');
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  }
  return client;
}

const here = () => location.origin + location.pathname;
const clean = e => {
  const msg = String((e && (e.message || e.error_description || e.msg)) || e || 'Something went wrong');
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return 'No connection. Check your internet and try again.';
  if (/JWT expired|invalid JWT/i.test(msg)) return 'Your session expired. Sign in again.';
  return msg;
};

// Calls a database function (see supabase/schema.sql). One call = one transaction.
export async function rpc(fn, args) {
  let res;
  try { res = await sb().rpc(fn, args || {}); } catch (e) { throw new Error(clean(e)); }
  if (res.error) throw new Error(clean(res.error));
  return res.data;
}

const done = async p => { let r; try { r = await p; } catch (e) { throw new Error(clean(e)); } if (r.error) throw new Error(clean(r.error)); return r.data; };
export const auth = {
  session: async () => (await done(sb().auth.getSession())).session,
  onChange: cb => sb().auth.onAuthStateChange((event, session) => setTimeout(() => cb(event, session), 0)),
  signIn: (email, password) => done(sb().auth.signInWithPassword({ email, password })),
  signUp: (email, password) => done(sb().auth.signUp({ email, password, options: { emailRedirectTo: here() } })),
  signOut: () => done(sb().auth.signOut()),
  reset: email => done(sb().auth.resetPasswordForEmail(email, { redirectTo: here() })),
  setPassword: password => done(sb().auth.updateUser({ password })),
  google: () => done(sb().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: here() } }))
};

// address + secret for the iPhone Shortcut / Gmail forwarder (automatic capture)
export const captureEndpoint = () => (cfg.supabaseUrl || '').replace(/\/+$/, '') + '/rest/v1/rpc/inbox_capture';
