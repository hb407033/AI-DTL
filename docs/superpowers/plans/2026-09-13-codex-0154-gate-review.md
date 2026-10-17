# Codex 0.154.0 实时接口门禁复核

## 结论：BLOCKED，未接入真实教师

2026-09-13 重新运行一次固定文本探针。当前身份的 realtime/start 返回：

`realtime conversation requires API key auth`

这不是 iPad 网络故障，也不等于所有 Codex 能力都不可用。只证明当前探针所用实时接口拒绝当前身份；未切换 API 身份、模型或读取凭据，未传儿童内容。

## 协议审计

- 初次运行发现本机版本由 0.153.4 变为 0.154.0，按原门禁停止。
- 本机 generate-json-schema 的 v2 聚合 SHA256：`f3487938786b729cb6773dbc9e83a7efab9c78c845db7094e8f539f373cbacc9`。
- 另用 `--experimental` 导出请求参数，核对 start（threadId/outputModality）、appendText（threadId/text，role 默认 user）、appendAudio（threadId/audio）、stop（threadId）、listVoices，以及 started/error/outputAudio 的必填字段。探针使用的最小字段兼容；未采用新可选字段。
- 保留版本与 schema 严格匹配门禁，仅在以上核对后更新契约锁定值。16 项探针测试及 TypeScript 类型检查通过。
- 官方 App Server 概览：https://learn.chatgpt.com/docs/app-server 。具体实验字段以本机生成的 schema 为本次核对证据；不从概览推断订阅授权。

## 结果文件

- 版本漂移阻断：validation/results/codex/codex-2026-09-13T12-42-25-883Z.json
- 实时鉴权阻断：validation/results/codex/codex-2026-09-13T12-45-49-903Z.json

## 后续边界

真实 Agent 接入仍停在授权门禁。不要再把订阅界面具备语音等同于自建客户端可调用，也不要为了完成验收偷偷改走其他模型。授权路径改变前，使用明确标记的脚本/家长接管验证 App、教学状态机和本地数据流程，不宣称真实 AI 教学通过。
