# AI 学科心智学习系统阶段 0 工程交接

**交接日期：** 2026-09-06  
**工作目录：** `/Users/houbin/Documents/Codex/2026-08-29/wo-yo`  
**当前阶段：** 总体设计和阶段 0 实施计划已完成，尚未创建正式工程代码。  
**接手目标：** 先校准已漂移的 Codex 契约，再按阶段 0 计划实现并验证原生 iPad、家庭局域网和 Codex realtime 三项门禁。

## 1. 一句话产品定义

这是一个运行在家庭局域网中的 AI 学习系统：Mac mini 承载 Agent、课程编排和本地成长档案；iPad 是孩子的原生触摸、Apple Pencil、语音和可视化终端。

北极星不是“更快做对题”，而是：

> 孩子先独立建模，AI 根据证据逐级介入，并最终退出；培养数学家、文学家等独立思考者，而不是只会做题的学生。

首个完整学科切片是人教版五年级上册数学“小数乘法”，首个跨学科验证是最薄文学细读插件。

## 2. 已锁定决策，不要自行改线

1. **儿童端必须是完整原生 Swift App。** 使用 SwiftUI、PencilKit、AVAudioEngine、URLSessionWebSocketTask；不使用 PWA、WebView、Capacitor、React Native。
2. **原始笔迹与 Agent 语义对象物理分层。** `PKDrawing` 只属于孩子，Agent 不能改写；数轴、圈、高亮、箭头等由独立语义画布层显示。
3. **Mac mini 是 Agent 宿主。** 课程、证据、错题、作品和成长档案长期落在 Mac mini；iPad 只保留当前会话所需缓存。
4. **第一版只走 Codex realtime。** 不加入第三方模型或公开 Realtime API 回退；如果 Codex 路线失败，报告 `FAIL/BLOCKED`，由用户决定后续路线。
5. **阶段 0 使用家庭局域网明文连接。** iPad 到本地网关使用 `http://` 和 `ws://`；不实现 TLS、证书固定、配对或 session token；不得映射到公网。
6. **阶段 0 暂不把儿童数据安全作为门禁。** 这是范围裁决，不代表推理完全本地：发给 Codex 的语音、文字和画布语义仍会经过远端服务。
7. **普通工程依赖由实现者补齐。** 缺 package、测试库或构建工具不需要追问用户；只有数据模型、外部 API、权限边界或更换技术路线需要用户拍板。
8. **教学架构必须保持通用。** 通用内核不得写死数学条件；数学和文学差异通过学科插件契约表达。

## 3. 权威文档顺序

按以下优先级阅读，发生冲突时以前者为准：

1. `docs/superpowers/specs/2026-08-30-ai-scholar-learning-system-design.md`  
   总体产品、教学、状态机、数据契约、插件、交互和家庭部署设计。
2. `docs/superpowers/plans/2026-09-01-ai-scholar-phase-0-native-ipad-validation-gates-review-resolution.md`  
   用户对安全、HTTP/WS、pnpm 和 Codex 开关的最终裁决。
3. `docs/superpowers/plans/2026-09-01-ai-scholar-phase-0-native-ipad-validation-gates.md`  
   阶段 0 的逐任务实施计划；其中 Codex 版本基线已经漂移，必须先按本交接第 7 节修订。

仅作历史参考、不得当作当前实施要求：

- `docs/superpowers/plans/2026-09-01-ai-scholar-phase-0-native-ipad-validation-gates-review.md`：初审红线记录，其中安全/WSS 等问题已被用户裁决覆盖。
- `docs/superpowers/plans/2026-09-01-ai-scholar-phase-0-validation-gates.md`：原来的非原生验证思路，不是当前技术路线。
- `docs/superpowers/specs/2026-08-30-ai-scholar-learning-system-design-review.md`：外部评审输入，建议已被筛选后写入正式设计；不要全盘照搬。

## 4. 当前磁盘与仓库状态

截至 2026-09-06 实测：

- 当前目录**不是 Git 仓库**，没有分支和提交历史。
- 尚无 `apps/`、`packages/`、`tools/` 正式代码目录；现有成果主要是设计和实施文档。
- `work/codex-app-server-schema/` 是 2026-08-29 留下的旧快照，不能作为当前 Codex `0.153.4` 的契约证据。
- `xcodegen` 未安装。
- 不要把 `.DS_Store`、生成 schema、真实家庭结果、录音、PCM 或完整笔迹提交进仓库。

当前工具基线：

| 工具 | 2026-09-06 实测 |
|---|---|
| Codex CLI | `0.153.4` |
| `realtime_conversation` | `under development  true` |
| Node.js | `v22.22.3` |
| pnpm | `11.1.2` |
| Xcode | `26.6`，Build `17F113` |
| Swift | `6.3.3` |
| XcodeGen | 未安装 |

这些是时间点快照。接手时必须重新运行版本命令，不能直接相信表格。

## 5. 已验证的 Codex realtime 事实

2026-09-06 在本机使用 Codex CLI `0.153.4` 实测成功：

1. `codex app-server --stdio` 能启动；当前 feature 已全局开启，因此本次不需要额外传 `--enable realtime_conversation`。
2. 发送一次 `initialize`，其中包含 `capabilities.experimentalApi: true`，收到成功响应。
3. 发送 `initialized` 通知。
4. 请求 `thread/realtime/listVoices` 成功，返回 v1/v2 voice 列表；默认 v1 为 `cove`，默认 v2 为 `marin`。

最小握手：

```json
{"method":"initialize","id":1,"params":{"clientInfo":{"name":"ai_scholar_probe","title":"AI Scholar Probe","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}
{"method":"initialized","params":{}}
{"method":"thread/realtime/listVoices","id":2,"params":{}}
```

为了让启动方式不依赖用户全局配置，正式探针仍建议显式启动：

```bash
codex app-server --enable realtime_conversation --stdio
```

进程 flag 与客户端 `experimentalApi: true` 是两层能力开关，不能因为当前 feature 显示为 `true` 就省略客户端 opt-in。

## 6. 尚未验证，禁止写成“已打通”

以下均未获得端到端证据：

- `thread/realtime/start` 是否能在当前账户稳定创建音频会话；
- `thread/realtime/appendAudio` 的真实输入音频回合；
- 静音触发 transcript done 所需的实际时长；
- `thread/realtime/outputAudio/delta` 到 iPad 播放的完整链路；
- 松开说话按钮到首段音频的 P50/P95；
- 连续 20 次会话成功率和长会话稳定性；
- Codex 订阅用量归属、是否产生额外 API 用量；
- 真机 PencilKit 像素延迟、本地打断、断线恢复；
- 这套提示阶梯对目标孩子是否有效。

握手成功和能列出 voices 只证明实验接口入口可用，不能替代上述验证。

## 7. 接手后的第一个阻断任务：校准 Codex 版本漂移

阶段 0 计划仍写着 `codex-cli 0.144.1` 和 `rust-v0.144.1`，当前机器已是 `0.153.4`。在写 Codex 客户端代码前必须修订这一段。

执行：

```bash
codex --version
codex features list | rg '^realtime_conversation'
schema_dir="$(mktemp -d)"
codex app-server generate-json-schema --out "${schema_dir}/schema"
find "${schema_dir}/schema/v2" -maxdepth 1 -name 'ThreadRealtime*' -print | sort
shasum -a 256 "${schema_dir}/schema/codex_app_server_protocol.v2.schemas.json"
```

2026-09-06 新生成的 v2 聚合 schema SHA-256 为：

```text
d3eace08be5dca386bfd1f1e8df650058b4113f1e10870a284d775d75517576a
```

注意：当前生成器仍主要导出 realtime 通知文件，没有完整导出 `start`、`appendAudio` 等实验请求文件；而旧的 `work/codex-app-server-schema/` 恰好包含这些文件，因此旧目录会造成“当前 schema 很完整”的错觉。实现最小请求契约时：

1. 以接手时的本机 Codex 版本为基线；
2. 对照 OpenAI Codex 仓库中与该版本匹配的 release tag 源码；
3. 只定义本项目实际使用的最小类型；
4. 用假 app-server 单测和真实握手探针双重验证；
5. 记录 Codex 版本与 schema 哈希，版本变化即先阻断并重跑契约测试。

不要从 GitHub `main` 分支随手复制实验协议，也不要继续把 `rust-v0.144.1` 写死。

## 8. 阶段 0 要验证的架构

```text
原生 iPad App
  SwiftUI + PencilKit + AVAudioEngine
          │
          │ HTTP + ws://（家庭局域网）
          ▼
Mac mini 本地网关
  Node.js + TypeScript + Fastify
          │
          │ stdio / loopback
          ▼
Codex app-server realtime
```

固定本地端点：

- 网关监听：`0.0.0.0:8787`
- 健康检查：`GET /healthz`
- iPad WebSocket：`ws://houbin-mbp.local:8787/probe`
- iPad 不直接连接 app-server。

iPad 工程需要：

```yaml
NSLocalNetworkUsageDescription: "用于连接家中的 Mac mini 学习主机。"
NSAppTransportSecurity:
  NSAllowsLocalNetworking: true
```

不要增加全局 `NSAllowsArbitraryLoads`。

## 9. 阶段 0 三项门禁

### 9.1 教学门禁

家长先用白板扮演 Agent，针对 `2.4 × 0.3` 跑三次完整闭环：独立探索、证据判断、单级提示、孩子重建、讲回、无提示迁移。

机器不能自主替用户安排或执行真实亲子试用；实现者只准备脚本、提示卡和记录模板，等待家长实际执行。

### 9.2 原生设备门禁

| 指标 | 通过阈值 |
|---|---:|
| Pencil 触摸到下一可提交画面 | P95 ≤ 50 ms |
| 孩子开口到本地停止播放 | P95 ≤ 200 ms |
| iPad 事件到 Mac 确认 | P95 ≤ 150 ms |
| 松开说话到 iPad 首段 Agent 音频 | P50 ≤ 1500 ms，P95 ≤ 3000 ms |
| 语义画布动作在 iPad 出现 | P95 ≤ 300 ms |
| 网络恢复到 WebSocket 重新确认 | ≤ 5000 ms |

### 9.3 Codex 门禁

- 只使用 ChatGPT 登录身份；API key 身份直接 `BLOCKED`。
- 连续 20 次会话至少成功 19 次。
- 输入音频必须验证 transcript、输出音频、stop 和超时。
- 800ms 静音只是第一个候选值；按 800/1200/1600ms 各测 5 次，记录 5/5 成功的最小值。全部失败即 `BLOCKED`，不要继续堆静音补丁。
- 不可解释的用量归属保持 `BLOCKED`，不能推断为订阅已覆盖。

总判定规则：任一 `BLOCKED` 则总状态为 `BLOCKED`；否则任一 `FAIL` 则为 `FAIL`；三项全部通过才是 `PASS`。

## 10. 实施顺序

1. 重新核对当前工具、Codex feature 和 schema；修订计划的 Codex 版本基线。
2. 按计划 Task 1 初始化 Git 仓库和 `feat/phase-0-native-ipad-gates` 工作分支。
3. 安装 XcodeGen，建立 pnpm workspace 和最小 SwiftUI iPad 工程，先跑通模拟器构建。
4. TDD 实现跨端指标契约。
5. 实现 PencilKit 原始笔迹层与只读 Agent 语义层，验证 Agent 不能改写 `PKDrawing`。
6. 实现 AVAudioEngine 录音、播放和本地打断；音频实时回调不得做网络或磁盘阻塞操作。
7. 实现家庭局域网 `/healthz` 与 `/probe`，先在同一 Wi-Fi 真机验证。
8. 实现与当前 Codex 版本匹配的 app-server 探针，先验证原始音频回合，再接 Swift 中继。
9. 实现 iPad—Mac—Codex PCM 中继和统一门禁报告。
10. 由家长执行真实设备与教学试用；根据 `PASS/FAIL/BLOCKED` 停止或进入下一阶段。

不要跳过最小端到端去提前实现课程库、成长账本或完整数学插件。

## 11. 正式学习系统必须保留的设计铁律

- 孩子每个新挑战从 0 级提示开始。
- AI 每次最多提升一级提示；孩子没有新产出时禁止连续自动升级。
- 单挑战默认最多两次提示升级；完整演示后必须由孩子重建，不能直接宣布掌握。
- 做对原题不算毕业；必须完成表面不同、结构相同的无提示迁移。
- 迁移失败进入软着陆，不宣布掌握，也不把挫败归咎于孩子。
- “粗心”不得作为根因；五类根因是可反驳、可过期的候选假设，不是孩子标签。
- 只有 Mac mini 上的 `GrowthLedgerService` 能提交长期成长记录。
- 孩子必须先看到儿童版成长描述，并能选择“记下来”“不确定”或“不是这样”。
- 被孩子异议的结论必须冻结，不能用原证据重新确认。
- Codex 只提出结构化建议；提示级别、画布动作和记忆写入必须由本地规则校验。
- 文学插件接入时，不得修改通用会话编排器、证据存储和成长记忆核心。

## 12. 工程工作边界

- 当前任务允许初始化本目录为新仓库，因为阶段 0 计划已经明确该步骤；最终必须在工作分支上提交，不能在主干或环境分支提交。
- 使用 `apply_patch` 修改文件；保持中文注释和中文 commit message。
- 只实现阶段 0 计划点名的文件，不顺手扩建完整产品。
- 普通 pnpm 依赖缺失直接补齐；公网拉包失败时按本机约定改用内网 Nexus，不要求用户代做。
- 真实 iPad 签名时由用户在 Xcode 选择自己的 Development Team；不要读取、输出或代管账号凭据。
- 真实家庭结果放在被忽略目录，不提交录音、PCM、完整笔迹或家庭环境信息。
- 每个“通过”必须附真实命令、退出码和结果文件；不能以 HTTP 200、握手成功或模拟器成功替代真机门禁。
- 同一根因连续修三轮仍失败时停止，记录每轮证据，换方法、明确缩减范围或交回用户决定。

## 13. 接手 Agent 的首轮完成定义

首轮不是完成整个学习系统，而是同时满足：

1. 阶段 0 计划中的 Codex 版本和实验协议说明已按当前环境更新；
2. Git 工作分支和工程骨架建立；
3. 原生 SwiftUI App 能在指定模拟器构建；
4. pnpm workspace、测试入口和类型检查可运行；
5. 所有未验证门禁继续明确标为未验证，没有被文字包装成“已打通”。

完成首轮后，再继续 PencilKit、音频、局域网和 Codex 原始音频探针。

## 14. 进展记录（2026-09-06，接手首日）

- 仓库与分支 `feat/phase-0-native-ipad-gates` 已建立；Task 1–7 代码完成并提交，Task 6 材料就位。
- 模拟器全量自动化通过：Swift 单测 33 个、UI 冒烟 4 条（画布 2、音频 1、网络 1，网络冒烟真连本机网关）；TS 测试 23 个、类型检查通过。
- **Codex 门禁 `BLOCKED`**：`0.153.4` 在 ChatGPT 身份下拒绝 `thread/realtime/start`（`realtime conversation requires API key auth`）。按第 2 节第 4 条与第 9.3 节规则停在桥接层，未切换身份或模型。Task 8（PCM 中继）在路线裁决前不推进。
- 真机门禁未开始：本机无代码签名身份、无配对设备、无描述文件；需要用户在 Xcode 登录 Apple ID 并连接 iPad 后再装机。
- 网关运行主机为开发机 `houbin-mbp`（MacBook Pro），非 Mac mini；计划 §0 已注明。

## 15. 进展记录（2026-09-06，阶段 1 开工）

用户裁决：iPad 暂不升级、暂无 Apple Pencil，真机门禁与 Codex 路线挂起，先推进不依赖设备的功能。据此：

- 设计稿升至 v0.4（第二轮评审 R0-1～R0-5、R1、R2 全部采纳，5.0 表补齐常驻控件通配行、软/硬预算、`assisted_round`）。
- 新计划 `docs/superpowers/plans/2026-09-06-ai-scholar-phase-1-single-challenge-prototype.md` 已按 12 个任务全部实现：`packages/session-contracts`（儿童端协议）、`packages/learning-kernel`（状态机、预算、事件日志、校验器、桥接、存储、编排器）、`packages/plugin-math`（2.4 × 0.3 薄切片）、`apps/agent-host`（`:8788` 会话网关 + 家长控制台 + SQLite）。
- 验证：`pnpm test` 168 个用例通过（含 15.3 八个脚本场景），`pnpm typecheck` 通过，`pnpm session:replay` 终态 `COMPLETED`，`pnpm host` 冒烟可达。
- 仍未开始：iPad 儿童端会话界面（可先在模拟器做）、`CodexRealtimeBridge`（待路线裁决）、长期记忆写入与断线恢复（阶段 2）。

