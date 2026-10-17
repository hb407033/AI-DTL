# AI-DTL 新照片到学习会话的闭环修复计划

> **For agentic workers:** 按 superpowers:executing-plans 顺序执行。实现由现有 Pi `modelarts/glm-5.2` 会话负责，Codex 负责复核与验收。禁止把按钮测试或已确认夹具当作完整闭环。

**Goal:** 一张新照片经过识别、核对、确认后进入同一学习记录，孩子写画、对话、暂停、重开能够接着学习；失败可理解、可继续，不丢原稿。

**Architecture:** 保留 Swift/PencilKit 客户端、Mac mini 本地主机、千问 3.8 Omni 实时模型。复用现有 workspace API、缓存、对话协议，不增加平台或模型。先复现实际断点，再修改被证实有问题的直接调用链。

**Tech Stack:** Swift 6、SwiftUI、PencilKit、URLSession；TypeScript、Fastify、ws、Vitest；Pi GLM5.2 实现。

## 当前证据与边界

- mini 主仓库 `/Users/hb-mini/Documents/Codex/2026-08-29/wo-yo`，分支 `codex/ipad-arrival-plan`，HEAD `e2a14d1`，179 项已有未提交文件。不能批量提交、切换分支或清理。
- 主机 `10.10.10.6:8791/healthz` 正常，learning-tutor、configured=true，hostId `62a27a5d-588d-4807-8ad9-db981fdc8d81`。
- 公共合成彩带图实际调用 `recognizePhoto` 成功：1750 ms，识别“每米彩带2.4元，买0.3米需要多少元？”。因此“模型完全不能识别”不是目前已证实的根因；这个探针没有证明客户端 HTTP 全链通过。
- 上次 13 项测试覆盖相机中文、原图预览、画布和恢复入口，但从 confirmed fixture 起步；没有一项把新照片通过真实 HTTP 识别、确认后接到对话和重开。上次报告不能当作闭环通过。
- 源码确认：`usePhoto()` 在 currentUnit 为空时只给“请家长先填写当前单元”，没有直接带到配置；主机地址为空也到网络失败阶段才提示。
- 源码确认：`uploadPhoto()` 每次创建新 session 和新的媒体/event UUID；识别回执丢失后客户端没有保存这些过程状态。服务器已有 recognize event 重放保障，但客户端重试无法复用。是否导致重复会话/收费，需要隔离故障注入证明。
- `request()` 丢弃 HTTP 错误体，UI 将识别故障统一解释为 Mac 连接问题；配置、忙碌、网络、模型超时不能区分。不要向孩子暴露密钥、服务栈或英语异常。
- 不能据用户一句“没闭环”推断某个具体物理故障。每项新增诊断必须记录是已复现、源码确定还是待验证。
- 后续补充：Codex 独立隔离 HTTP 探针完成 create → 原照/preview → recognize → confirm → GET，状态依次 201/201/201/200/200/200，确认后 exploring、同一 session/photo；识别约 1600 ms。重放 recognize 没有再次调用模型（总计 1 次）。探针使用 JSON.stringify 比较得到 false，这可能仅是键序，尚未证明数据不一致；实施者必须用结构化断言而不是字符串键序比较。此结果仍不代表原生界面、语音与保存闭环通过。

## 执行位置与权限

mini 是唯一实现源，笔记本旧仓库不是最新源码。Pi 虽在笔记本运行，读写都通过 `ssh hb-mini@10.10.10.6` 在上述 mini 仓库完成。远程 PATH 为 `/opt/homebrew/bin:/Users/hb-mini/.local/bin:/usr/bin:/bin`。编辑用 apply_patch。需要 Xcode 验证时，从 mini 拷贝准确的原生源码到新的 `/tmp/ai-dtl-closure-*` 快照，不在笔记本旧仓库改同一分支。

不得读取、打印、复制 `.env.ai.local` 或 auth 文件；测试运行时可由现有启动器正常加载配置。不得触碰 Hermes、Feishu、9119 服务或家庭记录。不得停止现有 8791 服务；故障测试另开隔离端口和临时 store。必要时使用 `mktemp -d` 建立测试目录，不删除广泛路径。

## Task 1：复现完整断点，不先修改业务代码

**Files:**
- 读取 `apps/ipad/ScholarPad/ScholarPad/Session/ProblemCaptureModel.swift`
- 读取 `apps/ipad/ScholarPad/ScholarPad/Session/LearningWorkspaceView.swift`
- 读取 `apps/agent-host/src/ai/workspace-route.ts`
- 读取 `apps/agent-host/src/ai/qwen-workspace-session.ts`
- 新建 `tools/probe-photo-learning-closure.mjs`
- 结果写入 `Library/Application Support/ai-dtl/acceptance/photo-learning-closure`，仅公共合成输入与元数据。

- [ ] 用 `WorkspaceStore({directory: temporaryDirectory})` 和 `buildLearningTutor(loadQwenConfig(), {workspaceStore})` 开隔离 Fastify，监听 `127.0.0.1` 随机端口；不写主服务 store。
- [ ] 使用公开合成图 `docs/handoffs/evidence/2026-09-21-natural-loop/6cb4a11f-55b5-4cdc-9980-69ff19bc303e.jpg`，依次调用真实 create、原图媒体、preview、recognize、confirm、fetch 路由。

```js
const created = await app.inject({ method: 'POST', url: '/workspace/sessions', payload: {} });
const initial = created.json();
const root = `/workspace/${initial.sessionId}`;
const photo = await app.inject({ method: 'POST', url: `${root}/media`, payload: {
  eventId: randomUUID(), kind: 'problemPhoto', base64: image.toString('base64')
} });
const preview = await app.inject({ method: 'POST', url: `${root}/media`, payload: {
  eventId: randomUUID(), kind: 'preview', base64: image.toString('base64')
} });
const candidateResponse = await app.inject({ method: 'POST', url: `${root}/recognize`, payload: {
  eventId: randomUUID(), expectedRevision: 0, photoId: photo.json().mediaId,
  previewId: preview.json().mediaId,
  curriculum: { edition: '人教版', grade: 5, term: '上', currentUnit: '小数乘法' }
} });
const candidate = candidateResponse.json();
if (candidateResponse.statusCode !== 200 || candidate.problem.statement.confirmed) throw Error('candidateGate');
const confirmedResponse = await app.inject({ method: 'POST', url: `${root}/confirm`, payload: {
  eventId: randomUUID(), expectedRevision: candidate.revision,
  problemId: candidate.problem.problemId, statementRevision: candidate.problem.statement.revision
} });
const confirmed = confirmedResponse.json();
if (!confirmed.problem.statement.confirmed || confirmed.sessionId !== initial.sessionId) throw Error('confirmationGate');
```

- [x] 为每一步记录 status、耗时、同一 session/problem/photo/revision 是否保持，不打印凭据或家庭内容。
- [x] 注入媒体完成/recognize 已提交后的回执丢失，观察重试是否重复创建 session。记录服务忙碌、缺单元、断网各自可见反馈。
- [x] 只对实际复现的模型协议故障改 `qwen-workspace-session.ts`；当前模型读图探针已成功，不能凭猜测改协议。

Run：`node --env-file-if-exists=.env.ai.local --import tsx tools/probe-photo-learning-closure.mjs`。正常模式应记录候选未确认、确认后 exploring、重新读取同一记录；异常模式应证实重复或错误反馈问题。

## Task 2：缺配置时能继续，不让孩子猜

**Files:** `LearningWorkspaceView.swift`、`ProblemCaptureModel.swift`、`WorkspaceParentSettingsView.swift`、`ScholarPadUITests/PhotoLearningClosureUITests.swift`。

- [x] 新增失败 UI 测试：测试 UUID 隔离目录 + 合成新照片 + 明确空 host/unit，点识别后立即看到“连接学习主机 / 设置当前单元”的可执行入口，照片保留，不发识别请求。
- [x] 复用家长设置 sheet；让缺配置状态有直接进入按钮。不要要求孩子输入 IP，不引入整套 onboarding。
- [x] 单元必须仍是人教五上；允许家长选择/填写当前单元，不能把每道题都硬编码成小数乘法。
- [x] 配置有效才进入识别；在识别、候选确认、确认保存期间显示明确的本阶段状态。网络失败与模型不可用分别展示“照片还在 + 下一步”。
- [x] 测试模拟环境设置只作用于 UUID 测试目录，不更改家庭 UserDefaults。不要伪造候选即算识别成功。

## Task 3：照片提交重试可续接

**Files:** `ProblemCaptureModel.swift`、`WorkspaceCache.swift`、`ScholarPadTests/ProblemCaptureTests.swift`，必要时 `workspace-route.ts` 与 `workspace-route.test.ts`。

- [x] 首先写测试：媒体已上传但 recognize 回执丢失；重试和重开使用同一 sessionId/photoId/previewId/recognize eventId，候选不重复、原图未换。
- [x] 复用 `OwnQuestionRequest` 的本地待提交模式，新增 Codable 可选照片请求状态，老缓存缺字段照常读取。创建、媒体、识别的阶段状态要在继续网络步骤前持久化；持久化失败不能假装成功。
- [x] 识别返回丢失时以相同 eventId 重试现有服务端幂等接口；新拍一张照片才清除上一个待提交状态。不要改 unrelated 存储 schema 或迁移家庭数据。
- [x] 判断创建 session 回执丢失是否需要新增服务端幂等创建契约；只有故障测试证明必要才加兼容的可选 eventId/sessionId，必须保留旧客户端 `POST {}` 行为并测试事件冲突。
- [x] 错误解析只允许白名单 reason 映射中文；不要把远端任意字符串或 HTML 直接呈现。

Run：`pnpm --filter @ai-scholar/agent-host exec vitest run test/workspace-route.test.ts test/qwen-workspace-session.test.ts test/workspace-natural-loop.test.ts`。预期 0 失败；新故障测试先红后绿。

## Task 4：一个连续的新照片闭环，而非多份夹具拼接

**Files:** `ScholarPadUITests/PhotoLearningClosureUITests.swift`、`tools/probe-photo-learning-closure.mjs`；必要时扩展已有 DEBUG 隔离输入钩子。

- [x] 从空测试草稿开始，不能用 CONFIRMED_FIXTURE 跳过识别。实际 HTTP 到隔离主机：照片 → 候选 → 确认 → 画布；断言 session/problem/photo 连续。
- [ ] 在同一记录上输入笔迹，进行两轮真实模型语音，确认音频、反馈和证据落盘；暂停后重开，原照/笔迹/候选修订/反馈/同一 sessionId 保持，不自动开麦。
- [x] 新照片回路需要明确证据：不接受“单独相机测试 + 另一份五轮对话夹具”相加。如真机锁屏/网络受限，先完成隔离自动化，记录未覆盖，不谎称真人体验通过。
- [ ] 同时跑原有照片入口、中文相机、横竖屏书写、恢复、打断相关回归，不能削弱 ≥55% 画布和授权后发音边界。
- [ ] 真机开发签名 Team `YZQ2T35W5C`，UDID `00008112-000509D9268A201E`；升级安装保留应用数据。不要改签名团队或删除重装。

Codex 最终验收：读取源代码 diff、核对 mini 源码与构建快照哈希、执行相关单测/真机测试、安装最终版本。Pi 提供测试命令/退出码、真实探针摘要、修改清单与尚未覆盖项；不能把“应该通过”作为完成。

## 总体完成门槛

- [ ] 用户不需要猜拍照之后该做什么、为什么停了。
- [ ] 一张新照片通过真实识别和确认进入可以写画、说话的学习空间。
- [ ] 失败后点重试继续同一份作品，不重复建档或静默丢失。
- [ ] 暂停重开继续同一份作品，不自动开麦。
- [ ] 原图、笔迹、证据和反馈同源且可核对。
- [ ] 只有全部满足才称“闭环通过”；其他结果按已实现/已验证/待验收分别报告。

本轮不做新学科、新 Agent 平台、收费优化、Hermes 接入或模型更换。不得为完成清单扩展这些范围。
