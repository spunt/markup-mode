#!/usr/bin/env bash
# Convert the captured demo webm (scripts/capture-demo.js) into an optimized README GIF.
#   bash scripts/make-gif.sh
# Tunables (env): FPS WIDTH COLORS LOSSY  e.g.  FPS=10 WIDTH=760 LOSSY=80 bash scripts/make-gif.sh
set -euo pipefail
cd "$(dirname "$0")/.."
IN=docs/demo-raw.webm
OUT=docs/demo.gif
FPS=${FPS:-12}; WIDTH=${WIDTH:-860}; COLORS=${COLORS:-128}; LOSSY=${LOSSY:-40}
PAL="$(mktemp -t mmpal).png"
# two-pass palette for accurate color (palettegen/paletteuse), then gifsicle to shrink
ffmpeg -y -i "$IN" -vf "fps=$FPS,scale=$WIDTH:-1:flags=lanczos,palettegen=stats_mode=diff" "$PAL" 2>/dev/null
ffmpeg -y -i "$IN" -i "$PAL" -lavfi "fps=$FPS,scale=$WIDTH:-1:flags=lanczos,paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" "$OUT" 2>/dev/null
gifsicle -O3 --colors "$COLORS" --lossy="$LOSSY" -b "$OUT"
rm -f "$PAL"
ls -la "$OUT" | awk '{print "GIF:", $5, $NF}'
