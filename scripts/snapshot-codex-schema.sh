#!/usr/bin/env bash
# 记录本机 Codex 版本与 app-server v2 聚合 schema 的 SHA-256，输出一行 JSON 供探针做版本漂移门禁。
# schema 落到 work/codex-app-server-schema/（已被 .gitignore 忽略），不入库。
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/work/codex-app-server-schema"
rm -rf "$out" && mkdir -p "$out"
version="$(codex --version | awk '{print $2}')"
codex app-server generate-json-schema --out "$out" >/dev/null
sha="$(shasum -a 256 "$out/codex_app_server_protocol.v2.schemas.json" | awk '{print $1}')"
realtime_feature="$(codex features list | awk '/^realtime_conversation/ {print $NF}')"
printf '{"codexVersion":"%s","v2SchemaSha256":"%s","realtimeConversationFeature":"%s","generatedAt":"%s"}\n' \
  "$version" "$sha" "$realtime_feature" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee "$out/snapshot.json"
