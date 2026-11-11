#!/bin/sh
# Screenshots both forms in both themes into shots/. Usage: sh shoot.sh [name query]
cd "$(dirname "$0")"
C="$HOME/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
shot() { "$C" --headless=new --hide-scrollbars --use-gl=angle --window-size=1440,900 --virtual-time-budget=5000 --screenshot="shots/$1.png" "file://$PWD/index.html?$2" >/dev/null 2>&1; }
if [ -n "$1" ]; then shot "$1" "$2"; exit; fi
for t in light dark; do
  for f in 2d 3d; do
    shot "$f-$t-320" "form=$f&theme=$t"
    shot "$f-$t-320-focus" "form=$f&theme=$t&focus=transformers"
    shot "$f-$t-2000" "form=$f&theme=$t&n=2000"
  done
done
shot "2d-light-320-select" "form=2d&theme=light&select=raft"
shot "2d-light-2000-zoom" "form=2d&theme=light&n=2000&select=raft"
ls shots
