#!/bin/sh
# Screenshots the harness with headless Chrome: ./shoot.sh <name> "<query>" [width] [height] [budget-ms]
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
DIR="$(cd "$(dirname "$0")" && pwd)"
"$CHROME" --headless=new --hide-scrollbars --window-size="${3:-1000},${4:-900}" --virtual-time-budget="${5:-4000}" \
  --screenshot="$DIR/shots/$1.png" "file://$DIR/index.html?$2" 2>&1 | grep -v -E "^$|DevTools|bytes written|dbus|ERROR:" 
exit 0
