# Working in this repo

ESSENTIALS is an npm-workspaces monorepo: `apps/api` (NestJS), `apps/web` (Next 15
dashboard), `apps/site` (Vite public site), `apps/mobile` (Expo), and the
`packages/db`, `packages/auth`, `packages/api-client` libraries.

These rules exist so a change can be reviewed without re-deriving what it was
for. They apply to humans and agents alike.

## Branches and worktrees

- One branch per change, named for the change. Never commit straight to `main`.
- A change that spans apps belongs on one branch and names the apps it touches
  in the PR body; do not open a second PR for the follow-up unless it is a
  genuinely separate change.
- Keep unrelated pending work out of the branch. If the tree is dirty when you
  start, commit it first.

## Pull request body

Use `.github/PULL_REQUEST_TEMPLATE.md`. Every section gets an answer:

1. **Intent** — the problem, in one or two sentences.
2. **What changed** — the files and the shape of the change.
3. **Affected surface** — routes, screens, roles, or endpoints a reviewer must
   exercise.
4. **Acceptance criteria** — what must be true for this to count as done.
5. **Verification** — the commands you ran, and what you checked by hand.
6. **Rollback** — how to undo it.

## Verification

Run what the change needs, from the repo root:

```bash
npm run build --workspace @essentials/web   # dashboard compiles
npm run lint  --workspace @essentials/web   # eslint, --quiet
npm run check:contrast                      # every rendered token pair clears WCAG AA
```

For the API: `npm test --workspace @essentials/api` (jest) and
`npx tsc --noEmit -p apps/api`. For the public site: `npm run build --workspace @essentials/site`.
For the mobile app: `npx tsc --noEmit -p apps/mobile`.

Local dashboard: `npm run dev:web` (Next on port 3001). It needs the API and a
database, so a UI-only change that cannot get a signed-in session must say so
under Verification rather than claiming it was clicked through.

There is no `check:no-email` script. The mail relay, the email engine and the
mailbox screens are real, shipped features; the ban below is on adding *new*
email systems, not on touching the existing relay.

## Standing bans

- No new dependencies without asking first.
- No new email systems, mail providers or mailbox provisioning. Sending already
  goes through the swappable `MailProvider` over plain SMTP.
- No direct pushes to `main`, and no force-pushes to a shared branch.
- No secrets in the tree: credentials live in untracked env files or on the
  deployment, never in a commit, a fixture or a reply.
- No refactors, copy edits or layout changes smuggled into a visual or bug fix.
