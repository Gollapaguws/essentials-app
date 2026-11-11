process.env.SUPABASE_URL = "http://test.local";
process.env.SUPABASE_ANON_KEY = "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
// Database-backed suites opt in with TEST_DATABASE_URL; @essentials/db reads
// DATABASE_URL when it constructs the client, which happens after this file.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
