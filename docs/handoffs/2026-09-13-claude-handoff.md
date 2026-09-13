# AI-DTL · AI 学科心智学习系统交接给 Claude

交接日期：2026-09-13。本文用于本地接手，不代表已向外部 Claude 服务发送代码或数据。

## 1. 从哪里接手

- 仓库目录：`/Users/houbin/Documents/Codex/2026-08-29/wo-yo`
- **接手基线：`main`**。用户已授权将原 `feat/phase-0-native-ipad-gates` 快进合入 main，再完成 AI-DTL 品牌统一并推送私有仓库；品牌在 `codex/ai-dtl-branding` 上提交后快进合回，避免直接提交保护分支。
- 私有仓库：`https://github.com/hb407033/AI-DTL.git`。最新发布提交以 `git log -1 main` 与 `git ls-remote origin refs/heads/main` 的实测结果为准，不在其自身文档内写循环依赖的发布 SHA。
- 历史功能提交：`f4327c9` — 到货前验收映射、音频探针与笔迹持久化；`febd6f8` — 阶段三成长账本核心闭环与儿童权利。均已包含在此次合并基线中。
- 旧版本文的「main 落后一批」「交接文件尚未提交」已失效，不要按旧状态继续。
- 本次发布未部署服务、未修改真实家庭学习库。用户此次授权不等于后续可以自行公开仓库、改鉴权或删除工作分支。

接手先确认实际状态，不用文档替代现场检查：

```sh
cd /Users/houbin/Documents/Codex/2026-08-29/wo-yo
git status --short --branch
git log -3 --oneline
git branch -vv
```

## 2. 产品目标与不可随意改动的决策

品牌确定为 **AI-DTL / AI 学科心智学习系统 / AI-Powered System for Disciplinary Thinking and Learning**，使用用户提供的蓝绿原图。参见 `assets/brand/README.md`；现有包名、Bundle ID 和数据目录为兼容保留，不要将它们当漏改品牌而直接迁移。

面向小学五年级孩子的家庭学习系统。北极星是「孩子先独立建模，AI 根据证据逐级介入，并最终退出」，不是自动讲题或刷题工具。

- 儿童端必须是原生 **SwiftUI + PencilKit**，不是网页、React Native 或 TypeScript 平板壳。
- Mac mini 是目标宿主，保存课程、证据、作品和成长账本；开发验证目前在本机 Mac，不宣称已经部署到目标 Mac mini。
- 家庭局域网采用 HTTP/WS；不主动扩展到公网、TLS 或账号平台工程。保留已经实现的儿童/家长通道边界。
- 模型路线优先 Codex realtime；不因阻塞偷偷改用第三方模型、另一个 API 或其他鉴权。不要查找、打印或保存用户凭据。
- 原始 PKDrawing 只属于孩子，Agent 语义画布独立，Agent 不直接修改原笔迹。
- 教学内核、学科插件、交互、成长记忆分离。当前数学是固定小数乘法薄切片，不是完整课程生成器。
- 长期成长记录只能经孩子同意和门禁确认；家长不能替孩子同意、自由改写儿童版结论。
- 家长的「暂不考虑安全」不是删除儿童知情、异议、删除权或绕过已有数据一致性约束的许可。

## 3. 先读哪些文件

以下路径均相对仓库根目录，按顺序阅读：

1. `docs/superpowers/plans/2026-09-13-pre-ipad-integration.md`：最新实现、验证和明确未完成项。
2. `docs/superpowers/plans/2026-09-13-growth-ledger-acceptance-matrix.md`：206 条验收与实际断言映射。
3. `docs/handoffs/2026-09-13-ipad-arrival-checklist.md`：真机安装、隔离宿主和设备验收步骤。
4. `docs/superpowers/plans/2026-09-06-ai-scholar-phase-3-growth-ledger.md`：阶段三分批计划，已有最新进展入口。
5. 修改账本时读 `docs/superpowers/specs/2026-09-06-growth-ledger-design.md`；修改教学/插件时读 `docs/superpowers/specs/2026-08-30-ai-scholar-learning-system-design.md` 对应章节。

**旧文档警告：** `docs/handoffs/2026-09-06-ai-scholar-phase-0-handoff.md` 中「不是 Git 仓库」「尚无工程代码」是历史状态，已失效，不能据此重新建项目。分支名含 phase-0 也不表示代码只做到阶段零。

## 4. 当前做到哪一步

总体为「数学 Alpha 核心工程已实现，真实联调与完整验收尚未完成」。

### 已实现

- 通用教学状态机、分级提示预算、独立迁移、脚本/家长桥接。
- 原生单屏儿童界面、PencilKit 原笔迹与 Agent 语义层分离。
- SQLite 会话、事件幂等、快照、暂停和重启/重连恢复。
- 成长账本：门禁、孩子同意、异议后区分任务、趋势、家长审阅、删除级联和保留清理。
- 原始 PKDrawing + PNG：上传、同库 BLOB、不可变版本、幂等重试、原生缓存、恢复、家长授权预览。
- 恢复笔迹不生成新的 STROKE；用户清空产生擦除证据并保存空画布。删除后的 410 清理对应 iPad 缓存并设置墓碑，晚到响应不能复活内容。

### 不能说已完成

- 206 条只是映射完成：**96 covered、86 partial、20 missing、4 device-pending**。partial/missing 不等于已证明代码有错，但需要补断言或实现审查；不能拿总测试数量替代验收覆盖。
- Codex 双向实时语音未接通，正式儿童端没有验收通过的 Codex 音频桥接。现有系统朗读不是 Codex 音频，文字输入不是实时收音。
- 真 iPad/Pencil 延迟、录放音、家庭网络、孩子教学效果未验收。用户表示 iPad Pro 要到「明天晚上」才到；接手时确认是否已到，不把预计时间当实际到货。
- 家长预览接口经过自动化测试，但浏览器视觉还未人工验收。
- 完整课程、文学插件和每日学习安排仍是后续工作，不应插入当前收尾。

## 5. Codex 实时阻塞：明确证据

2026-09-13 本机 CLI `0.153.4` 与项目固定 schema 匹配。两次执行 `pnpm gate:codex --trials 1`，实时启动阶段均返回：

```text
realtime conversation requires API key auth
```

结果为 **BLOCKED**，未发送实际音频输入、未收到模型音频。到货不能自动解决该身份问题。只对这条本机 CLI/当前身份路径作结论，不泛化为所有 Codex 产品都不支持。

本地报告在被 Git 忽略的目录内，不随 clone 自动获得：

- `validation/results/codex/codex-2026-09-12T16-58-09-447Z.json`
- `validation/results/codex/codex-2026-09-12T17-10-05-231Z.json`

已准备的探针支持明确确认的成人/合成 WAV：单声道、24kHz PCM16、最多 30 秒，100ms 分块和尾部静音。先校验输入、身份、版本，鉴权拒绝立即停止。`--dry-run` 仅握手，不能标成语音 PASS。Mac 指标从首个输入块到首输出音频，不是 iPad 说完到播放。

接手不需要默认重复真实模型调用。只有针对具体准入变化重新验证时才运行探针，输入不得使用孩子的录音；不绕过已有 API Key 检测或 schema 门禁。

## 6. 代码入口与容易踩坑的边界

| 模块 | 入口 |
|---|---|
| 宿主与会话 | `apps/agent-host/src/server.ts`、`session-gateway.ts` |
| 成长服务和同库事务 | `packages/learning-kernel/src/growth/ledger-service.ts`、`database.ts` |
| 删除与保留计划 | `packages/learning-kernel/src/growth/deletion.ts`、`retention.ts` |
| 笔迹 HTTP / PNG 验证 | `apps/agent-host/src/drawing-routes.ts`、`png-preview.ts` |
| 原生笔迹缓存与恢复 | `apps/ipad/ScholarPad/ScholarPad/Canvas/DrawingArchive.swift`、`ChildCanvasView.swift` |
| 原生会话与画面 | `apps/ipad/ScholarPad/ScholarPad/Session/SessionClient.swift`、`ChildSessionView.swift` |
| Codex 探针 | `tools/codex-realtime-probe/src/live-probe.ts`、`realtime-trial.ts`、`audio-input.ts` |

特别注意：

1. 目前存的是**整幅会话画布**，不是每个教学 run 独立原笔迹。首次上传后归属稳定。删除同会话任一作品时，共享原画布必须进入删除预览和同一事务，避免 PNG 中残留已删内容。
2. PKDrawing 和 PNG 是 `drawing_blobs` 中的 BLOB，关联 `artifact_versions`。不要另建无法原子删除的散落文件目录。
3. iPad 离线时无法即时获知删除；重新联机后依赖 410 和本机墓碑。新请求不得绕过墓碑复活旧作品。
4. 原生异步恢复必须检查 generation/删除状态/本地未同步修改；不能用旧下载覆盖新笔迹。系统恢复与用户清空不能共用「无事件」语义。
5. 家长 JSON 导出目前是元数据和索引，不是新增 BLOB 的独立打包导出功能。
6. 不在 `growth/` 内硬编码学科名；保留 `kernel-purity` 检查。成长库与会话库同库同连接，删除失败必须整体回滚。

## 7. 最近验证结果及复跑方式

以下是上一实施轮（2026-09-13）的实际结果，本次写交接文件没有重复跑代码测试：

- `pnpm test`：57 文件、**458 项通过**。
- `pnpm typecheck`：全工作区通过。
- Swift：全部单测和两组 UI 冒烟，共 **40 项通过，0 失败，0 跳过**，其中包含 10 项新增笔迹测试。
- 真实回环 HTTP → 临时文件 SQLite → 关闭/重开宿主 → 下载字节一致。
- 独立规格与代码质量评审通过；已修复清空未保存、删除后迟到响应复活、共享画布删除遗漏、归属漂移，以及音频探针假 PASS 问题。

优先复跑相关测试，新改动影响面扩大再跑全量：

```sh
pnpm exec vitest run apps/agent-host/test/drawing-route.test.ts packages/learning-kernel/test/growth/drawing-storage.test.ts tools/codex-realtime-probe/test
pnpm test
pnpm typecheck
```

Swift 工程定义为 `apps/ipad/ScholarPad/project.yml`，生成的 xcodeproj 不入库；缺工程时在该目录运行 `xcodegen generate`。模拟器 UUID 在另一台 Mac 不可照抄，先查看当前可用设备。上一轮成功命令：

```sh
xcodebuild -project apps/ipad/ScholarPad/ScholarPad.xcodeproj -scheme ScholarPad \
  -destination 'platform=iOS Simulator,id=99771417-7810-4EAF-BCCB-51C0C6F195A0' \
  -parallel-testing-enabled NO \
  -only-testing:ScholarPadTests \
  -only-testing:ScholarPadUITests/MemoryAssentSmokeUITests \
  -only-testing:ScholarPadUITests/ChildRightsSmokeUITests test -quiet
```

结果包：`/Users/houbin/Library/Developer/Xcode/DerivedData/ScholarPad-essaebgfwesazhgzppsposuuyltg/Logs/Test/Test-ScholarPad-2026.09.13_01-16-28-+0800.xcresult`。曾有一次测试宿主启动卡住，不能把启动成功当测试通过；禁用并行后成功。不要为排障清空其他任务的模拟器或终止不属于本任务的进程。

## 8. 建议接下来怎么做

在用户继续授权的范围内推进，本文不是合并、发布或更换模型的额外授权。

1. **先补自动化证据缺口**：从矩阵中的权限逐方法/逐格、同意 nonce 与重启一致性、删除后重放和磁盘残留证明入手。先读实际断言确认缺口仍存在，再补测试或修复；不要降低验收标准凑绿色。
2. **设备未到时**：补家长控制台预览视觉验证、模拟器与临时宿主联调。保留真实设备指标为 pending。
3. **Codex 方向**：针对具体版本/接口/授权变化找证据；无变化不重复撞同一个错误。不擅自升级或切换鉴权路线。
4. **设备到后**：按到货清单完成安装、画图/清空、重开/断网、删除/新会话、Pencil 与本地录放音验收。完整 Codex 音频仍单独受准入控制。
5. 更新实施记录和矩阵。分别报告「代码实现」「本地测试」「真机验收」「外部准入」，不要合并成一个模糊完成率。

## 9. 可直接发给 Claude 的接手指令

> 请在 `/Users/houbin/Documents/Codex/2026-08-29/wo-yo` 接手 AI-DTL（AI 学科心智学习系统）。先读取 `docs/handoffs/2026-09-13-claude-handoff.md` 并核实 Git 状态与 origin。接手基线为私有仓库 `hb407033/AI-DTL` 的 main，原功能分支已并入；有新改动时从核实后的 main 建工作分支，不直接提交 main。先报告核实结果和你准备处理的第一个具体缺口；继续实施时保持 SwiftUI/PencilKit、Mac 本地 SQLite、家庭 HTTP/WS 与 Codex 优先路线，不覆盖已有改动，不擅自推送、部署或切换模型/鉴权。既有验收映射不是全项通过，Codex 实时身份准入仍 BLOCKED，iPad 真机验收待设备到位。
