#!/bin/sh
# 生成 6 位一次性口令，写入应用支持目录的 key-handout.json（只有口令和过期时间，不含密钥）。
# 密钥仍留在宿主进程的环境里，iPad 领取时由路由读取。不要把口令贴到聊天、工单或日志。
# 家庭作品库 workspaces-v2 不会被改动。默认不在本脚本里连接 mini。
set -eu
DIR="${AI_DTL_HANDOUT_DIR:-$HOME/Library/Application Support/ai-dtl}"
mkdir -p "$DIR"
CODE=$(node -e "const {randomInt}=require('node:crypto'); process.stdout.write(String(randomInt(0,1000000)).padStart(6,'0'))")
EXPIRES=$(node -e "process.stdout.write(new Date(Date.now()+10*60*1000).toISOString())")
FILE="$DIR/key-handout.json"
TMP="$FILE.tmp"
printf '%s\n' "{\"code\":\"$CODE\",\"expiresAt\":\"$EXPIRES\"}" > "$TMP"
chmod 600 "$TMP"
mv "$TMP" "$FILE"
printf '%s\n' "$CODE"
