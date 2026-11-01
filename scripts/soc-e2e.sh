#!/bin/bash
set -e
E=/opt/essentials/app/.env
ANON=$(grep "^SUPABASE_ANON_KEY=" $E | cut -d= -f2)
ACCESS=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "Content-Type: application/json" -d '{"email":"smoke@essentialsedm.com","password":"SmokeTest123!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
SUB=$(echo "$ACCESS" | python3 -c 'import sys,base64,json;p=sys.stdin.read().strip().split(".")[1];print(json.loads(base64.urlsafe_b64decode(p+"="*(4-len(p)%4)))["sub"])')
# TOTP secret straight from the supabase DB (verified factor)
SECRET=$(docker exec supabase_db_app psql -U postgres -d postgres -tAc "select secret from auth.mfa_factors where user_id = '$SUB' and status = 'verified' limit 1" | tr -d ' ')
echo "secret-len: ${#SECRET}"
FID=$(curl -s "http://127.0.0.1:54321/auth/v1/user" -H "Authorization: Bearer $ACCESS" | python3 -c 'import sys,json;fs=[f for f in json.load(sys.stdin)["factors"] if f["status"]=="verified"];print(fs[0]["id"])')
CODE=$(node /tmp/totp.mjs "$SECRET" | awk '{print $3}')
CHID=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/factors/$FID/challenge" -H "Authorization: Bearer $ACCESS" -H "Content-Type: application/json" -d '{}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
AAL2=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/factors/$FID/verify" -H "Authorization: Bearer $ACCESS" -H "Content-Type: application/json" -d "{\"code\":\"$CODE\",\"challenge_id\":\"$CHID\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')
echo "aal2-token-len: ${#AAL2}"
echo "== generate content via local agent (this takes ~30-60s on 2 cores):"
timeout 240 curl -s --max-time 230 -X POST http://127.0.0.1:4000/api/social/generate -H "Authorization: Bearer $AAL2" -H "Content-Type: application/json" -d '{"topic":"ESSENTIALS: Amapiano Sunrise this Friday at The Warehouse","platforms":["instagram","x"]}' | head -c 700
echo
echo "== accounts:"
curl -s http://127.0.0.1:4000/api/social/accounts -H "Authorization: Bearer $AAL2" | head -c 200
echo
echo "$AAL2" > /tmp/aal2.txt
