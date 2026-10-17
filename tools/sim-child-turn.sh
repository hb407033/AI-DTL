#!/bin/sh
# 模拟器调试：把一句“孩子的话”合成为 16kHz 单声道 PCM16，放进 serve-sim-debug-host 的音频夹具目录。
# 用法：tools/sim-child-turn.sh <验收目录> <case> <轮次> "孩子的话"
# 只用于隔离调试，不是真实儿童语音；Flo 等语音合成到文件会是空音频，固定用 Tingting。
set -eu
dir="$1/child-audio"; mkdir -p "$dir"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
say -v Tingting -r 180 -o "$tmp/a.aiff" "$4"
afconvert -f WAVE -d LEI16@16000 -c 1 "$tmp/a.aiff" "$tmp/a.wav"
python3 -I -c "import wave,sys;w=wave.open(sys.argv[1]);open(sys.argv[2],'wb').write(w.readframes(w.getnframes()))" "$tmp/a.wav" "$dir/$2-$3.tmp"
mv "$dir/$2-$3.tmp" "$dir/$2-$3.pcm"
echo "queued $2-$3"
