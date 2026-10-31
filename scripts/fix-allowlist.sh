#!/bin/bash
set -e
python3 - <<'PYEOF'
s=open("/opt/essentials/app/supabase/config.toml").read()
s=s.replace('uri_allow_list = ["https://essentialsedm.com/**", "https://essentialsedm.com/auth/callback", "https://essentialsedm.com/dashboard/**", "essentials://**"]','additional_redirect_urls = ["https://essentialsedm.com/**", "https://essentialsedm.com/auth/callback", "https://essentialsedm.com/dashboard/**", "https://essentialsedm.com/login", "essentials://**"]')
open("/opt/essentials/app/supabase/config.toml","w").write(s)
print("additional_redirect_urls" in s)
PYEOF
docker rm -f supabase_auth_app >/dev/null 2>&1 || true
cd /opt/essentials/app
supabase start -x studio,imgproxy,inbucket,edge-runtime,logflare,vector >/dev/null 2>&1
sleep 6
docker inspect supabase_auth_app --format "{{range .Config.Env}}{{println .}}{{end}}" | grep -E "SITE_URL|ALLOW"
systemctl restart essentials-api essentials-web
sleep 6
curl -s http://127.0.0.1:4000/api/site/health
echo
curl -sk https://essentialsedm.com/ -o /dev/null -w "site:%{http_code}\n"
