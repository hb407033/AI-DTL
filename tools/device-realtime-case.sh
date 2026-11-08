#!/bin/sh
# 真机实时对话回归。会 SSH 到家里的 mini，并从已连接的 iPad 取音频。
# 没有用户当次明确授权时不要运行。本文件只准备命令，不代替授权。
# 用法：AI_DTL_ALLOW_DEVICE=1 tools/device-realtime-case.sh <题图.jpg> <case> <孩子台词文件> [候选序号]
set -u
if [ "${AI_DTL_ALLOW_DEVICE:-}" != "1" ]; then
  echo "未授权：不连接 mini，不启动真机。"
  exit 2
fi
cd "$(dirname "$0")/.."
PHOTO="$1"; CASE="$2"; LINES="$3"; CANDIDATE="${4:-0}"
DEVICE=00008112-000509D9268A201E; MINI="${AI_DTL_MINI:-hb-mini@10.10.10.6}"
ssh_mini() { ssh ${AI_DTL_SSH_OPTS:-} "$MINI" "$@"; }
stop_this() {
  PID=$(cat /tmp/ai-dtl-device-run-pid 2>/dev/null || true)
  case "$PID" in ''|*[!0-9]*) return ;; esac
  ssh_mini "kill $PID 2>/dev/null || true; sleep 0.4; if ps -p $PID >/dev/null 2>&1; then kill -9 $PID 2>/dev/null || true; fi"
  if ssh_mini "ps -p $PID >/dev/null 2>&1"; then echo "PID=$PID 仍在"; else echo "PID=$PID 已停"; fi
  if ssh_mini "lsof -nP -iTCP:8797 -sTCP:LISTEN >/dev/null 2>&1"; then echo "PORT8797=busy"; else echo "PORT8797=free"; fi
  if ssh_mini "lsof -nP -iTCP:8798 -sTCP:LISTEN >/dev/null 2>&1"; then echo "PORT8798=busy"; else echo "PORT8798=free"; fi
}
A=$(mktemp -d); trap 'rm -rf "$A"' EXIT
i=0; while IFS= read -r t; do [ -n "$t" ] && { sh tools/sim-child-turn.sh "$A" "$CASE" $i "$t" >/dev/null; i=$((i+1)); }; done < "$LINES"
N=$((i+1))
rm -f /tmp/ai-dtl-device-run-dir
# 只对这一次启动打开直连。不改家长设置里的默认开关。
export AI_DTL_MINI
[ -n "${AI_DTL_SSH_OPTS:-}" ] && export AI_DTL_SSH_OPTS
AI_DTL_REALTIME_MODE=YES sh tools/device-teaching-run.sh "$PHOTO" "$CASE" "$CANDIDATE" > "$A/launch.log" 2>&1
tail -1 "$A/launch.log"
[ -s /tmp/ai-dtl-device-run-dir ] || { echo "启动失败（iPad 可能锁屏）"; stop_this; exit 2; }
DIR=$(cat /tmp/ai-dtl-device-run-dir)
for f in "$A"/child-audio/*.pcm; do ssh_mini "cat > \"\$HOME/$DIR/child-audio/$(basename "$f")\"" < "$f"; done
n=0; for k in $(seq 1 55); do
  n=$(ssh_mini "f=\$(find \"\$HOME/$DIR\" -name '*.json' -path '*workspaces*' | head -1); [ -n \"\$f\" ] && grep -o '\"utterance\":' \"\$f\" | wc -l || echo 0" | tr -d ' ')
  [ "${n:-0}" -ge $N ] && break; sleep 10
done
echo "turns=$n/$N"
ssh_mini "touch \"\$HOME/$DIR/child-audio/$CASE-end\"; f=\$(find \"\$HOME/$DIR\" -name '*.json' -path '*workspaces*' | head -1); grep -oE '\"statement\":\{\"text\":\"[^\"]{0,50}' \"\$f\" | head -1; grep -oE '\"(child|utterance)\":\"[^\"]{0,170}\"' \"\$f\"; echo contested=\$(grep -oE '\"contested\":true' \"\$f\" | wc -l); grep -E 'Rejected|Override|ProviderFailure' -A4 /tmp/ai-dtl-device-run.log | grep -E 'reason|utterance|code|network'; rm -f \"\$HOME/$DIR/child-audio/\"*.pcm"
stop_this
P=$(xcrun devicectl device info processes --device "$DEVICE" 2>/dev/null | grep ScholarPad.app | awk '{print $1}' | head -1)
[ -n "$P" ] && xcrun devicectl device process terminate --device "$DEVICE" --pid "$P" >/dev/null 2>&1
echo "验收目录（mini）：~/$DIR"
