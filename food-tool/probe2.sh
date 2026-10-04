#!/bin/bash
mkdir -p food-tool/out; exec > food-tool/out/probe2.txt 2>&1
UA="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
t(){ echo "=== $1"; curl -sS -m 25 -A "$UA" -H "Accept: application/json, text/plain, */*" -H "Accept-Language: en-US,en;q=0.9" -H "x-locale: en-ae" -o /tmp/b -w "HTTP %{http_code} %{size_download}B %{time_total}s\n" "$1"; head -c 600 /tmp/b; echo; }
curl -sS -m 10 https://ipinfo.io/json | head -c 300; echo
t "https://food.noon.com/_svc/mp-food-api-catalog/api/search?f%5Bcuisines%5D=pizza&type=outlet"
t "https://food.noon.com/_svc/mp-food-api-catalog/api/canonical-zones"
t "https://food.noon.com/uae-en/"
t "https://www.noon.com/_svc/catalog/api/v3/u/search?q=milk&limit=5"
t "https://minutes.noon.com/"
t "https://www.talabat.com/uae/grocery/651480/talabat-mart?aid=3986"
