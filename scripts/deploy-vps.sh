#!/usr/bin/env bash
# Deploy `main` to the VPS (/opt/essentials/app).
#
# next build inlines NEXT_PUBLIC_* into the bundle and only reads .env files
# inside apps/web, so the root .env has to be exported first — otherwise every
# page fails to prerender with "supabaseUrl is required".
set -eo pipefail
cd "$(dirname "$0")/.."

git fetch origin --prune
git checkout main
git reset --hard origin/main
git log --oneline -1

# .env is not shell-safe (MAIL_FROM contains "Name <addr>"), so pull only the
# values the build needs instead of sourcing the whole file.
env_value() { grep -m1 "^$1=" .env | cut -d= -f2- | sed 's/[[:space:]]*$//'; }
export NEXT_PUBLIC_SUPABASE_URL="$(env_value NEXT_PUBLIC_SUPABASE_URL)"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$(env_value NEXT_PUBLIC_SUPABASE_ANON_KEY)"
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://essentialsedm.com/api}"

npm install --no-audit --no-fund
npm run generate -w @essentials/db
npm run migrate:deploy -w @essentials/db
npm run build -w @essentials/db
npm run build -w @essentials/api
npm run build -w @essentials/web

(cd apps/site && npm run build)
rsync -a apps/site/dist/ /var/www/essentialsedm/

systemctl restart essentials-api essentials-web
sleep 6
systemctl is-active essentials-api essentials-web
curl -s -o /dev/null -w "site:%{http_code}\n" https://essentialsedm.com/
curl -s -o /dev/null -w "dashboard:%{http_code}\n" https://essentialsedm.com/dashboard
curl -s -o /dev/null -w "api:%{http_code}\n" https://essentialsedm.com/api/auth/me
