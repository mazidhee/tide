#!/bin/sh
# Builds the harness and takes its screenshots: ./shoot.sh  (from anywhere; THEMES="light graphite" by default)
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT" && node_modules/.bin/esbuild design/prototype/knowledge/harness.tsx --bundle --format=iife --jsx=automatic --alias:@shared=./src/shared \
  --define:process.env.NODE_ENV='"production"' --log-level=warning --outfile=design/prototype/knowledge/harness.js || exit 1
mkdir -p "$HERE/shots"
shot() { # name, query, [height]
  "$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=1280,"${3:-900}" --virtual-time-budget=3000 \
    --screenshot="$HERE/shots/$1.png" "file://$HERE/index.html?$2" >/dev/null 2>&1
}
for theme in ${THEMES:-light graphite}; do
  shot "small-$theme" "set=small&theme=$theme"
  shot "small-open-$theme" "set=small&theme=$theme&tall=1&click=%5Bdata-concept%3D%22hash%22%5D%20.know-row-main" 1300
  shot "large-$theme" "set=large&theme=$theme"
  shot "large-full-$theme" "set=large&theme=$theme&tall=1&hover=7" 2300
  shot "large-open-$theme" "set=large&theme=$theme&tall=1&click=.know-area%3Anth-of-type%282%29%20.know-area-head" 4200
  shot "large-fading-$theme" "set=large&theme=$theme&tall=1&click=.know-status%20button%3Anth-child%283%29" 2600
done
shot "fresh-light" "set=fresh&theme=light"
shot "empty-light" "set=empty&theme=light"
shot "narrow-light" "set=large&theme=light&w=620&tall=1" 2600
ls "$HERE/shots"
