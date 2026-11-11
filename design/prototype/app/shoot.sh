#!/bin/sh
# Screenshots every screen in both themes into shots/. Usage: sh shoot.sh [width height]
cd "$(dirname "$0")"
C="$HOME/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
W=${1:-1440}; H=${2:-900}
for t in light dark; do
  for p in index lesson note library know connections speed; do
    "$C" --headless=new --hide-scrollbars --window-size=$W,$H --virtual-time-budget=3000 --screenshot="shots/$p-$t-$W.png" "file://$PWD/$p.html?theme=$t" >/dev/null 2>&1
  done
  for y in 760 1560 2300; do
    "$C" --headless=new --hide-scrollbars --window-size=$W,$H --virtual-time-budget=3000 --screenshot="shots/lesson-$t-$W-y$y.png" "file://$PWD/lesson.html?theme=$t&y=$y" >/dev/null 2>&1
  done
done
ls shots | wc -l
