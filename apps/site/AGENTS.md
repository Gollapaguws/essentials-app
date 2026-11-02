# AGENTS.md

## Project Context

This is a Base44 app repository. Treat it as user-owned application code, keep changes focused on the user's request, and preserve existing project conventions.

Start with `README.md` for local setup, environment variables, and publish workflow.

## Base44 References

- CLI overview: https://docs.base44.com/developers/references/cli/get-started/overview.md
- Agent skills: https://docs.base44.com/developers/backend/overview/skills.md

If your agent supports Agent Skills, install or update Base44 skills before Base44-specific work:

```bash
npx skills add base44/skills
```

## Auth

Authentication runs on Supabase, not Base44. `src/lib/supabase.js` owns the client
(PKCE, `detectSessionInUrl: false`), `src/lib/AuthContext.jsx` exposes the session to
components, and `src/lib/auth.js` is the only place that talks to the NestJS API
(it reads the bearer token from the Supabase session on every call).

- The callback page `src/pages/AuthCallback.jsx` must exchange the PKCE code itself —
  Supabase's verifier lives in this browser, so a server route cannot finish the flow.
- Accounts are invite-only: a signed-in identity without a Prisma user lands on `/join`,
  where the invite code is redeemed against `/api/auth/invite/redeem`.
- Roles come from `GET /api/auth/me`, never from the token claims. Privileged roles
  (`promoter`, `venue_manager`, `admin`) must finish TOTP setup in the dashboard.
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`.

## Key Files

- `src/`: frontend application source.
- `src/lib/supabase.js`, `src/lib/AuthContext.jsx`, `src/lib/auth.js`: auth client, session state, API calls.
- `vite.config.js`: Vite config.
- `.env.local`: local-only environment values; never commit secrets.

## Working Notes

- Use `base44 dev` as the default local development command when you need the local Base44 backend. It can run the backend and frontend together.
- When docs or code mention the frontend being started automatically, that usually means the Base44 project config includes `site.serveCommand`, for example `"serveCommand": "npm run dev"` in `base44/config.jsonc`.
- Use `npm run dev` only for frontend-only work against the hosted Base44 backend.
- Prefer the existing Base44 CLI workflow over adding new npm scripts for Base44-specific tasks.
- Run the relevant checks from `package.json` before finishing code changes.
