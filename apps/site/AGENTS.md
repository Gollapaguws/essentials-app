- Auth is Supabase-owned and bearer-only: the browser reads the access token from
  `supabase.auth.getSession()` on every API call via `api()` in `src/lib/auth.js`.
- Auth provider: `AuthContext`, callback via `exchangeCodeForSession` in app shell
  (`AuthCallback` / `auth/callback` page), role resolved by the API from
  `app_metadata.role` with a DB fallback.
- Roles come from `GET /api/auth/me`, never from the token claims. Privileged roles
  (`promoter`, `venue_manager`, `admin`) must finish TOTP setup in the dashboard.
- Public site: open sign-up (in `apps/site/src/pages/Register.jsx`). The dashboard
  admin assigns the role (`artist`, `promoter`, `venue_manager`, `admin`); guest is
  the default for anyone not onboarded by an admin.
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`.
