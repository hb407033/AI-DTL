#!/bin/sh
# 真机跑一道题的完整对话：合成孩子台词 → mini 隔离验收宿主（8797）→ iPad Debug 版自动识别、开场、逐轮取音频。
# 用法：tools/device-teaching-case.sh <题图.jpg> <case> <孩子台词文件（每行一句）> [候选序号，默认0]
# 前提：iPad 已解锁、装的是 Debug 版；家庭作品库不受影响。结束后会停掉验收宿主并关掉 iPad 上的测试实例。
set -u
cd "$(dirname "$0")/.."
PHOTO="$1"; CASE="$2"; LINES="$3"; CANDIDATE="${4:-0}"
DEVICE=00008112-000509D9268A201E; MINI=hb-mini@10.10.10.6
A=$(mktemp -d); trap 'rm -rf "$A"' EXIT
i=0; while IFS= read -r t; do [ -n "$t" ] && { sh tools/sim-child-turn.sh "$A" "$CASE" $i "$t" >/dev/null; i=$((i+1)); }; done < "$LINES"
N=$((i+1))
rm -f /tmp/ai-dtl-device-run-dir
sh tools/device-teaching-run.sh "$PHOTO" "$CASE" "$CANDIDATE" > "$A/launch.log" 2>&1; tail -1 "$A/launch.log"
[ -s /tmp/ai-dtl-device-run-dir ] || { echo "启动失败（iPad 可能锁屏）"; ssh "$MINI" "pkill -f serve-sim-debug-host.ts"; exit 2; }
DIR=$(cat /tmp/ai-dtl-device-run-dir)
for f in "$A"/child-audio/*.pcm; do ssh "$MINI" "cat > \"\$HOME/$DIR/child-audio/$(basename "$f")\"" < "$f"; done
n=0; for k in $(seq 1 55); do
  n=$(ssh "$MINI" "f=\$(find \"\$HOME/$DIR\" -name '*.json' -path '*workspaces*' | head -1); [ -n \"\$f\" ] && grep -o '\"utterance\":' \"\$f\" | wc -l || echo 0" | tr -d ' ')
  [ "${n:-0}" -ge $N ] && break; sleep 10
done
echo "turns=$n/$N"
ssh "$MINI" "touch \"\$HOME/$DIR/child-audio/$CASE-end\"; f=\$(find \"\$HOME/$DIR\" -name '*.json' -path '*workspaces*' | head -1); grep -oE '\"statement\":\{\"text\":\"[^\"]{0,50}' \"\$f\" | head -1; grep -oE '\"(child|utterance)\":\"[^\"]{0,170}\"' \"\$f\"; echo contested=\$(grep -oE '\"contested\":true' \"\$f\" | wc -l); grep -E 'Rejected|Override|ProviderFailure' -A4 /tmp/ai-dtl-device-run.log | grep -E 'reason|utterance|code|network'; pkill -f serve-sim-debug-host.ts"
P=$(xcrun devicectl device info processes --device "$DEVICE" 2>/dev/null | grep ScholarPad.app | awk '{print $1}' | head -1)
[ -n "$P" ] && xcrun devicectl device process terminate --device "$DEVICE" --pid "$P" >/dev/null 2>&1
echo "验收目录（mini）：~/$DIR"
