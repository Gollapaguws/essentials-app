#!/bin/bash
# quick aal2 refresh for the smoke admin
set -e
E=/opt/essentials/app/.env
ANON=$(grep "^SUPABASE_ANON_KEY=" $E | cut -d= -f2)
SVC=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" $E | cut -d= -f2)
ACCESS=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "Content-Type: application/json" -d '{"email":"smoke@essentialsedm.com","password":"SmokeTest123!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
SUB=$(echo "$ACCESS" | python3 -c 'import sys,base64,json;p=sys.stdin.read().strip().split(".")[1];print(json.loads(base64.urlsafe_b64decode(p+"="*(4-len(p)%4)))["sub"])')
FSECRET=$(docker exec supabase_db_app psql -U postgres -d postgres -tAc "select secret from auth.mfa_factors where user_id='$SUB' and status='verified' limit 1" | tr -d ' ')
FID=$(curl -s "http://127.0.0.1:54321/auth/v1/user" -H "Authorization: Bearer $ACCESS" | python3 -c 'import sys,json;fs=[f for f in json.load(sys.stdin)["factors"] if f["status"]=="verified"];print(fs[0]["id"])')
CODE=$(node /tmp/totp.mjs "$FSECRET" | awk '{print $3}')
CHID=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/factors/$FID/challenge" -H "Authorization: Bearer $ACCESS" -H "Content-Type: application/json" -d '{}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
AAL2=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/factors/$FID/verify" -H "Authorization: Bearer $ACCESS" -H "Content-Type: application/json" -d "{\"code\":\"$CODE\",\"challenge_id\":\"$CHID\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')
echo "aal2-len: ${#AAL2}"
echo "$AAL2" > /tmp/aal2.txt
