# AI-DTL 第一阶段 Implementation Plan：拍照题与连续说写

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:executing-plans 逐项实施；本计划不自动授权派发子 agent。只有用户明确选择委托后才使用 superpowers:subagent-driven-development。每项先写失败测试、最小实现、相关回归，再进入下一项。

**Goal:** 孩子拍一道真实数学题，核对题意，在同一空间连续说写、主动求助和纠正，退出后能恢复原题与可编辑原稿。

**Architecture:** 扩展现有 8791 学习宿主，在同一进程注册版本隔离的 workspace 协议；复用现有 Omni、PencilKit 和音频生命周期，不拼接两个客户端连接。题目描述、教学授权与媒体传输分别有小型契约；Mac 保存权威事实，iPad 保存未同步草稿。

**Tech Stack:** Swift 6 / SwiftUI / PencilKit / AVAudioEngine；TypeScript / Fastify / ws / Zod / Vitest；现有千问 Omni；本地文件存储。

---

## 0. 执行边界与当前证据

本计划依据已确认的 `docs/superpowers/specs/2026-09-20-ai-dtl-unified-learning-space-design.md`。替代交付清单中阶段一的粗粒度任务；不展开阶段二全部图形与阶段三学习安排。

仓库 `/Users/houbin/Documents/Codex/2026-08-29/wo-yo`。以下路径相对仓库；iPad 源码根为 `apps/ipad/ScholarPad/ScholarPad`。接手时分支 `codex/ipad-arrival-plan`，工作区大量未提交成果必须保留。**不能仅从 HEAD 建 worktree，否则会漏掉现有主链路。** 本计划选择在原目录小步修改；要隔离必须先协调包含未提交成果的基线。

本次写计划已检查：

- `simple-tutor.ts`：audio commit 确认后直接 response.create，不具备主动教学授权门禁。
- `SimpleTutorView.swift`：停顿后 finish；播放队列耗尽后重启录音；快照在提交时重取。复用媒体能力，不复用“停顿即教学”的策略。
- `LearningSessionClient.swift`：现有 transport 只有字符串 send，没有二进制发送和 send 错误回传；不能直接宣称接上麦克风。
- `learning-session-store.ts`：v1 强制 fraction challengeId/packVersion，不能用伪造的分数 ID 承载照片题。
- `project.yml`：有麦克风说明，无相机说明；工程由 XcodeGen 生成。
- 前序真机证据见 `docs/handoffs/2026-09-20-fraction-learning-device-validation.md`，不是本阶段通过证据。

不换模型、不新增语音供应商、不恢复 Pi 选型讨论。不添加相册/文字导题入口。课程固定小学数学、人教版五上；当前单元由家长设置，不默认已掌握整册。

只提交当前任务精确文件需要另有相应授权；不自动提交/推送、不整仓暂存。每项可形成一个本地审阅点，不以 commit 数量算进度。

## 1. 交付顺序与停工条件

### 2026-09-21 执行状态（以测试证据为准，不把主链路通过当作全项完成）

| 任务 | 当前状态 | 尚需完成或单独验收 |
| --- | --- | --- |
| T0 | 已完成基线核实 | 环境每轮重新核实 |
| T1 | 真实云门禁已通过；缺 ASR 完成事件的恢复等待已优化 | 云端完整响应时延不等于本地 2 秒宽限，仍需观察 |
| T2 | 核心契约和授权策略已实现 | 服务端消息 schema 与 Swift 严格拒绝字段覆盖未全量对齐 |
| T3 | 本地存储、媒体、CAS、墓碑已实现并测试 | 仍是单宿主进程契约，不承诺多进程写入 |
| T4 | 原照/模型预览已分离；候选题意编辑和版本绑定已实现 | 编辑支持原生文本输入；Omni 口头修正候选、实际纸面拍摄待验收 |
| T5 | 连续语音与真机音频生命周期已通过；传输可注入，发送失败边界已补测 | 不把合成输入等同于真人回声、听感验收 |
| T6 | 正式统一入口与真实编排已接通；横屏改为双栏并新增四角书写验收 | hintUsed 事实与提示确认交互仍有缺口；最新横屏结果见执行记录 |
| T7 | 恢复后纠正、串行合并保存、退出同步、冲突双方留档和选择已实现 | 删除 UI 尚未完成；最新完整真机回归见执行记录 |
| T8 | 合成输入的完整真机闭环通过 | 真人纸面/Pencil/听感、儿童观察尚未验收，不能代填 |

此前证据详见 `docs/handoffs/2026-09-20-ai-dtl-phase-1-results.md`。本轮顺序：缩短缺 ASR 完成事件的空等 → 恢复后异议可操作 → 串行保存与退出同步 → 真机回归。未按子项核实的清单不机械批量打勾。

```text
T0 基线 → T1 真实语音门禁 → T2 v2 契约与策略
                                 ↓
T3 本地存档/API → T4 相机与题意确认 → T5 媒体和轮次控制
                                 ↓
                    T6 统一工作空间 → T7 证据教学与退出
                                 ↓
                         T8 真机五轮验收
```

T1 若失败：停止宣称/实现未经证明的自动语音授权；T2 的非语音契约与 T3/T4 的相机、草稿可继续，明确报告阻塞。禁止把“所有声音自动回答”当回退偷偷交付。

**交付点只有两个：** T4 后可真机拍照核对题意；T8 后可真机连续学习并保存。阶段二大图形库、情境图片生成、长期画像、每日推送不混入本计划。

## 2. 文件职责与兼容策略

| 文件 | 责任 |
| --- | --- |
| `packages/session-contracts/src/workspace-learning.ts`（新） | v2 题目/课程/动作/快照/消息 schema 和类型 |
| `packages/session-contracts/fixtures/workspace-learning-v2.json`（新） | TS 与 Swift 共同读的合法与拒绝样例 |
| `apps/agent-host/src/learning/teaching-policy.ts`（新） | 根据明确动作授权 response 范围，不管理 socket |
| `apps/agent-host/src/learning/workspace-store.ts`（新） | v2 快照、媒体、CAS、墓碑；不自动迁移 v1 |
| `apps/agent-host/src/ai/qwen-workspace-probe.ts`（新） | T1 门禁，不导入真实学习档案 |
| `apps/agent-host/src/ai/workspace-route.ts`（新） | 8791 的 `/tutor/workspace` 与 `/workspace/*`，v2 会话编排 |
| `apps/agent-host/src/ai/qwen-workspace-session.ts`（新） | 经过 T1 验证的 Qwen 协议适配；不决定教学权限 |
| `apps/agent-host/src/ai/learning-tutor.ts`（改） | 注册新路由；旧分数路由保留回归 |
| `apps/ipad/ScholarPad/ScholarPad/Camera/ProblemCameraView.swift`（新） | camera-only 采集、取消，不调用模型 |
| `apps/ipad/ScholarPad/ScholarPad/Session/WorkspaceModels.swift`（新） | v2 Codable 镜像与共享夹具 |
| `apps/ipad/ScholarPad/ScholarPad/Session/WorkspaceClient.swift`（新） | 一个 WebSocket 的文本/PCM 传输、轮次关联与错误 |
| `apps/ipad/ScholarPad/ScholarPad/Session/TutorAudioIO.swift`（新） | 从已验证实现提取录音/播放；策略无关 |
| `apps/ipad/ScholarPad/ScholarPad/Session/WorkspaceCache.swift`（新） | v2 原稿与未同步状态，不读写 v1 文件 |
| `apps/ipad/ScholarPad/ScholarPad/Session/LearningWorkspaceModel.swift`（新） | 相机→确认→探索状态与单一客户端生命周期 |
| `apps/ipad/ScholarPad/ScholarPad/Session/LearningWorkspaceView.swift`（新） | 统一空间及家长单元设置 |

新增文件是为隔离旧协议，不是再做第四个儿童入口/第四个服务。旧 v1 文件保持可读，调试入口仍可进入旧实验。v2 单独目录，不能删除 v1 来“解决迁移”。新旧路径共用宿主级云连接名额，最多一个孩子会话，避免两个页面同时计费。

## T0. 核实基线和测试入口

- [ ] 运行并记录工作区、分支与当前文件差异，不输出 `.env.ai.local`：

```sh
pwd
git branch --show-current
git status --short
xcode-select -p
xcrun devicectl list devices
```

- [ ] 执行现有局部基线：

```sh
pnpm --filter @ai-scholar/agent-host test test/learning-tutor.test.ts test/learning-tutor-store.test.ts test/learning-session-store.test.ts
pnpm --filter @ai-scholar/agent-host typecheck
```

- [ ] 记录既有失败，不削弱测试。确认 8791 监听者后再决定是否启动；不能杀其他服务以腾端口。
- [ ] 新建执行记录 `docs/handoffs/2026-09-20-ai-dtl-phase-1-results.md`，每任务记录 `未运行/通过/失败/阻塞`、命令、证据路径、限制，初始全部未运行。

通过：明确当前代码与环境，后续结果可归因。无产品代码改动。

## T1. 先验证真实 Omni 的“听见”和“获准讲解”可分离

**Files:** 新建 `apps/agent-host/src/ai/qwen-workspace-probe.ts`、`apps/agent-host/test/qwen-workspace-probe.test.ts`；参考现有 `qwen-capability-probe.ts` / `loadQwenConfig`。原探针不改语义。

- [ ] 先写探针结果校验的失败测试。新文件导出以下纯函数，不依赖 socket：

```ts
export type GateEvidence = {
  transcriptBeforeAnswer: boolean;
  teachingAudioBeforeAuthorization: number;
  sameConnectionTurns: number;
  correctedTurnStaysIsolated: boolean;
};
export function passesVoiceGate(e: GateEvidence): boolean {
  return e.transcriptBeforeAnswer && e.teachingAudioBeforeAuthorization === 0
    && e.sameConnectionTurns >= 5 && e.correctedTurnStaysIsolated;
}
```

```ts
import { expect, test } from "vitest";
import { passesVoiceGate } from "../src/ai/qwen-workspace-probe.js";
test("文字先到也不能掩盖未授权音频泄漏", () => {
  expect(passesVoiceGate({ transcriptBeforeAnswer: true,
    teachingAudioBeforeAuthorization: 1, sameConnectionTurns: 5,
    correctedTurnStaysIsolated: true })).toBe(false);
});
```

- [ ] 运行 `pnpm --filter @ai-scholar/agent-host test test/qwen-workspace-probe.test.ts`，先确认因缺少导出失败，再实现上面的纯函数，验证通过。
- [ ] 查当前官方 Qwen 协议和本地适配，选择实际支持的输入转写配置。**计划不预造上游转写事件名或工具强制参数。** 主函数只在命令行入口执行，测试 import 不发云请求。
- [ ] 探针输入是五段成人测试 PCM16/16kHz 单声道短句：自言自语、词义询问、邀请查看、明确求助、否认旧理解。测试音频由成人自愿录制/现有合成样例提供，不读取孩子历史录音、不另购 TTS。文件仅放忽略的 validation 临时目录。
- [ ] 同一连接逐轮 append/commit；保持教学输出关闭，等待转写完成并关联 turnId，再按明确邀请发起回答。若没有独立输入转写能力，只能另测同一 Omni 的仅工具/仅文本路由回合：所有输出隔离到内部，不能流到孩子端；它必须提供可验证的转写和结构化意图，不能用自由回答中的猜测代替。此路径未通过不进入主实现。
- [ ] 每轮记录事件类型顺序、耗时、授权前后音频计数、连接 ID 的匿名标识；不保存完整供应商事件、鉴权 URL 或真实对话。真实报错做脱敏。
- [ ] 使用下列运行入口，报告 exit 0 只表示全部门禁条件成立；任何超时/字段不支持 exit 1：

```sh
node --env-file-if-exists=.env.ai.local --import tsx apps/agent-host/src/ai/qwen-workspace-probe.ts
```

**门禁产物：** `validation/results/qwen/workspace-voice-gate.json`，包含型号、时间、脱敏事件顺序与 GateEvidence。没有音频输入不得把文本探针记为真实语音通过。两种路径均失败则记录阻塞，不换模型。

## T2. 冻结 v2 契约与教学授权

**Files:** 新建 `workspace-learning.ts`、对应 `packages/session-contracts/test/workspace-learning.test.ts`、共享 JSON 夹具；修改 `packages/session-contracts/src/index.ts` 出口；新建宿主 `teaching-policy.ts` 与 `test/teaching-policy.test.ts`。

- [ ] 先写 schema 测试：camera 无 photoId 失败；确认题意文本为空失败；curated 无 packVersion 失败；unknown 字段拒绝；revision 非整数失败。
- [ ] 用 Zod strictObject/discriminatedUnion 实现以下 wire 类型；所有 ID 限 `[A-Za-z0-9-]{1,80}`，文字 `1..4000`，题干最多 `8000`，revision 为非负整数。下列是新接口约束，不是已有代码：

```ts
export type Curriculum = {
  edition: "人教版"; grade: 5; term: "上"; currentUnit: string;
};
export type Problem = {
  problemId: string; curriculum: Curriculum;
  statement: { text: string; revision: number; confirmed: boolean };
} & ({ source: "camera"; photoId: string }
  | { source: "curated"; challengeId: string; packVersion: string });
export type TeachingAction = "express" | "clarify" | "review" | "help" | "correct" | "uncertain";
export type Evidence = {
  submissionId: string; problemId: string; problemRevision: number;
  boardRevision: number; previewId: string;
  explanation: string; // 孩子提交内容；空串表示没有解释，不由模型补写
};
export type TurnDecision = { action: TeachingAction; quote: string };
export type TurnRef = { sessionId: string; turnId: string; problemId: string };
```

- [ ] 冻结消息表，schemaVersion 恒 2。所有有状态命令带 eventId/sessionId/expectedRevision；音频帧用显式开始/结束绑定 turnId，禁止交织两轮。

| 方向/消息 | 字段/行为 |
| --- | --- |
| C→S hello | schemaVersion、可选 sessionId；仅载入本地记录，不自动建云连接 |
| C→S setProblem | Problem；camera statement.confirmed 必须 false；确认只能走下一条命令 |
| C→S confirmProblem | problemId、statementRevision；原子确认，旧候选拒绝 |
| C→S voiceStart / voiceEnd | turnId、problemId；中间仅该轮二进制 PCM；end 不自动授权教学 |
| C→S authorize | turnId、action=clarify/review/help/correct；按钮或孩子确认的意图，review/help 附 Evidence |
| C→S interrupt | turnId；停声、取消、失效迟到输出，无需等待状态 revision |
| S→C ready | 当前快照、revision；不是“麦克风已开启” |
| S→C transcript | TurnRef、text、final；未完成转写不分类 |
| S→C clarificationNeeded | TurnRef、候选意图；不把猜测当授权 |
| S→C accepted/rejected | eventId、当前 revision、重复标记或 reason |
| S→C text/audio/responseDone | TurnRef、responseId、可选 submissionId；过期 ID 不显示、不播放 |

自动语意路由仅承认 T1 验证的结果；明确短语可直接由转写匹配，其他含糊表达走孩子确认。引用中的“帮我一下”不等于本人求助；否定/转述测试不可省略。供应商/模型不生成 eventId、revision 或已保存标志。

- [ ] 新建纯策略函数及失败测试，最小实现如下：

```ts
export function teachingPermission(confirmed: boolean, action: string,
  hasEvidence: boolean): "none" | "clarification" | "review" | "hint" {
  if (action === "express" || action === "correct") return "none";
  if (action === "clarify" || action === "uncertain") return "clarification";
  if (!confirmed || !hasEvidence) return "clarification";
  if (action === "review") return "review";
  if (action === "help") return "hint";
  return "none";
}
```

```ts
test.each([
  [true, "express", true, "none"],
  [false, "help", true, "clarification"],
  [true, "review", false, "clarification"],
  [true, "help", true, "hint"],
  [true, "correct", true, "none"],
])("策略 %s/%s/%s → %s", (confirmed, action, evidence, expected) => {
  expect(teachingPermission(confirmed, action, evidence)).toBe(expected);
});
```

correct 必须另由编排器停止旧回答并标 contested；none 不是忽略纠正。hasEvidence 表示快照存在且关联正确，不声称图像内容充分；空白时仍要求老师澄清。

- [ ] 运行契约与策略套件先红后绿；共享夹具包含六类动作、照片/预置题及过期题意。Swift 镜像在 T4 读同一夹具，不手抄另一份。

```sh
pnpm --filter @ai-scholar/session-contracts test test/workspace-learning.test.ts
pnpm --filter @ai-scholar/agent-host test test/teaching-policy.test.ts
pnpm --filter @ai-scholar/session-contracts typecheck
```

## T3. 本地 v2 存档与媒体接口，先保证题目/原稿不混写

**Files:** 新建 `workspace-store.ts`、`apps/agent-host/test/workspace-store.test.ts`、`workspace-route.ts`、`test/workspace-route.test.ts`；扩展 T2 schema；修改 `learning-tutor.ts` 仅注册路由和共用连接名额。

- [ ] 先写下列接口用例。Store API 为计划新建：构造参数 `{directory:string}`，`save(record,expectedRevision)` 返回 `{ok:true,revision}` 或 `{ok:false,reason}`，`load(sessionId)` 返回 `ok/missing/corrupt`，`delete(sessionId)` 写墓碑。

```ts
// 在测试 beforeEach 用 fs.mkdtemp(path.join(os.tmpdir(), "ai-dtl-v2-")) 注入目录。
test("同一版本的两个并发写入最多一个成功", async () => {
  const store = new WorkspaceStore({ directory });
  const initial = workspaceFixture(); // 测试文件内定义：从共享合法 JSON fixture 深拷贝
  await store.save(initial, null); // null 只允许首次创建
  const nextA = { ...initial, eventId: "event-a", revision: 1 };
  const nextB = { ...initial, eventId: "event-b", revision: 1 };
  const results = await Promise.all([store.save(nextA, 0), store.save(nextB, 0)]);
  expect(results.filter(r => r.ok)).toHaveLength(1);
});
```

- [ ] 扩充夹具并实现快照字段：schemaVersion=2、sessionId/eventId/revision、problem（Problem 或 null，仅新建且尚未识别时允许 null）、phase（confirming/exploring/paused/finished）、childInkBase64、board（复用现有分数图 schema）、提交 Evidence 数组、可见反馈（responseId/turnId/summary/contested）、尚待解决的孩子问题。problem=null 时只能上传/识别/退出，不能进入 exploring。转写标明 child 来源，可纠正；不存模型隐式推理/原音频。
- [ ] 存储目录 `Application Support/ai-dtl/workspaces-v2`；照片/预览独立媒体文件，以服务端随机 ID 命名。会话内串行队列覆盖“读旧版本→CAS→写盘”全过程，再用临时文件 rename 原子替换。原子 rename 不等于并发 CAS；必须测并发、重放、旧版本、删除后迟到保存。
- [ ] 同 eventId 同内容重试返回原成功结果；同 eventId 不同内容拒绝 `eventConflict`。近期幂等回执持久化；断线不靠内存去重。所有媒体访问限定当前会话，拒绝路径穿越、跨会话引用和损坏文件覆盖。
- [ ] 实现下列局域网接口，不连接云；body 限制与原有 WS 3MiB 分开配置：

| 接口 | 行为 |
| --- | --- |
| POST `/workspace/sessions` | 生成空会话与 sessionId，201 |
| POST `/workspace/:id/media` | JSON kind=problemPhoto/preview、base64；解码后最多 2MiB，仅 PNG/JPEG，验证文件签名；返回 mediaId；413 拒绝超限 |
| GET `/workspace/:id/media/:mediaId` | 仅当前会话媒体；保留本地原图，模型图另经压缩 |
| GET `/workspace/:id` | 返回完整 v2 快照；无记录 404，损坏 409 |
| PUT `/workspace/:id` | expectedRevision＋record；成功后返回 savedRevision；409 版本冲突 |
| DELETE `/workspace/:id` | 写墓碑，等待成功才 200；写失败 500，不能假成功 |

- [ ] POST 媒体内容中客户端不能指定磁盘路径；JPEG/PNG 原图并非完整图像解码验证，Swift 必须可解码，服务端还需检查头、长度，上传异常不发送模型。媒体上传 eventId 幂等。2MiB 是本阶段产品上限，不是供应商能力声明。
- [ ] 快照的 childInkBase64 最多 6,000,000 字符；PUT JSON 上限 8MiB，限制其他数组长度，不能将旧 WS maxPayload 当成允许上传原稿。保存 body 可大于云模型图片上限，模型只收到缩小的预览。
- [ ] 执行 store/route 测试：真实临时目录＋Fastify inject，不用家庭实际数据。测试 JPEG 被当 PKDrawing 的回归由 Swift T4 拦截；宿主只把原稿当不透明数据。

```sh
pnpm --filter @ai-scholar/agent-host test test/workspace-store.test.ts test/workspace-route.test.ts test/learning-session-store.test.ts
```

## T4. 直接拍照与题意核对：第一个可演示交付点

**Files:** 新建 `Camera/ProblemCameraView.swift`、`Session/WorkspaceModels.swift`、`Session/WorkspaceCache.swift`、`ScholarPadTests/ProblemCaptureTests.swift`、`WorkspaceModelsTests.swift`、`WorkspaceCacheTests.swift`；修改 `project.yml` 权限并生成 Info.plist；扩展 `workspace-route.ts`；新建 `qwen-workspace-session.ts`。

- [ ] Swift Codable 严格对应 T2 fixture，添加测试：读 camera/curated、未知版本拒绝、PKDrawing(data:) 解码失败保留损坏原件；photo 与 drawing 文件不同路径。
- [ ] 新建 `CaptureState` 与纯 reducer，使权限/取消路径可测试：

```swift
enum CaptureState: Equatable { case idle, camera, preview, recognizing, confirming, failed }
enum CaptureEvent { case open, captured, cancel, usePhoto, recognized, rejectPermission, fail }
func captureTransition(_ state: CaptureState, _ event: CaptureEvent) -> CaptureState {
    switch (state, event) {
    case (.idle, .open): return .camera
    case (.camera, .captured): return .preview
    case (.camera, .rejectPermission): return .failed
    case (.preview, .usePhoto): return .recognizing
    case (.recognizing, .recognized): return .confirming
    case (_, .cancel): return .idle
    case (_, .fail): return .failed
    default: return state
    }
}
```

测试 `idle→camera→preview` 不产生上传副作用；只有 usePhoto 才调用注入的上传函数一次；取消不新建云会话、不覆盖现有 draft。

- [ ] 用系统 `UIImagePickerController` 的 camera source 包装 UIViewControllerRepresentable；不启用 photoLibrary。先 `isSourceTypeAvailable(.camera)`，拒绝权限显示返回/打开设置。相机 delegate 获取 originalImage 后先本地预览，重拍不自动请求模型。
- [ ] `project.yml` info.properties 增加：

```yaml
NSCameraUsageDescription: "用于拍摄你选择的数学题，确认后交给学习老师一起探索。"
```

运行 `xcodegen generate`，核对生成 Info.plist；不只改生成文件。

- [ ] 图片正规化方向、去 EXIF 后编码保存；超过本地上限则压缩或明确重拍，不能无提示裁掉条件。发模型的图独立用现有 TutorSnapshot 压缩能力并测数字可读性；原图留在本地。
- [ ] 实现 `recognizeProblem(photoId)` 宿主操作：校验照片归属，使用 T1 已核实 Omni 图像协议（按钮无音频时沿用已验证静音载体→图片→commit→确认），本轮仅题意识别。返回有 revision 的候选题干，不自动 confirmed。
- [ ] 图片识别结果只能成为候选。超时/多题/看不清显示重拍或口头指出目标；无可验证结构化输出时不从自由文字臆造可靠字段。口头修正必须产生新的候选 revision，再由孩子确认。
- [ ] 拍照页自动化可注入测试图片，但真机必须另拍一次合成纸面题，检查小数点、单位、题问未漏。成人确认前模型不得讲解或画解法。

- [ ] 此任务即创建 `Session/LearningWorkspaceView.swift` 的最小相机/核对页，并在 App 的调试入口接入，避免“模块完成但无法演示”。包含当前单元输入、原图、候选题意、确认/重拍按钮；确认后停在已确认状态，不伪造语音可用。T6 将同一页面升为正式入口并接画布，不另做一个页面。语音纠正依赖 T5/T6，本交付点仅演示确认/重拍，未支持的能力如实标注。

**交付检查：** 相机→本地预览→题意核对可以运行；原照片可回看。此时语音全流程未验收，不宣传“老师可用了”。

## T5. 提取音频 IO 与单一连接轮次控制

**Files:** 新建 `Session/TutorAudioIO.swift`、`Session/WorkspaceClient.swift`、`ScholarPadTests/WorkspaceClientTests.swift`、`TutorAudioIOTests.swift`；复用 `TutorTurnDetector.swift` 与 SimpleTutor 媒体代码；不改变旧入口行为。

- [ ] 新传输协议不再静默吞掉发送失败，明确文本/二进制和 async throws：

```swift
@MainActor protocol WorkspaceTransport: AnyObject {
    var onText: ((String) -> Void)? { get set }
    var onClose: (() -> Void)? { get set }
    func sendText(_ text: String) async throws
    func sendPCM(_ data: Data) async throws
    func close()
}
```

先写 MockTransport，数组记录发送顺序，注入第 N 帧抛错；测试发送失败保持本地未提交证据、UI 不显示已提交。

- [ ] `TutorAudioIO` 接口：`startCapture(onPCM:) throws`、`stopCapture()`、`enqueuePlayback(_:) throws`、`stopPlayback()`、`onPlaybackDrained`；具体实现从现有 SimpleTutor 提取。音频回调保持 `@Sendable`，复制 PCM 后转 MainActor；不让 AVAudioEngine callback 继承 actor 导致崩溃。
- [ ] 新增轮次状态 `disconnected/ready/listening/transcribing/awaitingIntent/responding/playing/paused`。connectionGeneration、turnId、responseId 各自校验，禁止只靠状态字符串接收迟到消息。
- [ ] 每轮 `voiceStart` 后 PCM16/16kHz/mono 分块最多 3200 bytes，总量最多 960000 bytes，然后 `voiceEnd`。太短无语音重新监听，不提交空回答。断线后不自动重播未确认上传的音频。
- [ ] 语音播放时第一阶段暂停捕获，界面显示“老师在说”；responseDone **且**播放队列耗尽再恢复监听，保留现有短尾音保护。不能收到 done 就结束 socket，也不能假称此版全双工。
- [ ] silence 只影响分段：长时间静默保留本地思考状态。产品连接寿命到期要显示已暂停、可手动继续，不能伪装为仍在线。旧 90 秒自动断开文案不直接搬入新的学习策略。
- [ ] 五次注入 fake 完整响应不要求再次 connect/start；中途 stop/background 后迟到回调不重启麦克风。

```swift
// WorkspaceClientTests 中 mock audio/transport 均不使用设备麦克风。
func testDoneDoesNotRearmBeforePlaybackDrains() async throws {
    let h = WorkspaceHarness() // 在同一测试文件定义，注入 mock transport/audio
    h.client.beginVoice()
    h.receiveResponseDone()
    XCTAssertEqual(h.audio.captureStarts, 1)
    h.audio.finishPlayback()
    XCTAssertEqual(h.audio.captureStarts, 2)
    h.client.pause()
    h.audio.finishPlayback()
    XCTAssertEqual(h.audio.captureStarts, 2)
}
```

WorkspaceHarness 的 receiveResponseDone 必须先建立当前 turn/response 并注入一段音频，不得通过直接改内部状态绕过业务行为；beginVoice/pause 是本任务新客户端公开方法。

## T6. 统一空间与真实学习宿主编排

**Files:** 新建 `Session/LearningWorkspaceModel.swift`、`ScholarPadTests/LearningWorkspaceTests.swift`、`ScholarPadUITests/LearningWorkspaceUITests.swift`；扩展 T4 创建的 `Session/LearningWorkspaceView.swift`；修改 `App/ScholarPadApp.swift`；完善 `workspace-route.ts`、`qwen-workspace-session.ts` 和对应测试。

- [ ] 主入口只显示学习空间。“拍一道题”可用；“今天探索”阶段一显示清楚的未开放状态，不跳旧分数页面冒充统一。旧三入口进入调试菜单；保留原 UI 测试可通过 launch argument 选择旧入口。
- [ ] 家长设置 `currentUnit`（非空 1..80 字），固定五上人教版；本地保存，下次新题携带课程快照。修改当前单元不改历史题的课程快照。尚未设置先进入家长设置，不替家长猜测单元。
- [ ] WorkspaceModel 唯一拥有 WorkspaceClient、相机状态、PKDrawing 与缓存；view 重建不重新连接。复用 ChildCanvasView，避免复制一个全新 PKCanvasView，测试横竖屏可书写区域。
- [ ] 非媒体命令先校验 eventId/revision/Problem，再执行副作用。review/help 冻结 Evidence，模型回答必须引用该快照；picture source 分为题目原图与孩子预览，提示词中显式区分，不能把题目图当孩子作品。
- [ ] T1 的真实适配实现统一内部事件 `transcriptFinal/decision/responseStarted/text/audio/responseDone/error`；上游事件只在适配层解析。整个 session 最多一个在途语音回合/模型响应，忙时保存本地草稿，拒绝并行生成。
- [ ] 路由以 T2 的 permission 选择响应范围：none 不请求教学回答；clarification 只问清楚/解释词义；review 复述已有证据再一步；hint 最多一小步并写 hintUsed 事实。每轮更新课程上下文，禁止凭一次题目判定掌握。
- [ ] 明确语音邀请直接走相同 authorize；转述、否定、低确定性候选显示“你是想让我看看这一步吗？”，一次确认后继续，不要求每句话确认。仅关键词出现不能自动授予 review/help。
- [ ] 服务端返回错误具体到阶段（识别、收音、模型、保存），不输出供应商密钥。断连 UI 仍保留题目和画布，提供手动继续。

**宿主测试用例（`test/workspace-route.test.ts` 增补）：**

| 输入 | 精确断言 |
| --- | --- |
| 未确认问题＋review | rejected 或 clarification，review 响应计数 0 |
| 已确认＋自言自语＋静音 | transcript 可见；response.create 教学调用 0 |
| “题目里写着帮我一下” | 不直接授权 help |
| 明确请求查看＋新画布 | 一次 response，引用相同 submissionId/boardRevision |
| 重复 eventId 同内容 | duplicate=true，不再次请求模型 |
| 模型迟到上一题 audio | 孩子端播放计数不变 |

执行相关 TS suite 后做一次实际 iPad 麦克风往返；不等到最终验收才连接真实上游。

## T7. 纠正、保存、退出：关掉“看似成功”的路径

**Files:** 修改本计划新增的 WorkspaceModel/Client/Cache/Store/route 及各自测试；原 v1 失败不通过修改测试掩盖。

- [ ] “你理解错了”总能在有反馈时触发：立即本地停播放，上游取消；feedback 标 contested，后续上下文不把它当孩子已承认事实。取消发生在 commit 前、等待确认、response.created 前后都写测试。
- [ ] 保存快照包括真实 `PKDrawing.dataRepresentation()` 与引用媒体，PKDrawing 不是 JPEG。iPad 写本地草稿成功即显示“本机已保存，等待同步”；Mac savedRevision 回执后才显示“已保存到学习主机”。
- [ ] 自动保存采用串行合并队列，避免每笔和响应各自覆盖版本。发生 409 保留本地与远端副本，不自动选新/旧覆盖；显示选择继续哪份，任何选择前不丢数据。
- [ ] 退出顺序为：停录音/播放→本地草稿→等待宿主保存（有超时）→断开。超时允许退出但提示仅本机保存；后台执行时间不足时只保证本地草稿，不假称 Mac 已保存。
- [ ] 恢复 GET 完整快照＋媒体；从照片/确认题意/未被异议的已提交解释重建上下文。不自动开麦、播历史或触发 review。不读取 v1 假 PKDrawing 并覆盖 v2。
- [ ] 删除时区分清画布与删学习记录；确认后调用 DELETE，非 2xx 保留本地并显示失败；成功才移除本地对应草稿。迟到上传不能复活墓碑。

具体恢复回归：缓存记录上次保存的 PKDrawing Data，重启 model 读取后 `drawing.dataRepresentation()` 一致；对两份图片只比较图像数据/哈希，不能拿 JPEG 去初始化 PKDrawing 并忽略错误。

## T8. 真机与真人五轮验收：第二个可演示交付点

**Files:** `ScholarPadUITests/LearningWorkspaceUITests.swift`、执行结果文档；不把 test-only 图片注入作为真实相机证据。

- [ ] 列出并核实当前设备、解锁、宿主地址、健康接口。USB 地址通过测试环境注入，缺少就明确 skip；skip 不计通过。同一设备不能并行 xcodebuild。
- [ ] 运行本阶段全部新增契约、策略、存储、路由测试，宿主 typecheck；再跑受影响的旧 suite，不能只测新入口：

```sh
pnpm --filter @ai-scholar/session-contracts test
pnpm --filter @ai-scholar/agent-host test test/qwen-workspace-probe.test.ts test/teaching-policy.test.ts test/workspace-store.test.ts test/workspace-route.test.ts test/learning-tutor.test.ts test/learning-tutor-store.test.ts test/simple-tutor.test.ts
pnpm --filter @ai-scholar/agent-host typecheck
```

- [ ] 在 `apps/ipad/ScholarPad` 运行，设备 ID 使用本次核实值；以下为本项目既有连接设备示例：

```sh
xcodegen generate
xcodebuild -project ScholarPad.xcodeproj -scheme ScholarPad -destination 'platform=iOS,id=00008112-000509D9268A201E' -destination-timeout 30 -derivedDataPath /tmp/ai-dtl-workspace-phase1 -only-testing:ScholarPadTests/ProblemCaptureTests -only-testing:ScholarPadTests/WorkspaceModelsTests -only-testing:ScholarPadTests/WorkspaceCacheTests -only-testing:ScholarPadTests/WorkspaceClientTests -only-testing:ScholarPadTests/TutorAudioIOTests -only-testing:ScholarPadTests/LearningWorkspaceTests DEVELOPMENT_TEAM=YZQ2T35W5C test
```

- [ ] UI 测试另一次串行跑，仅证明按钮、页面、状态和恢复。真实收音/扬声器听感需要成人在场，缺少则记录未验收，不虚报。
- [ ] 成人先选与设置单元一致、未使用高年级技巧的真实题；做一次权限允许/拒绝，拍照核对。可用合成示例 `每米彩带 2.4 元，买 0.3 米需要多少元？`，但仅当当前单元适合小数乘法；否则换家长当前课本题。

| 轮次/动作 | 通过标准 |
| --- | --- |
| 拍照＋确认 | 数字、单位、条件、题问一致；不播答案 |
| 1 说出初步想法 | 收音正确，不未经邀请判对错 |
| 静默写画 30 秒 | 不自动讲解，不断开，Pencil 可继续 |
| 2 询问题意 | 简短解释，不直接替孩子建模 |
| 3 “看看我的想法” | 使用当前而非开麦时的旧画布；区分题干和孩子表达 |
| 4 “你理解错了”并纠正 | 停旧音频，后续不再引用被否认的推测 |
| 5 “给一点提示”后再表达 | 一步帮助，不完整解题；无需重新点连接 |
| 保存→退出→继续 | 原图、确认题意、可编辑笔迹都恢复；麦克风关闭 |

- [ ] 另测一次空白提交：老师承认缺证据，不编造“我看到你……”；一次网络中断保留草稿，重连不重复教学。
- [ ] 报告首段回复延迟、五轮重连次数、错误次数、用量是否返回；不在没有观测时承诺毫秒延迟或成本。出现基础交互失败先修复原路径，不新增功能掩盖。
- [ ] 在结果文档分别列单测、云探针、真机 UI、成人完整交互、孩子教学观察。成人五轮通过后才邀请家长陪伴孩子；未有孩子体验不能宣称学科思维已得到培养。

## 3. 范围覆盖、自检和下一阶段

| 设计要求 | 本计划落点 |
| --- | --- |
| 直接拍照与核对 | T4，相册/文字导题不做 |
| 五上当前单元 | T2 契约、T6 设置与上下文 |
| 连续语音但主动介入 | T1 门禁、T2 策略、T5/T6 集成 |
| 画布证据而非猜测 | T2 Evidence、T6/T7、T8 空白样例 |
| 保存原稿、下次继续 | T3、T4 Cache、T7 |
| 同一空间 | T6，旧入口仅调试 |
| 可操作新图形/情境图片 | 下一阶段，不计本阶段完成项 |
| 今天探索/跨次完整衔接 | 第三阶段，不作为未实现入口假上线 |

此计划不把未知供应商能力编造成现成 API。T1 通过后将实际事件映射补进适配器测试，不改变产品原则。计划中的新类型/方法由相应任务创建；测试 harness 是同文件 mock，不是隐含外部依赖。

计划完成不代表任何任务已执行。每个任务的通过证据写入结果文档，未通过不打勾。

建议执行方式：同一工作区串行推进 T0→T1，先报告真实语音门禁；通过后继续 T2→T4，尽快交付可拍照核对版本，再接 T5→T8。若用户另行选择多 agent，必须先冻结 T2 契约，只拆相机/媒体/存储等不重叠文件，集成和真机测试仍由一个执行者串行负责。
