#!/bin/sh
# Screenshots of the harness: every set, narrow and wide, light and dark. Run from the repo root.
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
HERE="$(cd "$(dirname "$0")" && pwd)"
for theme in ${THEMES:-light graphite}; do
  for set in ${SETS:-table bars lines edge}; do
    for w in ${WIDTHS:-420 900}; do
      [ "$w" = 420 ] && size=1420,1500 || size=1920,1700
      "$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=$size --virtual-time-budget=6000 \
        --screenshot="$HERE/shots/$set-$w-$theme.png" "file://$HERE/index.html?theme=$theme&w=$w&set=$set" >/dev/null 2>&1
    done
  done
done
ls "$HERE/shots"
