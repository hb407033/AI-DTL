#!/bin/sh
# 真机全流程（不需要 Xcode 账号/UI 测试运行器）：mini 上起隔离验收宿主 → devicectl 以 DEBUG 测试环境启动 iPad App
# → App 自动识别、选题、确认、开始讨论，并从 mini 的 /harness/audio/<case>/<index> 逐轮取孩子音频。
# 用法：tools/device-teaching-run.sh <题图.jpg> <case> [候选序号，默认0]
# 之后用 tools/sim-child-turn.sh 生成孩子音频，再 scp 到 mini 的 <验收目录>/child-audio/；结束时 touch <case>-end。
# 前提：iPad 已解锁、已安装 Debug 版 App；家庭作品库不受影响（宿主使用独立验收目录和 8797 端口）。
set -eu
PHOTO="$1"; CASE="$2"; CANDIDATE="${3:-0}"
DEVICE=00008112-000509D9268A201E
MINI="${AI_DTL_MINI:-hb-mini@10.10.10.6}"
DIR="Library/Application Support/ai-dtl/acceptance/device-$(date +%Y%m%d-%H%M%S)"
# 只连调用者指定的 mini。不按进程名清场，避免停掉正式学习宿主或别人的验收。
ssh_mini() { ssh ${AI_DTL_SSH_OPTS:-} "$MINI" "$@"; }
case "$DIR" in *acceptance*) ;; *) echo "验收目录必须落在 acceptance 下"; exit 1 ;; esac
if ssh_mini "lsof -nP -iTCP:8797 -sTCP:LISTEN >/dev/null 2>&1"; then echo "8797 已有服务，本次不启动"; exit 1; fi
PID=$(ssh_mini "cd ~/Documents/Codex/2026-08-29/wo-yo && mkdir -p \"\$HOME/$DIR\" && nohup \$HOME/.nvm/versions/node/v22.22.3/bin/node --env-file-if-exists=.env.ai.local --import tsx apps/agent-host/scripts/serve-sim-debug-host.ts \"\$HOME/$DIR\" 8797 8798 0.0.0.0 > /tmp/ai-dtl-device-run.log 2>&1 & echo \$!")
PID=$(printf '%s' "$PID" | tr -cd '0-9')
[ -n "$PID" ] || { echo "没有拿到验收宿主 PID"; exit 1; }
echo "$PID" > /tmp/ai-dtl-device-run-pid
stop_this() { ssh_mini "kill $PID 2>/dev/null || true"; }
ssh_mini "mkdir -p \"\$HOME/$DIR/child-audio\""
ssh_mini "cat > \"\$HOME/$DIR/child-audio/$CASE-photo.jpg\"" < "$PHOTO"
# 从 mini 本机探活。这台 Mac 到 mini 的 IPv4 可能不通，不能用它判断宿主是否起来。
ok=0
for i in $(seq 1 90); do
  if ssh_mini "curl -sf -m 2 http://127.0.0.1:8797/healthz >/dev/null"; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != 1 ]; then echo "mini 验收宿主未就绪"; stop_this; exit 1; fi
ENV=$(python3 -I -c "
import json,os,sys,uuid
env={'AI_DTL_WORKSPACE_TEST_ID': str(uuid.uuid4()).upper(), 'AI_DTL_WORKSPACE_HOST': 'hb-mini.local',
  'AI_DTL_WORKSPACE_HTTP_PORT': '8797', 'AI_DTL_WORKSPACE_AUDIO_URL': 'http://hb-mini.local:8797/harness/audio',
  'AI_DTL_ADAPTIVE_PHOTO_CASE': sys.argv[2], 'AI_DTL_AUTOSTART': '1', 'AI_DTL_AUTOSTART_CANDIDATE': sys.argv[3],
  'AI_DTL_WORKSPACE_PHOTO_URL': 'http://hb-mini.local:8797/harness/photo/' + sys.argv[2]}
if os.environ.get('AI_DTL_REALTIME_MODE') == 'YES': env['AI_DTL_REALTIME_MODE'] = 'YES'
print(json.dumps(env))" "$PHOTO" "$CASE" "$CANDIDATE")
# 实时开关只放进本次启动的环境变量。devicectl 会把 `-realtimeMode` 当成自己的短选项（其中的 -t），参数到不了 App。
REALTIME_ARG=""
if [ -n "${CONSOLE_LOG:-}" ]; then
  # 附着控制台，收集 App 的 NSLog（如 AIDTL-AUDIO 播放诊断）；进程结束时自动退出。
  nohup xcrun devicectl device process launch --device "$DEVICE" --terminate-existing --console --environment-variables "$ENV" com.houbin.aischolar.pad $REALTIME_ARG > "$CONSOLE_LOG" 2>&1 &
  sleep 5
else
  xcrun devicectl device process launch --device "$DEVICE" --terminate-existing --environment-variables "$ENV" com.houbin.aischolar.pad $REALTIME_ARG
fi
echo "验收目录（mini）：~/$DIR"
echo "$DIR" > /tmp/ai-dtl-device-run-dir
