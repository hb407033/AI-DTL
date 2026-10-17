# 可见、可操作的线段教学 Implementation Plan

**Goal:** 孩子表达→老师核对表示含义并征求同意→生成线段提示→孩子操作/圈画→隐藏后独立继续；纠正后旧提示失效。

**Architecture:** 沿用 Workspace、Swift/PencilKit 与千问 Omni。只增加一种有类型线段，不引入通用画图引擎。Mac 保存独立提示状态与同意凭据，孩子的 PKDrawing/board 不被提示写入。老师给出的表示解释是待核对候选，数据合法不等于语义正确。

**Tech Stack:** TypeScript/Zod/Fastify、SwiftUI/PencilKit、现有 Qwen realtime 文本及语音能力。

2026-09-22 18:51 最终核对：当前版本真机完整教学流程2项、提示/原稿快照4项通过；逐项目标证据见 `docs/handoffs/2026-09-22-visible-teaching-completion-audit.md`。下方早期阶段中的“尚未安装/尚待接线/自动发现与离线补偿未完成”均为历史记录；最新连接与补偿的12项真机验收见 `2026-09-22-host-discovery-revocation-results.md`。工程闭环输入为合成PCM与自动触控，不替代儿童真人教育效果。

当前分支 codex/ipad-arrival-plan，原目录串行实施，保留已有工作，不提交、不推送、不委托。用户已经批准目标，不另设平台选型或建模入口。

## 1. 契约与确定性权限（先完成）

文件：`packages/session-contracts/src/line-scaffold.ts`、`packages/session-contracts/test/line-scaffold.test.ts`、`apps/agent-host/src/learning/line-scaffold.ts`、`apps/agent-host/test/line-scaffold.test.ts`。

- [x] 先写失败测试：拒绝零/负量、无单位、非整数/过多等分、越界点选、重复点选、来源缺失。
- [x] 线段只描述整体数量和单位、等分数、孩子选择的位置；使用十进制字符串转整数比例显示，避免 0.1+0.2 漂移，不自动计算题目最终答案。
- [x] 定义 basis（problemId、题意 revision、submissionId、responseId），同意绑定 offerId/basis；拒绝过期同意、未同意生成、纠正后的延迟输出。
- [x] 提示显示、隐藏、失效是独立状态；隐藏不删除原证据，失效不能再次激活。孩子对提示的操作不改写原稿，也不标记独立掌握。
- [x] 运行 `pnpm --filter @ai-scholar/session-contracts test test/line-scaffold.test.ts` 与 `pnpm --filter @ai-scholar/agent-host test test/line-scaffold.test.ts`，逐项红绿。

2026-09-22 第一批实测：契约 13 项、宿主纯函数 6 项通过；两包 typecheck 均通过。邀请同时冻结整体数值、单位、来源原话、表示含义，生成阶段不得偷换。这里只验证独立状态规则，尚未接真实 Workspace 存档/API、模型、iPad；不能据此宣称图形教学可用或数量语义已经被自动证明。下一批直接接独立存档及真实模型邀请/同意通道，尤其须从权威记录构造 current basis，不能信任客户端或模型自报。

## 2. 宿主与真实模型接线

文件：`apps/agent-host/src/learning/workspace-store.ts`、`apps/agent-host/src/ai/workspace-route.ts`、`apps/agent-host/src/ai/workspace-voice-route.ts`，新增窄职责 scaffold route/provider 文件。

- [x] 主机在明确求助且有表示证据后提供具体邀请，不因沉默/普通表达生成邀请；原生展示、拒绝与纠正交互仍待任务3。
- [x] 同意后通过现有千问配置请求受限 JSON 线段描述；不是预制图假装模型生成。JSON 不直接执行；本地校验通过再保存，下发前再次检查 basis。
- [x] 先写集成失败测试：同意绑定、CAS/重复事件、越界输出、错误来源、删除/换题/纠正/断线后迟到结果不得出现。
- [x] 提示存同一原子 bundle 的独立字段，旧客户端普通保存不得擦掉它；保存题意/异议后原子失效。不得建立第二套学习会话。
- [x] 用合成材料做真实千问探针，检查具体数字和单位；不读取或打印凭据。探针不写家庭资料；存档/HTTP测试使用独立临时目录。

2026-09-22 第二批：新增 `workspace-scaffold-route.ts`、`qwen-line-scaffold.ts`；扩展 `workspace-store.ts` 同 bundle 的 scaffold/scaffoldReceipts，独立CAS与幂等，普通画布保存不会擦掉提示。HTTP仅允许consent/select/hide/invalidate，不接受客户端offer/generate；邀请由成功help回调创建。语音先返回正常完成，再准备可选邀请；图示失败不撤回已完成语音。模型失败或取消不显示半成品。

测试：7个后端文件38项通过，agent-host typecheck通过；契约13项通过且typecheck通过。并发同意测试曾实际失败（调用2次模型），在存档await后再次检查占用后通过。纠正期间不等模型即可invalidate，迟到结果拒绝。还需补题意修改与断线的端到端原生验证，不能把纯函数通过当成这些已完成。

真实探针 `node --env-file-if-exists=.env.ai.local --import tsx tools/probe-line-scaffold.mjs` 退出0：模型提取 `whole="1", unit="升", sourceQuote="我画的这条线表示一升果汁", meaning="这条线代表一升果汁的总量"`；脚本明确模拟同意后，模型生成 `kind="line", partitions=2`，保留所有锚点字段，精确每段1/2验证通过。此为真实上游+合成材料，不是真人同意或UI验收。

家庭宿主本轮未重启，iPad尚未改动/安装。下一步直接实现任务3；后端接口GET/POST `/workspace/:id/scaffold`，请求 `{eventId, expectedRevision, action:{type,offerId,selectedParts?}}`，响应 `{revision,items}`。WS `scaffold`事件携带同一journal，失败为`scaffoldUnavailable`。App在help完成时可读取journal，但事件晚到必须绑定当前session/problem并检查状态。仍使用千问，不换平台。

## 3. 原生交互与证据

文件：新增 `apps/ipad/ScholarPad/ScholarPad/Session/LineScaffoldModel.swift` 与 `Canvas/LineScaffoldView.swift`，接入 `LearningWorkspaceView.swift`、`WorkspaceClient.swift`，补对应 Tests。

- [x] 有邀请才显示“可以，画给我看看／先不用”；新题无常驻图形工具。等待、拒绝、生成失败不阻止自由写画。
- [x] 单独显示“老师的提示”，线段分段可点选，单位及精确比例可见；孩子操作标为对提示的探索，不混入原始 PKDrawing。
- [x] 保留 PencilKit 可继续圈画/解释；提交快照明确分区并包含提示使用状态，模型不得误认提示是孩子独立画出。
- [x] 隐藏提示后原稿仍可编辑；“你理解错了”立即撤下并取消生成，再持久失效；失败保持撤下而不是恢复旧图。
- [x] 重启不自动重新生成、不自动开麦、不复活失效提示；断网保留本地原稿。

## 4. 同一学习过程的真机验收

2026-09-22 18:20更新：真机两组自动化已通过，完整连续语音/画布/提示/隐藏/再次表达/重开闭环详见 `docs/handoffs/2026-09-22-line-voice-device-results.md`。输入为合成PCM与测试模式触控，因此覆盖真实设备工程链路，不替代儿童麦克风声学/Pencil压感体验。修复客户端主说明被授权短句覆盖；后端本已追加近期原话，此次并非宣称此前完全没有表示依据。发现并修复已报告每份数量却重复询问的问题，追加真实播报探针通过。家庭宿主改为用户级LaunchAgent，实际退出后自动恢复且healthz通过。自动发现地址、离线撤销补偿仍待完成。

2026-09-22 原生接线进展见 `docs/handoffs/2026-09-22-line-scaffold-native-results.md`。邀请/同意/选择/隐藏/撤销/重开已通过模拟器+真实千问测试；真机已构建安装，但启动被设备锁屏拒绝，不能勾选本节真机验收。文本提取已由静音触发修正为真实 input_text 消息，真实探针重新通过。离线撤销主机补偿与同轮真人/Pencil验证仍待补齐。

- [x] 以五上实际量关系为样例：一升果汁/半升，孩子说明整体；先邀请、同意、真实模型生成，再选段、圈画、口头说明（合成PCM/自动触控）。
- [x] 检查整体/单位/等分刻度准确，隐藏前后原始 PKDrawing 不被老师修改；隐藏后从体积等分继续说明价格等分，不称跨题迁移验证。
- [x] 在同一流程加入纠正，断言旧提示不可再用，延迟模型返回也不能重新显示。重启后核对原稿、提示状态与证据（纠正分支与连续语音分别使用隔离作品）。
- [x] UI 每步检查正确页面；总执行上限 600 秒，异常直接设备截图，不因空闲通知无限等待。测试目录隔离，结束恢复家庭宿主。
- [x] 留存日志、截图、合成输入清单、实际模型输出和存档断言；工程通过与真人教育效果分开记录。所有上述项有证据才完成 goal。
