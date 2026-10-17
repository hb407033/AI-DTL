# AI-DTL 千问 / Pi 本机配置与接入状态

## 2026-09-13 当前状态

阶段一后端基础已实现：Pi CLI JSON 提案桥接、宿主 `--pi` 选择、千问 WebSocket 协议客户端、本地配置检查。
未进行任何真实模型调用；未使用聊天中暴露的旧 Key。新增测试只使用合成字符串、本地假服务和假 Pi 子进程。

当前运行的 iPad 测试宿主保持 parent 模式，没有重启切换；本轮没有修改或重装原生应用。

## 以后在哪里填 Key

项目根目录的 `.env.ai.example` 是不含密钥的模板。准备联调时，在本机编辑器复制其内容到同目录 `.env.ai.local`，然后填写：

```dotenv
DASHSCOPE_API_KEY=
AI_DTL_QWEN_WORKSPACE_ID=
AI_DTL_PI_PROVIDER=
AI_DTL_PI_MODEL=
AI_DTL_PI_COMMAND=pi
```

- `DASHSCOPE_API_KEY`：撤销已暴露 Key 后重新生成的北京地域百炼 Key。只能在本机填写，不贴聊天、截图、终端命令参数。
- `AI_DTL_QWEN_WORKSPACE_ID`：与新 Key 对应的百炼业务空间 ID，不是阿里云账号 ID。不要从 Key 字符串推断它。
- Pi 两项：在 Pi 自己的设置中确认已授权的 provider 和精确 model ID 后填写；此处不替用户决定推理模型。千问语音 Key 不会转交 Pi 子进程；Pi 使用自己正常的 provider 认证配置。
- 模板中的空值故意保留：没有授权或模型时应明确未就绪，而不是回退其他服务。
- `.env.ai.local` 已被现有 `.gitignore` 的 `.env.*` 规则排除。创建后可在终端执行 `chmod 600 .env.ai.local` 限制本机文件访问。它仍是本地明文文件，勿同步或分享。

在项目根目录运行：

```sh
pnpm ai:check
```

输出只包含 ready、missing、status；不输出 Key、workspace、provider 或 model 的具体值，不联网。缺配置时退出码 1 是预期结果。
`configured-not-authenticated` 只表示格式完整，不代表余额、权限、模型 ID 或网络已验证。

## 不要现在误启动正式学习

```sh
pnpm host:pi
```

这个命令会启用真实 Pi 提案路径（收到求助等请求时可能计费），不会启用千问语音；默认数据目录仍是现有本地学习目录。
首次联调必须由执行者指定独立 `AI_SCHOLAR_DATA_DIR`，确认没有现有 8788/8789 端口冲突，不能覆盖正在运行的家长测试宿主。先用成人合成题验证，再决定正式启用。

当前 `pnpm host` 仍默认 parent 模式；不因为配置了 Key 就开始录音或创建云端语音会话。

## 已实现与边界

- Pi 参数禁止工具、扩展、技能、上下文文件发现和会话落盘。以 stdin 发送教学材料，不把孩子文本放到进程参数。超时 30 秒、输出上限 2 MiB、取消终止进程。stderr 不返回给孩子或写入本系统日志。
- Pi 只返回 TeachingProposal，宿主重新分配 ID、做结构与提示预算检查，随后再经过现有教学内核校验。本轮只用简短提示和空画布动作，尚未增加自定义课程检索工具。
- Pi 当前每个提案使用独立无持久会话进程；提供本轮 TurnContext，不保证完整跨会话记忆检索。长期档案保留在 SQLite，不迁移到 Pi。
- 千问固定 `qwen3.5-omni-flash-realtime`，工作空间北京 WSS。配置确认后才能送 16kHz/16bit/单声道 PCM。手动 commit，不自动 response.create。
- 转写标记 unconfirmed；收到音频标记 unapprovedAudio，仅用于协议层。没有把自由生成音频自动播放给孩子。
- 已知内核在等待提案时的暂停队列、断线后迟到结果处理仍须作为真实模型启用门禁；Pi 自身 stop/timeout 测试不等于完整交互取消通过。

## 下一阶段

1. 修复并验证等待提案时暂停、断线、重连的取消与过期结果拒绝；不能只停声音还继续修改教学状态。
2. 增加原生 AVAudioEngine 采集、回声控制、播放队列和本地立即打断。
3. 增加受限语音路由、连接时长/帧大小/积压限制、云端会话关闭；绑定 session/turn/画布版本。
4. 接入转写确认、Pi 教学提案与审核后播放；不能用“只照读”的提示词替代逐字审核保证。
5. 增加画布关键帧的视觉路径和 Pi 受限课程工具，再做真实成人测试课。

## 验证

运行命令：`pnpm exec vitest run apps/agent-host/test packages/learning-kernel/test`；两个 package 的 `typecheck`；`git diff --check`。
阶段一测试覆盖本地 WebSocket 握手、配置确认、音频提交、转写、取消、连接超时、错误隐藏、Pi stdin/JSONL、预算、迟到结果、子进程超时与退出、真实宿主事件流程。
没有声称千问真实授权、中文音质、iPad 麦克风或学习效果已经通过。
