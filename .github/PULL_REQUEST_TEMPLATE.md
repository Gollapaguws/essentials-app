<!-- One paragraph: the problem this solves, in plain language. -->

## Intent

## What changed

<!-- Files, and the shape of the change. Call out anything a reviewer would not
     guess from the diff. -->

## Affected surface

<!-- Routes, screens, roles and endpoints to exercise. Say "dashboard only,
     /events and /settlements" rather than "web". -->

## Acceptance criteria

- [ ]

## Verification

<!-- The commands you ran, and what you checked by hand. If you could not sign
     in, or could not run a check, say that here instead of leaving it out. -->

```bash
npm run build --workspace @essentials/web
npm run lint  --workspace @essentials/web
npm run check:contrast
```

## Rollback

<!-- How to undo it: revert the commit, re-point a config, restore a file. -->
