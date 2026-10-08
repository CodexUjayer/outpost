#!/usr/bin/env bash
# Re-downloads the internet-sourced sounds used by the game (see
# public/sounds/machinery/CREDITS.txt for licenses). Run from repo root.
set -e
cd "$(dirname "$0")/.."
mkdir -p public/sounds/machinery /tmp/snd
# CC0 generator loop
curl -sL -A "Mozilla/5.0" "https://opengameart.org/sites/default/files/loop_generator_1.mp3" -o /tmp/snd/generator_src.mp3
# CC0 steam boiler loop
curl -sL -A "Mozilla/5.0" "https://opengameart.org/sites/default/files/generator_loop.wav" -o /tmp/snd/boiler_src.wav
# CC0 steamboat engine
curl -sL -A "Mozilla/5.0" "https://opengameart.org/sites/default/files/steamboat_engine.wav" -o /tmp/snd/steamboat_src.wav
# CC0 electronic device loop
curl -sL -A "Mozilla/5.0" "https://opengameart.org/sites/default/files/qubodup-edev.flac" -o /tmp/snd/edev_src.flac
# CC-BY 3.0 "12 Ambient Machine Sounds" pack
curl -sL -A "Mozilla/5.0" "https://opengameart.org/sites/default/files/ambient%20machinery%201.zip" -o /tmp/snd/machines.zip
unzip -o /tmp/snd/machines.zip -d /tmp/snd/machines >/dev/null
# then see CREDITS.txt for the ffmpeg conversion recipe per clip
echo "downloaded to /tmp/snd — convert per public/sounds/machinery/CREDITS.txt"
