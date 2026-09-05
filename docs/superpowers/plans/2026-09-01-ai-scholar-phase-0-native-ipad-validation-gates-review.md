# AI 学科心智学习系统工程设计评审

**评审对象：**

- `docs/superpowers/specs/2026-08-30-ai-scholar-learning-system-design.md`（v0.3）
- `docs/superpowers/plans/2026-09-01-ai-scholar-phase-0-native-ipad-validation-gates.md`
- `work/codex-app-server-schema/`（Codex CLI 0.144.1 本地 schema 快照）

**评审日期：** 2026-09-01  
**评审性质：** 工程可实施性、接口契约、实时链路、儿童数据与家庭部署红线评审  
**结论：** **初审有条件通过；本文件记录初审发现，已由后续用户裁决和修订稿取代。**

> **状态更新（2026-09-01）：** 用户决定阶段 0 暂不处理儿童数据安全、TLS、配对和令牌，家庭网关改用 HTTP/WS；pnpm 子包清单由工程计划直接补齐；Codex 增加 `--enable realtime_conversation` 与 `capabilities.experimentalApi: true`。由于实施计划已修订，下面针对原稿的行号仅用于保留初审历史，不再作为当前计划索引。当前结论见 `2026-09-01-ai-scholar-phase-0-native-ipad-validation-gates-review-resolution.md`。

为保持证据简洁，下文 `design.md` 指 `docs/superpowers/specs/2026-08-30-ai-scholar-learning-system-design.md`，`native-ipad-validation-gates.md` 指 `docs/superpowers/plans/2026-09-01-ai-scholar-phase-0-native-ipad-validation-gates.md`；所有数字均为 1-based 行号。

## 1. 总体判断

以下决定可以保留：

1. iPad 采用完整原生 `SwiftUI + PencilKit + AVAudioEngine + URLSessionWebSocketTask`；
2. 儿童原始笔迹与 Agent 语义对象物理分层，Agent 无权改写 `PKDrawing`；
3. Mac mini 作为家庭网关、课程编排和长期数据唯一宿主；
4. Codex app-server 只通过 stdio 或回环访问，平板不保存 Codex 长期凭据；
5. 先用真实设备、真实家庭网络和可量化预算过门禁，失败即停止，不偷偷切第三方模型；
6. `ScriptedReplayBridge` 与 `ParentCoachBridge` 作为无模型测试替身保留。

工程上的主要风险不是“Swift 是否能做”，而是四个边界尚未闭合：儿童数据是否允许进入目标 Codex 链路、局域网客户端如何被授权、pnpm 子包如何实际建立、Codex app-server 如何可靠结束一轮输入音频。

## 2. 阻断问题

### 阻断 1：儿童真实数据进入 Codex 前，模型侧数据保留条件没有成为门禁

**证据：**

- 设计允许把孩子确认后的转写、教学动作和根因证据送入学习流程，并明确哪些内容只在本地长期保存：`design.md:698-727`。
- 阶段 0 计划要求以 ChatGPT 登录身份运行 Codex 实时链路，但准入门禁只检查身份和用量归属：`native-ipad-validation-gates.md:688-696,815-821`。
- OpenAI 当前《Under 18 API Guidance》要求面向未成年人增加保护措施，并指出：处理未满 13 岁儿童个人数据前，应先在 API 中实现零数据保留；同时要有适龄告知、内容安全、监测和升级路径。[OpenAI 未成年人 API 指南](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance)

**判断：**

“档案只在 Mac mini 本地保存”不能证明发往 OpenAI 的输入具备零数据保留。反过来，也不能仅凭 Codex app-server schema 推断该订阅链路一定不满足要求。当前状态应是**未证实**，而不是通过或失败。

**关闭条件：**

1. 阶段 0 的 Codex 音频探针先只使用家长声音或合成测试音，不使用孩子声音、姓名、笔迹、题目照片或可识别转写；
2. 在孩子首次连接 Codex 之前，取得目标 ChatGPT/Codex 链路的数据保留、未成年人适用条件和账户能力的官方可验证依据；
3. 若目标链路不能证明满足条件，孩子只能进入 `ParentCoachBridge` / `ScriptedReplayBridge`，Codex 儿童实测保持 `BLOCKED`；
4. 将适龄 AI 告知、内容过滤、风险交互的家长升级路径写入数学 Alpha 的完成定义。

### 阻断 2：总设计要求配对和受限会话令牌，阶段 0 WSS 计划只做了服务器证书固定

**证据：**

- 总设计要求首次二维码或短时配对码授权、受限会话令牌，且儿童令牌只能访问自己的当前会话与作品：`design.md:681-686`。
- 阶段 0 的网络任务只定义了叶证书指纹、重连、`id/clientSeq` 和确认：`native-ipad-validation-gates.md:582-627`；全文没有创建、校验、过期或吊销儿童会话令牌的步骤。
- Apple 的 server-trust challenge 是让客户端验证服务器凭据，不是让服务器验证客户端身份。[Apple 手动服务器信任验证](https://developer.apple.com/documentation/foundation/performing-manual-server-trust-authentication)

**影响：**

证书固定可以阻止平板连错 Mac，但不能阻止同一家庭局域网内的其他客户端连接网关。若网关承载麦克风流、会话控制和语义动作，只有 TLS 没有客户端授权不满足设计中的权限边界。

**关闭条件：**

1. 在 Task 5 增加一次性配对码或家长二维码；
2. 配对成功后签发短时、随机、可吊销的 session token，作用域固定为 `childId + sessionId + allowedOperations`；
3. iPad 只把 token 存入 Keychain，不写日志、不进入导出报告；
4. 增加缺失 token、错误 token、过期 token、跨会话访问、重放旧 token 五类拒绝测试；
5. WSS 握手成功不等于业务鉴权成功，未鉴权连接不得收发音频和画布事件。

### 阻断 3：pnpm 工作区子包没有清单，计划中的多条安装命令会直接失败

**证据：**

- 文件树只列出根 `package.json`，未列出 `apps/gate-server/package.json`、`packages/gate-contracts/package.json`、`tools/codex-realtime-probe/package.json` 和 `tools/gate-report/package.json`：`native-ipad-validation-gates.md:33-90`。
- Task 2 在子包尚未有 `package.json` 时执行 `pnpm add --filter @ai-scholar/gate-contracts zod`：`native-ipad-validation-gates.md:281-301`。
- Task 5、7、9 同样直接按尚不存在的包名执行 `--filter`：`native-ipad-validation-gates.md:572-580,672-680,760-768`。
- 全计划只有根 `package.json` 被列为 Create 文件：`native-ipad-validation-gates.md:95-103`。

**影响：**

`pnpm --filter` 需要先匹配到已有 workspace package。当前写法不是“实现时补一下”的细节，而是会在 Task 2 第一条命令中阻断执行；TypeScript 的 exports、测试入口和项目引用也没有落地文件。

**关闭条件：**

1. 在 Task 1 或每个子任务安装依赖之前，明确创建四个子包的 `package.json` 与 `tsconfig.json`；
2. `gate-contracts` 还需创建计划中已引用但文件树缺失的 `src/index.ts`；
3. 每个包先用 `pnpm --filter <name> exec pwd` 验证能被匹配，再安装依赖；
4. 根 `pnpm test`、`pnpm typecheck` 必须在空实现阶段先跑一次，证明 workspace 脚本可达。

### 阻断 4：Codex 实验能力握手缺项，`800ms` 静音结束回合也是未经验证的行为假设

**证据：**

- Task 7 只用 `thread/realtime/appendText` 验证输出音频，没有验证输入音频完整回合：`native-ipad-validation-gates.md:688-696`。
- Task 7 要测试 `initialize/initialized`，但没有要求在 `initialize.params.capabilities` 中声明 `experimentalApi: true`：`native-ipad-validation-gates.md:682-688`。
- 本地 `InitializeParams` schema 说明 `experimentalApi` 默认是 false：`work/codex-app-server-schema/v1/InitializeParams.json:45-53`；OpenAI 当前 Codex App Server 文档也明确说明，未主动 opt-in 时服务器会拒绝实验性方法。[OpenAI Codex App Server](https://developers.openai.com/codex/app-server)
- Task 8 才首次把 iPad PCM 映射到 `thread/realtime/appendAudio`，并直接规定在 `utterance-end` 后补 800ms 静音：`native-ipad-validation-gates.md:724-742`。
- 本地 app-server schema 的 `ThreadRealtimeAppendAudioParams` 只定义音频块和 `threadId`，没有 commit/end-of-turn 方法：`work/codex-app-server-schema/v2/ThreadRealtimeAppendAudioParams.json:1-58`。
- `ThreadRealtimeStartParams` 暴露协议版本、模型、传输和输出模态，但没有公开 VAD 阈值或静音时长配置：`work/codex-app-server-schema/v2/ThreadRealtimeStartParams.json:53-113`。
- 公开 Realtime API 文档说明 server VAD 可依据静音自动切分，但那是公开 API 的产品契约，不能反向证明实验性 Codex app-server 包装层的具体 800ms 行为。[OpenAI Realtime VAD](https://developers.openai.com/api/docs/guides/realtime-vad)

**影响：**

即使 CLI feature flag 已启用，客户端握手未声明实验能力也可能在第一条 realtime 方法处被拒绝；即使握手通过，如果 app-server 的 VAD、音频格式或回合提交逻辑不同，Task 8 仍会在已经完成 Swift 音频、WSS 和中继后才发现主链路无法结束一轮，造成不必要返工。

**关闭条件：**

1. `initialize` 明确发送 `capabilities.experimentalApi: true`，假服务测试同时覆盖“缺少 opt-in 时被拒绝”；
2. 把“原始 appendAudio 回合探针”前移到 Task 7；
3. 使用家长录制的短语音在 Node 探针内直接完成至少 5 个回合，观察 transcript done、首个 outputAudio delta、回合超时和 stop；
4. 记录实际可接受的采样率、声道、PCM 编码、分块大小、静音时长及 `itemId` 语义；
5. 只有实测证明 800ms 有效，Task 8 才可保留该值；否则按实测协议修改，而不是在 iPad 端继续堆补丁；
6. app-server 升级后先重跑该探针，再运行儿童端。

## 3. 重要问题

### 重要 1：Pencil 延迟指标测到的是“下一次 display link”，不是笔迹像素已经显示

**证据：**

- 计划用 `touchesMoved.timestamp → 下一次 CADisplayLink` 作为 `.penRender`，另用 240fps 慢动作只抽查 5 次：`native-ipad-validation-gates.md:416-468`。
- 计划的通过门槛却写成“Pencil 触摸事件到下一可提交画面 P95 ≤ 50ms”：`native-ipad-validation-gates.md:23-30`。
- Apple 提供 `canvasViewDidFinishRendering`，其语义是先前绘制内容已准备显示；`PKCanvasView` 本身负责 Pencil 事件和渲染。[Apple PKCanvasViewDelegate](https://developer.apple.com/documentation/pencilkit/pkcanvasviewdelegate)

**建议：** 把 CADisplayLink 指标改名为“应用帧调度延迟”，不能冒充真实像素延迟；以 `canvasViewDidFinishRendering` 的 signpost 加 240fps 外部慢动作作为显示门禁。P95 至少采 20 次，5 次只能做烟雾抽查。避免不必要地覆写 `PKCanvasView.touchesMoved`，优先使用 PencilKit delegate/gesture recognizer 做非侵入观测。

### 重要 2：Swift 6 实时音频的线程、actor 和背压模型未定义

**证据：**

- 计划在 input tap 中算 RMS、同步停止播放并通知网络层：`native-ipad-validation-gates.md:532-542`。
- 同一批 PCM 还要重采样、封装 WSS、送到 Node，并把返回 PCM 排队给 `AVAudioPlayerNode`：`native-ipad-validation-gates.md:724-738`。
- 技术栈指定 Swift 6.3.3，但没有说明 `@MainActor`、音频实时回调、网络 actor、播放队列和指标记录之间的所有权：`native-ipad-validation-gates.md:5-9`。

**建议：** 在写代码前固定并发契约：UI/ViewModel 为 `@MainActor`；WebSocket 为单独 actor；音频 render callback 只做定长拷贝和轻量 RMS，不直接 await、发网、写盘或争用锁；使用有上限的环形缓冲区和专用串行消费者；定义溢出时丢弃策略及指标。该契约必须有压力测试，否则“本地打断快”可能以音频爆音、内存增长或数据竞争为代价。

### 重要 3：本地 VAD 的固定阈值缺少环境校准，门禁可能测得很快但实际误触发

**证据：**

- 测试与实现把阈值固定为 `0.05`、连续 3 帧：`native-ipad-validation-gates.md:484-529`。
- 没有定义每帧时长、环境噪声基线、启动/释放迟滞、最短语音时长和误触发率。
- Apple 明确指出音频路由变化通知可能来自次线程；不同麦克风、蓝牙路由和硬件采样率会改变输入条件。[Apple 音频路由变化通知](https://developer.apple.com/documentation/avfaudio/avaudiosession/routechangenotification)

**建议：** 本地打断 detector 应基于 1 秒噪声底校准，使用相对阈值、attack/release、固定毫秒而不是未定义“帧数”；报告同时记录真阳性延迟、安静环境误触发和播放回声误触发。增加 44.1/48kHz 输入、蓝牙插拔、音频中断和锁屏恢复测试，并明确用 `AVAudioConverter` 转为 24kHz PCM16。

### 重要 4：语义圆没有文档坐标、对象身份和版本，无法证明后续不会重做画布协议

**证据：**

- 总设计要求圈、拖、改，并把圈选、标签、箭头、数轴等定义为有身份的分层语义对象：`design.md:34-39,384-393`。
- 阶段 0 只定义 `center: CGPoint + radius`，overlay 禁止 hit testing，远端只能替换 circles：`native-ipad-validation-gates.md:429-460,621-623`。
- `PKCanvasView` 是 `UIScrollView`，支持内容尺寸、缩放和滚动；裸 view point 会随着 viewport 变化而错位。[Apple PKCanvasView](https://developer.apple.com/documentation/pencilkit/pkcanvasview)

**判断：** 阶段 0 不实现完整交互是合理的；问题在于它目前验证的是“能画一个圆”，没有验证正式路线最关键的坐标和所有权边界。

**建议：** 阶段 0 最少定义 `CanvasObjectV1`：`objectId`、`kind`、`owner(child/agent/source)`、`documentCoordinates`、`revision`、`zIndex`、`createdFromEventId`。明确 document space 与 PencilKit `contentOffset/zoomScale` 的转换。正式 App 再拆为孩子可交互语义层与 Agent 建议层；当前 `.allowsHitTesting(false)` 只能标记为探针限制，不能继承为正式架构。

### 重要 5：控制协议没有版本协商，Swift 与 TypeScript 契约会手工漂移

**证据：**

- 二进制音频帧有版本字节和跨语言 SHA 夹具：`native-ipad-validation-gates.md:724-730`，这部分设计正确。
- JSON 的 ack、语义动作和导出结果只以自然语言描述，没有 `protocolVersion`、capabilities 或 Swift/TS 共同 golden fixtures：`native-ipad-validation-gates.md:621-627,774-780`。

**建议：** 对所有控制消息增加 envelope：`protocolVersion`、`messageType`、`messageId`、`clientSeq`、`sessionId`、`sentAt`、payload；握手时交换 capabilities。Zod 是 Mac 端运行时校验源，Swift `Codable` 至少用同一组 JSON golden fixtures 验证；未知主版本立即拒绝，未知可选字段允许忽略。

### 重要 6：叶证书指纹固定没有轮换策略，会把换证变成重新安装 App

**证据：**

- 计划把 mkcert 叶证书 DER SHA-256 写进 Debug 配置：`native-ipad-validation-gates.md:582-598`。
- Apple 对长期手动信任的建议是固定公钥或 CA key，并允许一组 key/CA 以支持平滑轮换。[Apple 手动服务器信任验证](https://developer.apple.com/documentation/foundation/performing-manual-server-trust-authentication)

**建议：** 探针阶段可临时固定叶证书，但必须显式标注“不可进入正式 App”。正式家庭部署固定本地 CA/SPKI 或配对公钥，并允许 current/next 两把 key；证书变化必须经家长重新配对，不能加入接受全部证书的容错。

### 重要 7：儿童端“临时缓存”和内存音频没有生命周期与上限

**证据：**

- 设计与计划只说保留当前会话可恢复缓存、PCM 不落文件：`design.md:610-612`，`native-ipad-validation-gates.md:15-21,544-546`。
- 没有定义缓存目录、文件保护、崩溃后清理、TTL、登出清理、环形缓冲区上限和网络慢时的背压。

**建议：** 明确缓存数据清单和分类；会话缓存使用 iOS Data Protection，设定会话完成即删与最长 TTL；token 只进 Keychain；PCM 环形缓冲区按秒数封顶，WSS 拥塞时按明确策略丢帧并上报，不允许无界累积；任何 debug 日志不得输出 base64 PCM、完整转写或证书私钥。

### 重要 8：当前只定义“用 Development Team 安装”，不构成家庭长期运行方案

**证据：**

- 真实设备步骤只要求在 Xcode 选择家长 Development Team 安装：`native-ipad-validation-gates.md:799-813`。
- Apple 说明 provisioning profile 可能过期，过期后需要重新生成并重新签名；新团队的开发/Ad Hoc 应用还可能需要 PPQ 联网校验。[Apple provisioning profile 管理](https://developer.apple.com/help/account/provisioning-profiles/edit-download-or-delete-profiles/)、[Apple provisioning 更新](https://developer.apple.com/help/account/provisioning-profiles/provisioning-profile-updates)

**建议：** 阶段 0 用 Xcode 开发安装没有问题；进入数学 Alpha 前必须选择长期分发与更新方式，并写出证书过期、App 更新、Mac 网关协议升级、回滚和家庭设备更换流程。不要把一次成功安装当成可持续部署验收。

### 重要 9：儿童内容安全目前主要依赖模型本身，应用侧没有可验收的策略

**证据：**

- 总设计有孩子知情、异议、暂停和家长审阅，属于良好基础：`design.md:407-495`。
- 但测试策略没有覆盖不适龄输出、敏感话题、题目/图片中的提示注入、持续索取个人信息或需要家长介入的交互。
- OpenAI 未成年人指南要求适龄告知、适龄内容安全以及合理的监测、报告和升级路径。[OpenAI 未成年人 API 指南](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance)

**建议：** 数学 Alpha 前增加本地、确定性的安全策略层和测试集：禁止索取身份/联系方式；限制非学习领域的敏感话题；课程图片和文本视为不可信材料；高风险内容停止自动教学并提示联系家长；家长可查看事件摘要但不展示模型内部推理。该层不需要引入第三方模型。

## 4. 建议问题

### 建议 1：把“零代码门禁”改名为“前置门禁”

总设计仍把原生 iPad App、WSS 和 Codex 探针统称为“零代码门禁”：`design.md:808-817`，但同一设计已明确需要一次性原生验证 App：`design.md:882-884`。建议拆成“零代码教学门禁”和“原生工程门禁”，避免范围和工期误判。

### 建议 2：固定 XcodeGen 版本并决定是否提交生成工程

计划直接 `brew install xcodegen`：`native-ipad-validation-gates.md:130-139`，不同时间可能拿到不同生成器版本。建议在工具基线中锁定已验证版本；二选一：提交生成的 `.xcodeproj`，或在 CI/本机校验“重新生成后无差异”。

### 建议 3：结果文件名不要写死日期

计划把四个真实结果写死为 `2026-09-07`：`native-ipad-validation-gates.md:799-805`。建议使用 `runId = ISO8601 timestamp + device id hash + git commit`，既避免重复运行覆盖，也便于追溯代码与设备版本。

## 5. 建议的修订顺序

1. **先关闭儿童数据门禁**：明确在取得官方依据前只用家长/合成数据测 Codex。
2. **修复计划可执行性**：补齐四个 pnpm 子包清单、入口和 TypeScript 配置。
3. **前移 Codex 输入音频探针**：在 Swift 中继前证实 app-server 的音频格式、VAD、回合结束和 stop 行为。
4. **冻结最小跨端契约**：会话授权、协议版本、CanvasObjectV1、坐标系、PCM frame 与结果 schema。
5. **补实时实现约束**：Swift actor/队列/背压、AVAudioConverter、路由变化和缓存生命周期。
6. **修正测量方法**：Pencil 像素延迟、本地打断误触发、端到端首音频都使用真实设备的有效指标。
7. **再开始 Task 1 编码**。

## 6. 终审判定

| 评审项 | 判定 |
|---|---|
| 教学与通用分层 | 通过 |
| 原生 iPad 技术选型 | 通过 |
| PencilKit 与 Agent 层隔离 | 通过，但需补坐标/所有权契约 |
| Mac mini 家庭部署拓扑 | 通过，但需补客户端授权 |
| Codex app-server 路线 | 保留，实验性音频回合仍需前置验证 |
| 阶段 0 计划可直接执行 | 不通过，先关闭 4 项阻断问题 |
| 儿童真实接入 | 不通过，先关闭未成年人数据与内容安全门禁 |

这不是对方案方向的否定。相反，当前设计已具备较好的教学边界、数据权限和失败停止原则。终审要做的是把这些原则落实成工程中不可绕过的授权、协议、生命周期和测量契约。
