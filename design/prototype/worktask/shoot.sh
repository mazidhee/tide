#!/bin/sh
# Builds the harness and takes its screenshots: ./shoot.sh [out dir]  (from anywhere; THEMES="light dark" by default)
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/shots}"
node "$HERE/build.mjs" || exit 1
mkdir -p "$OUT"
shot() { # name, query, [height]
  "$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=2 --window-size=1280,"${3:-900}" --virtual-time-budget=4000 \
    --screenshot="$OUT/$1.png" "file://$HERE/index.html?$2" >/dev/null 2>&1
}
for theme in ${THEMES:-light dark}; do
  shot "1-paste-$theme" "view=paste&theme=$theme" 760
  shot "2-busy-$theme" "view=busy&theme=$theme" 760
  shot "3-made-$theme" "view=made&theme=$theme" 520
  shot "4-overview-$theme" "view=overview&theme=$theme"
  shot "5-checkpoint-$theme" "view=checkpoint&theme=$theme" 1100
done
ls "$OUT"
