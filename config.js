// Diligence - connection settings. This is the only file you edit when you deploy.
//
// Supabase dashboard > Project Settings > API Keys:
//   supabaseUrl : the "Project URL"            (https://xxxxxxxx.supabase.co)
//   supabaseKey : the "Publishable key"        (starts with sb_publishable_ ; the older "anon" key also works)
// Both are safe to publish: the database only lets a signed-in user see their own rows.
window.DILIGENCE_CONFIG = {
  supabaseUrl: "https://osgxajnbyiusborhmgci.supabase.co",
  supabaseKey: "sb_publishable_qhib5G_AzPSiqRg6LwjKnQ_mMauGLNi",
  googleSignIn: false        // set to true after you enable Google under Authentication > Sign In / Providers
};
