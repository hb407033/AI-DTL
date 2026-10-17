#!/bin/sh
# AI-DTL 学习宿主启动脚本（第一阶段 T0）。固定 Node 运行时，不依赖登录 shell PATH。
set -eu
cd /Users/hb-mini/Documents/Codex/2026-08-29/wo-yo
# 可明确指定已校验的独立部署包；不自动选择可能过时的旧包，不把密钥编进产物。
if [ "$#" -gt 0 ]; then
  case "$1" in
    /*.mjs) [ -f "$1" ] || { echo "宿主包不存在" >&2; exit 1; } ;;
    *) echo "需要已验证宿主包的绝对 .mjs 路径" >&2; exit 1 ;;
  esac
  exec /opt/homebrew/bin/node --env-file-if-exists=.env.ai.local "$1"
fi
exec /opt/homebrew/bin/node --env-file-if-exists=.env.ai.local --import tsx apps/agent-host/src/ai/learning-tutor.ts
