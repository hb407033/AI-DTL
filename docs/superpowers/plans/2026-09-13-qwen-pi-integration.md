# 千问 Omni Flash + Pi 分阶段接入执行计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前任务逐项实施；不自动委托、不提交既有未提交改动。

**Goal:** 接入可测试的 Pi 教学提案桥接和千问实时协议客户端，保留现有教学规则、原生 iPad 与 SQLite 档案。

**Architecture:** 用户已确认千问 Omni Flash Realtime + Pi 模式。Pi 通过本地 CLI JSON 模式生成 TeachingProposal，本地内核校验后才呈现；语音通道与教学提案通道分离。阶段一不向 iPad 直接转发未经校验的模型音频，不默认开启付费连接。

**Tech Stack:** TypeScript、Fastify、ws、已安装 Pi 0.85.1、Swift/PencilKit、SQLite。

## 范围与门禁

- 不读取、复用、记录聊天中已暴露的 Key。只接受用户后续填入本机的全新 Key。
- 默认保持 parent 模式。显式 `--pi` 才启用 Pi；Pi provider/model 必须配置，不偷偷选择默认模型。
- Pi 初期禁用文件、shell、扩展、技能、上下文文件发现及会话持久化；学习材料由宿主提供，档案写入仍由 GrowthLedgerService 决定。此限制不是完整 OS 沙箱。
- 千问模型固定 `qwen3.5-omni-flash-realtime`，北京工作空间 WSS；模型和地域变更须显式配置及复核，不使用普通 Omni 代替。
- 仅做无密钥自动测试和本地配置检查，不启动 Pi 推理、不发起云端语音。

## 阶段一：宿主可测接入

### 1. 配置入口

- [x] 创建 `apps/agent-host/src/ai/config.ts`、`apps/agent-host/test/ai-config.test.ts`、`.env.ai.example`。
- [x] 先断言缺配置时返回缺失字段名、Key 不出现在诊断中、工作空间只允许 DNS 标签；固定 Qwen 模型与北京 endpoint。
- [x] 增加 `pnpm ai:check`：只报告配置完整性，不输出 Key 文件内容、不联网验证授权。
- [x] 测试命令：`pnpm exec vitest run apps/agent-host/test/ai-config.test.ts`。

### 2. Pi 提案桥接

- [x] 创建 `apps/agent-host/src/ai/pi-bridge.ts`、`pi-runner.ts` 及对应测试；修改 `bridge.ts` 支持 kind=pi，宿主显式选择。
- [x] 测试结构化输出、拒绝畸形 JSON/超过授权提示级别、并发拒绝、停止后迟到结果拒绝、超时和进程非零退出。
- [ ] CLI 契约为 `pi --print --mode json --no-session --no-tools --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files --no-approve --provider <configured> --model <configured> --system-prompt <fixed>`；任务通过 stdin 而非命令行传入。
- [x] 只使用成功 `message_end` 的 assistant text；不将 stderr、思考链或半成品转给孩子。
- [ ] 真正云端调用留到 provider/model 与授权确认之后。

### 3. 千问协议客户端

- [x] 创建 `apps/agent-host/src/ai/qwen-session.ts`、`apps/agent-host/test/qwen-session.test.ts`。
- [x] 本地 WebSocket 服务验证 Bearer 请求头、session.created→session.update→session.updated、16kHz PCM 输入、转写、取消、关闭；输入和服务端帧大小有界。
- [x] 默认手动回合，不自动 response.create；收到的模型音频仅作为协议事件，不接入儿童播放。
- [x] 不把转写当成已确认掌握证据；断开不自动跨账号/模型重试。
- [ ] 执行相关宿主/内核测试及 typecheck，记录未跑真实云端验证。

## 阶段二：原生语音闭环（独立验收，不冒充阶段一完成）

1. 在 Swift 侧增加 AVAudioEngine 采集、回声控制、播放队列、立即停声；以独立 session/turn/revision 关联画布与语音。
2. 宿主语音路由需限制连接数、时长、帧大小及积压，退出页面关闭云端会话；未配置时只显示说明，不连接。
3. 接入转写确认及 Pi 提案；审核后播报不得依赖提示词保证逐字一致。云端自由生成音频须有独立播放门禁，否则继续使用已审核文本的原生 TTS。
4. 关键帧由画布版本绑定，不持续上传整屏；选择确定的视觉处理路径后测试“这里”指代，不把边界框当作看懂笔迹。
5. 用户填写新 Key、工作空间 ID、Pi provider/model 后，用成人合成内容验证授权，再跑真实 iPad 20 分钟测试；测首音、打断、误抢话、串轮和账单。

## 资料

## 2026-09-15 续开发：语音回合隔离基础（尚未接入 iPad）

- 新增 `apps/agent-host/src/ai/voice-turn.ts`：每次录音独占 Qwen 通道，绑定 sessionId/turnId/canvasRevision；只输出待确认转写，不写学习证据，不输出自由生成音频。
- 取消后忽略迟到事件；连接中退出不恢复录音；提交后禁止追加；转写成功即关闭。全流程默认 60 秒截止，PCM 每帧最多 100ms、累计最多 60 秒。
- 外层调用者仍需核对当前画布版本和回合是否有效。本模块尚未挂到宿主路由，不能宣称原生实时语音已接通。
- 验证：voice-turn、qwen-session、pi-bridge、pi-host、pi-runner、ai-config 共 6 文件 23 测试通过，包含实际本地 WebSocket 转写闭环；宿主 typecheck 与 git diff --check 通过。测试存在 Node SQLite experimental 警告。
- `pnpm ai:check` 按预期失败：尚无 `.env.ai.local`，缺新 Key、工作空间、Pi provider/model；未读取任何既有密钥，未发起云端调用。
- 下一步：受限宿主语音路由与原生采集接入；确认文本接入既有证据流程；再进行成人内容云端与 iPad 联调。此次不提交、不覆盖此前未提交改动。

- 千问协议：https://help.aliyun.com/zh/model-studio/realtime （2026-09-13 核对）
- Pi 本地安装文档：`/Users/houbin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/json.md` 与 README（0.85.1）
- 现有学习档案不迁移到 Pi；课程知识层、学科判定质量不因接通模型而视为完成。
