// ---------------------------------------------------------------
// Budget — cloud sync configuration
// ---------------------------------------------------------------
// Fill these two values to enable cross-device sync via Supabase.
// Leave them empty to keep the app fully local (browser-only).
//
// Where to find these:
//   Supabase dashboard → your project → Settings → API
//   - "Project URL"            → supabaseUrl
//   - "anon / public" API key  → supabaseAnonKey
//
// The anon key is designed to be public — Row Level Security in
// the database is what protects your data (see schema.sql).
// ---------------------------------------------------------------
window.BUDGET_CONFIG = {
  supabaseUrl: "https://hdojsucxhhahekxdfcju.supabase.co",
  supabaseAnonKey: "sb_publishable_oVt8WTWCjDCG57bQs253RQ_my0SK7lY",
};
