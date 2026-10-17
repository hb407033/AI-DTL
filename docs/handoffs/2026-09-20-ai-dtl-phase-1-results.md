# AI-DTL 第一阶段执行记录

## 2026-09-21 用户验收决定

用户明确“那这个算过，继续下一个学习模块开发”。上一验收项按用户确认通过，进入第二阶段自主等分建模。下文历史测试结果保留：不把声学注入失败改写成自动化通过，也不因该旧项继续阻挡后续开发。下一增量见 `docs/superpowers/plans/2026-09-21-ai-dtl-phase-2-child-diagrams.md`。

工作目录原址、分支 `codex/ipad-arrival-plan`；保留所有既有未提交改动，不提交/推送。

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| T0 基线 | 通过 | 相关宿主 3 文件 28 测试通过；宿主 typecheck 通过；iPad available (paired)，Xcode /Applications/Xcode.app |
| T1 语音门禁 | 内部文本隔离路径已通过 | 同一真实 Omni 连接 5 轮原生转写＋本地意图，未授权音频为 0；另测 3 轮授权音频并在真实 iPad 播放。旧独立转写/工具探针失败保留；不等于新页面连续教学已接通 |
| T2 契约策略 | 部分完成 | v2 题目/课程/证据/命令/快照 schema、共享 fixture、纯教学策略；客户端完整 WS 事件尚未实施 |
| T3 本地存档 | 基础完成 | v2 CAS、持久幂等回执、媒体隔离、墓碑、HTTP CRUD；8 项 store/route 测试后增补识别确认用例，共 9 项 |
| T4 拍照核对 | 自动化闭环通过，仍有验收项 | 真机合成题图→真实 Omni 识别→确认→PencilKit 写画→Mac 保存→重启恢复→继续写画→再次保存全部通过；真实纸面拍摄/高分辨率原照仍未验收 |
| T5 连续媒体 | 未运行 | |
| T6 统一空间 | 未运行 | |
| T7 保存纠正 | 手动保存与恢复子集通过 | Mac revision 回执后显示保存成功；409 保留本地；真实重启后笔迹可继续编辑。自动同步/冲突选择/异议反馈未实现 |
| T8 真机五轮 | 未运行 | |

基线命令：`pnpm --filter @ai-scholar/agent-host test test/learning-tutor.test.ts test/learning-tutor-store.test.ts test/learning-session-store.test.ts`；`pnpm --filter @ai-scholar/agent-host typecheck`。

本轮基线不等于新流程可用。官方协议参考：https://help.aliyun.com/zh/model-studio/client-events 与 https://help.aliyun.com/en/model-studio/realtime；字段最终以当前接口真实事件为准，不凭不同语言文档差异假定支持。

## 已有代码与验证

- 新代码：`workspace-learning.ts` 契约；`teaching-policy.ts`；`workspace-store.ts`；`workspace-route.ts`；`qwen-workspace-session.ts` 单次图片识别；`qwen-workspace-probe.ts` 失败语音门禁探针。
- Swift 新增 WorkspaceModels/Cache、ProblemCaptureModel、ProblemCameraView、LearningWorkspaceView。旧三个入口仍保留，仅增加“拍照探索（调试）”导航。尚未升为正式统一入口，不能称 T6 完成。
- 契约全量 3 文件 21 测试通过；宿主相关 8 文件 50 测试通过；宿主 tsc 通过。
- Swift 模拟器 ProblemCaptureTests 2、WorkspaceCacheTests 2、WorkspaceModelsTests 1，共 5 项通过。日志 `/tmp/ai-dtl-workspace-sim.log`。
- 相机上传、缓存先写失败测试：首次编译失败明确缺 ProblemCaptureModel/WorkspaceCache，再实现通过。原生真机编译成功，但运行时锁屏；没有把编译算作真机测试通过。
- 相机权限已写入 project.yml 并由 XcodeGen 生成 Info.plist。
- UI 入口自动化 1 项通过，日志 `/tmp/ai-dtl-workspace-ui.log`；已查看模拟器截图，入口、输入框和拍照按钮无明显重叠。这不代表真机相机验收。
- 用户解锁后重新运行真机套件，构建成功，但 App 与 UI Runner 均被设备以 `Developer App Certificate is not trusted` 拒绝启动。需在 iPad「设置 → 通用 → VPN 与设备管理」信任本次 Apple Development 证书后再测。日志 `/tmp/ai-dtl-workspace-device.log`，结果 `/tmp/ai-dtl-device-sep20/Logs/Test/Test-ScholarPad-2026.09.20_20-40-50-+0800.xcresult`。当前阻塞已不是锁屏，不重复构建解决信任问题。
- 8791 已重启为本轮代码；不改 8790 等其他宿主。

## 真实上游与完整 HTTP 路径

用 AppKit 生成合成题图（非孩子数据）`/tmp/ai-dtl-photo-fixture.jpg`，内容为彩带 2.4 元/米、0.3 米多少钱。

1. 直接调用 recognizePhoto，真实千问返回题干、数字、单位、条件、问题，没有解题答案。
2. 真实 8791 HTTP 创建会话、上传图、识别、孩子确认接口、GET 恢复全部成功。
3. 合成测试会话 `23a26b05-d621-4433-9810-27163a6c1c38`，最终 confirmed=true、revision=2。留在本机 v2 目录，未混入 Git；不是孩子的学习事实。

这证明图片识别和服务端流程，不证明摄像头拍摄或完整教学。

## T1 失败证据与接续方向

输入是 macOS 本机 say 合成的五句成人语音（表达/词义/查看/求助/纠正），经 ffmpeg 转 16kHz PCM；没有新增付费 TTS 或使用孩子录音。

- `validation/results/qwen/workspace-voice-gate.json`：手动 commit 不发送 response.create，等待输入转写超时，没有偷偷允许模型讲话。
- flat 工具格式的内部路由路径曾收到 `conversation.item.input_audio_transcription.completed`，但工具 action 返回中文“题意提问”而不是约定 enum，不能当合格结构化授权。一次尝试完成 1 轮后失败，不是五轮成功。
- 根据中文文档改为 function 嵌套定义后 provider-error；当前最后一次报告在 `workspace-voice-gate-tool.json`。该文件仅保存类型/诊断，不含密钥或音频。
- 同一思路已连续失败，停止重复参数试探。后续需针对当前型号查明输入转写触发时机/工具 schema 差异，或验证隔离的仅文本路由回合＋原生转写事件；仍只用现有 Omni，不静默切模型。当前探针结果不能证明“不支持”，只能证明尚未跑通。
- T5/T6 语音学习保持未实施/未开放；孩子端明确说明，不自动回退成所有停顿都教学。

## 仍需补齐，不能称阶段一完成

1. iPad 已解锁且证书已信任；仍需验收真实纸面拍摄/五上题目可读性、Pencil 写画，不把逻辑单测替代这些验收。
2. 拍照页当前是有限调试页：口头纠正、连续语音、完整教学、今天探索未开放。
3. 当前拍摄图片沿用 TutorSnapshot 的压缩件作为本机与 Mac 题目照片，未分离高分辨率原照和模型缩略图；需在正式发布前补齐双版本媒体。
4. 相机页识别失败重试会创建新会话，尚未持久化 in-flight 请求 ID；后端同 ID 幂等已测，但客户端断线重试去重仍需补齐。
5. 候选照片和 PKDrawing 本机缓存已分开；现已支持手动保存真实 PKDrawing 到 Mac，自动同步/保存回执丢失后的客户端幂等恢复仍需补齐。恢复当前走本机草稿，未提供丢失本机缓存后的主机档案选择器。
6. v2 记录校验与并发串行只适用于一个宿主进程；不宣传多进程文件写入安全。Swift 共享 fixture 已通过，全部异常 schema 镜像仍需扩大覆盖。
7. PUT 对题目/反馈/提交事实禁止越权更新；新 workspace WS 编排尚未实现。候选文本始终待孩子确认，不以模型描述代替已确认的题干。
8. 未提交/推送，未宣称 9 个任务完成。

## 证书信任后的真机接续

- 用户信任证书后，2026-09-20 20:47 真机运行成功：5 项逻辑单测、1 项入口 UI 测试，`TEST SUCCEEDED`。结果 `/tmp/ai-dtl-device-sep20/Logs/Test/Test-ScholarPad-2026.09.20_20-47-36-+0800.xcresult`。
- 新增真实相机取消回归；初次系统权限弹窗在点击前消失，重试后相机预览可见，但 XCTest 报远程相机界面 `kAXErrorServerNotFound`，无法定位系统取消按钮。两次失败记录保留，不记通过。未触发拍摄或云端上传。
- 因此相机页增加应用自己的“返回题目”按钮，不依赖系统相机取消控件。20:52 真机 UI 回归 2 项全部通过（入口及相机返回），`/tmp/ai-dtl-workspace-camera-fixed.log`、`/tmp/ai-dtl-device-sep20/Logs/Test/Test-ScholarPad-2026.09.20_20-52-21-+0800.xcresult`。本次返回测试开始时无照片，验证取消不生成照片或上传按钮、状态不变；已有照片/笔迹保留由前述逻辑单测覆盖，不能据此称已有草稿的真机端到端验收完成。
- 8791 `/healthz` 实测返回 `status: ok, configured: true`。

## 21:05 无人操作的真实 iPad 闭环（本轮交付）

用户明确授权模拟全部输入，无需用户点击。模拟仅发生在输入端：UITest 生成中文彩带题图，Debug 环境注入真实 capture 方法；自动化触摸输入进入真正 PKCanvasView。没有 mock 识别、HTTP、确认、存储或恢复。每次 UUID 独立目录 `ai-dtl/workspace-validation/<UUID>`，不覆盖家庭草稿；正式环境不注入图片、不开放手指替代 Pencil。

实际完成顺序：预览题图（尚无候选）→点击使用照片→USB HTTP 到 8791→真实千问读题→断言 2.4/0.3/米/元且没有给出 0.72→确认题意→画第一笔→保存到 Mac→终止 App→不注入照片重新启动→原题和第一笔恢复→补画第二笔→再次保存。

- 失败先行：`/tmp/ai-dtl-workspace-e2e-red.log` 因尚无输入注入失败；`/tmp/ai-dtl-workspace-save-red.log` 因尚无 save 接口编译失败。
- 初次集成暴露测试定位错误：PencilKit 在 AX 中是 ScrollView，不是 Other。确认服务端已经是 revision=2、confirmed=true 后修正测试查询，没有修改实际确认逻辑或削弱断言。
- 新增 `saveToHost` 及成功回执核验；网络/409 不提升本地 revision，原稿保留；保存过程中新增笔迹不假称已同步。
- 真机最终 6 项逻辑单测、1 项完整 UI 链路通过，`TEST SUCCEEDED`：`/tmp/ai-dtl-workspace-e2e-final.log`；结果 `/tmp/ai-dtl-device-sep20/Logs/Test/Test-ScholarPad-2026.09.20_21-04-40-+0800.xcresult`。
- 服务端相关 4 文件 27 测试通过：workspace-route/store、learning-tutor/store。`git diff --check` 通过。
- 另行 GET 验证首个成功合成会话 `7beaeb6f-a2bc-4979-b0cb-c39d17f13828`：revision=4、confirmed=true、笔迹 3213 字节、照片 GET 200 / 42911 字节、feedback=0。未伪造教学反馈，也未播放答案。
- 最终竖屏运行的合成会话 `2c7870bf-9a6c-407f-8bb8-b865254c0917` 再次 GET：revision=4、confirmed=true、笔迹 2396 字节、feedback=0。最后仅补充保存说明文案，重新构建成功，日志 `/tmp/ai-dtl-workspace-delivery-build.log`；流程测试证据对应文案调整前的同逻辑版本。
- 已查看竖屏恢复截图：`/tmp/ai-dtl-workspace-e2e-final-attachments/4FDC70C0-752A-41F3-B505-BBD97ED97C26.png`，两笔均可见。横屏切换后笔迹数量仍为 2，但横屏截图出现黑色留白/裁切；因此只认可旋转不丢数据，不认可横屏视觉验收通过。设备系统 iPadOS 27.0 / 24A435；尚未归因于系统或应用。

复现入口（先核实 USB IP；命令会产生一次真实识别调用）：

```sh
cd apps/ipad/ScholarPad
TEST_RUNNER_AI_DTL_TEST_HOST=169.254.187.130 xcodebuild -project ScholarPad.xcodeproj -scheme ScholarPad -destination 'platform=iOS,id=00008112-000509D9268A201E' -destination-timeout 15 -derivedDataPath /tmp/ai-dtl-device-sep20 -only-testing:ScholarPadTests/ProblemCaptureTests -only-testing:ScholarPadTests/WorkspaceCacheTests -only-testing:ScholarPadTests/WorkspaceModelsTests -only-testing:ScholarPadUITests/LearningWorkspaceUITests/testSyntheticPhotoRealRecognitionDrawingSaveAndRelaunch DEVELOPMENT_TEAM=YZQ2T35W5C test
```

这个结果是“题图核对与可编辑原稿保存恢复”完整闭环，不是连续语音教学通过。当时 T1 尚未通过，后续修复证据见下一节。真人 Pencil 触感、真实纸面拍摄、儿童教学效果都不由模拟测试替代。

## 21:34 合成语音 → 真实 Omni → 真实 iPad 播放（无需用户操作）

### 原因与修复

此前使用整段 PCM 突发上传、没有尾部静音，同时把原生转写与模型工具分类耦合。不能从工具参数异常或等待超时推出整个实时语音不可用。

逐步证据：仅文本隔离回合能收到原生 ASR delta，但完成事件不稳定；追加 800ms 静音后通过前三轮；与现有 TutorTurnDetector 的分段规则对齐，按每 100ms 一帧发送，并保留 1.2s 尾部静音后，五轮全部收到匹配输入 itemId 的原生 completed 事件。模型内部文本输出不展示、不播放；本地 `explicitVoiceAction` 从已完成的原生转写产生意图，不依赖模型自由生成英文枚举。

官方协议核对：https://help.aliyun.com/zh/model-studio/realtime 与 https://help.aliyun.com/zh/model-studio/client-events 。这些文档支持手动 commit/response.create 和 text-only 配置；完成事件的具体稳定性结论来自本次实际测试，不是文档保证。

### 已通过的测试与边界

- `workspace-voice-gate-text.json`：单条真实云连接 5 轮，动作依次 uncertain/uncertain/review/help/correct；未授权音频计数 0。表达、词义询问不靠关键词自动变成查看/求助。
- `workspace-voice-gate-text-audio.json`：同一条连接 5 轮输入，其中 3 轮明确授权后返回真实非静音 PCM；无证据时要求澄清，不模拟已看到孩子画布。协议探针为授权回合重送本轮音频，不宣称零重传或成本最优。
- 三段输出分别 88320 / 203520 / 1040640 字节（24kHz PCM16 mono，约 1.84 / 4.24 / 21.68 秒）。第三段偏长，尚未完成内容/教学质量验收，不把声音返回等同于提示恰当。
- 新增/回归 TS 2 文件 22 测试通过，宿主 typecheck 与 diff 检查通过。新增过滤测试覆盖内部路由音频、过期 responseId、空 ID 不得被授权播放。
- 真机 `TutorAudioTests.testGeneratedOmniRepliesPlayOnDeviceAcrossThreeTurns` 通过：从临时 USB HTTP 服务读取上述真实模型 PCM，经现有真实 AVAudioEngine 分块排队播放；等待真实 dataPlayedBack 回调后才 ready；stop 后迟到 done 不恢复 ready。没有 mock audioPlayback，没有要求用户说话/点击。
- 真机测试日志 `/tmp/ai-dtl-omni-real-audio-device.log`，结果 `/tmp/ai-dtl-device-sep20/Logs/Test/Test-ScholarPad-2026.09.20_21-34-07-+0800.xcresult`。播放测试中的 connected 标志为测试初始化；这不是 iPad 新 workspace WebSocket 已接通的证明。真实云连接连续性由前一项探针单独验证。
- AVAudioSession 激活出现系统主线程风险 warning，没有失败；后续提取 AudioIO 时处理。不把系统播放回调当作真人听感/回声消除验收。

复现真实云端测试（原始五段输入由 macOS say Tingting 合成，16kHz PCM，文件在 /tmp；勿换孩子录音）：

```sh
node --env-file-if-exists=.env.ai.local --import tsx apps/agent-host/src/ai/qwen-workspace-probe.ts --text-routing --audio-replies /tmp/ai-dtl-gate-express.pcm /tmp/ai-dtl-gate-clarify.pcm /tmp/ai-dtl-gate-review.pcm /tmp/ai-dtl-gate-help.pcm /tmp/ai-dtl-gate-correct.pcm
```

临时音频服务仅限三个合成回复文件，绑定本次 USB 地址，测试后关闭。无凭据写进日志。媒体和 JSON 报告在忽略目录 `validation/results/qwen/`，短音频试听件 `workspace-reply-2.wav`。

下一步已经不需要重跑供应商选型：把已验证的文本隔离转写/本地授权时序移入正式 workspace adapter，按 T5/T6 接新页面音频生命周期与协议；保留 itemId/responseId 对齐、静默不教学、迟到丢弃。真实取消中的输出隔离、完整五轮画布教学和新页面麦克风链路仍要单独验收。

## 2026-09-21 连续推进 T5–T8：正式工作空间接线

本节替代上文“workspace WS 未实现、连续语音未开放”的旧状态，不抹去历史失败。当前仍在 `codex/ipad-arrival-plan` 原工作区，未提交/推送。USB 地址本次实测 `169.254.170.173`，不能沿用前一天地址。

### 本轮实现

- `workspace-voice-provider.ts`：正式单连接 Omni 适配器。按 100ms/3200 字节节奏提交 PCM 和 1.2s 尾静音；原生 ASR 按 itemId 关联，允许结果先于 commit 回执到达；内部文本隔离，教学音频按 responseId 过滤。只有转写的连接中断/超时可重试一次，教学不重放。错误日志只含事件类型、本地错误码和关联布尔值，不含音频、凭据或题目。
- `workspace-voice-route.ts`：同一 8791 进程的 `/tutor/workspace`。与识别、旧分数会话共用一个云连接名额；hello 只载入本地记录，不开云/麦克风。表达不教学，明确授权后冻结证据；先保存 pending feedback，再生成；纠正立即取消，不被串行长响应阻塞，记录 contested，后续上下文排除异议反馈。
- `TutorAudioIO.swift` / `WorkspaceClient.swift`：从现有媒体实现提取真实 AVAudioEngine 录音和播放。一个工作空间 socket，多轮连续输入；播放队列实际耗尽且收到 done 后才重开麦；暂停、后台、断线使 generation 失效；迟到音频不播放、不复活录音。
- `LearningWorkspaceView` 成为默认入口。旧实验页保留 `--legacy-experiments` / `--fresh-session` 调试入口。画布、题意、当前转写、老师声音与异议在同一页面；恢复后不开麦。未知表达不自动求助，题意澄清需要按钮明确确认。
- `ProblemCaptureModel`：当前题意和当前笔迹一同组成不可变证据预览；boardRevision 本机递增并保存，服务器回执不覆盖新笔迹。离线先存本机，暂停/退出后同步；保存 pending event 持久化，回执丢失后重启仍重放同一 eventId/正文，409 保留草稿不强行覆盖。

### 实际失败与修正

1. 首轮真实云回答把画布的交叉线当成几何题，偏离彩带小数乘法。不能称教学验收通过。已把已确认题干加入冻结证据图，强化题目为唯一主题、看不出笔迹含义先询问而非转学科。复测回答回到“每米”“2.4/0.3 的含义”和一步提示，没有给出最终数值答案。
2. UITest 的 `app.swipeUp()` 落在允许手指绘画的调试画布上，导致多一笔；改为页面外缘滚动，没有降低笔迹数量断言。
3. 后续一轮 `/tmp/ai-dtl-workspace-five-turn-device-final.log` 第一轮转写失败。该轮总体 `TEST FAILED`，即使麦克风三次启停通过也不能说整轮通过。当时错误码过于笼统，无法从该日志确定供应商超时或本地版本冲突；已补安全错误码与事件级诊断，以及仅转写的有界重试，不虚构根因已被证明。
4. 保存回执丢失后生成新 eventId 的缺陷由 `/tmp/ai-dtl-workspace-receipt-red.log` 实际复现；pending save 已持久化，最终回归继续核验。

### 已确认的整段真机结果（00:42 版本）

- `/tmp/ai-dtl-workspace-five-turn-device-v2.log` 与 `/tmp/ai-dtl-device-sep20/Logs/Test/Test-ScholarPad-2026.09.21_00-42-46-+0800.xcresult`：`TEST SUCCEEDED`。合成题图→真实千问识别→确认→PencilKit 一笔→五轮合成语音经正式 workspace WS→真实 Omni 回答/真实 iPad 播放→两次画布证据→口头纠正→保存→杀 App→恢复原题原稿→补第二笔→再次保存。
- 只模拟题图、语音输入与手指手势；网络、模型、录音输出设备、PencilKit 数据、HTTP/WS、Mac 存储都未 mock。Debug UUID 隔离草稿，不覆盖家庭数据。
- 合成会话 `aee297b0-e5b6-48ec-b93c-4d1c1915b3cf` GET 验证 revision=14、submissions=2、feedback=3、最后一条 contested=true、原稿 2396 字节。回复示例：“每米表示买一米彩带需要付的钱数。”、“你画的图里，2.4和0.3各代表什么？”；这是样本验收，不是所有题目教学效果保证。
- 截图已导出并人工查看 `/tmp/ai-dtl-workspace-five-turn-v2-attachments/747BEA0F-1A2B-41AC-80ED-0790405C3332.png`；异议状态、保存状态、原稿均可见。横屏截图仍有留白/裁切，不能宣称横屏视觉已验收。
- 服务端相关八文件 45 测试通过，随后又新增打断中的迟到音频隔离和转写重试测试；最终总数以后续记录为准。typecheck、diff check 通过。模拟器 8 测试中 7 通过、真实麦克风测试 1 项明确跳过；实际真机三次录音启停另已通过。

### 尚不能混同为完成的内容

真实纸面按快门、真人 Pencil 触感和真实人声回声/听感仍非本次合成输入验收；横屏视觉、原始高分辨率照片分离、识别请求丢回执的持久化重试、清空本机缓存后的 Mac 档案选择器也尚未交付。自由语言意图仍保守，不把所有疑问自动视作求助。此阶段不包括长期画像、每日推送、全学科和大图形库。

最终代码的真机回归正在 `/tmp/ai-dtl-workspace-five-turn-device-recovery.log` 运行；不得仅因上述旧版本曾通过而把最新代码标为完成。

### 00:51 故障恢复验证与证据图复核

- `workspace-five-turn-device-recovery.log` 整段通过（10 个真机单测＋1 个 UI 闭环），含真实麦克风三次启停和回执丢失后重启重放相同保存事件。对应结果 `Test-ScholarPad-2026.09.21_00-49-13-+0800.xcresult`。
- 本轮实际捕获 `providerTimeout`：存在 commit 和 response.done，但没有对应原生 ASR completed。限定重试恢复，未重播教学。这个证据首次明确证明至少一次失败是原生转写完成事件缺失，不把所有旧失败都归为同一原因。重试可能带来约 30 秒额外等待，延迟体验尚需优化。
- 合成会话 `aa454a95-8c3a-4306-9153-d062b01568e5` GET revision=14、两次 evidence 的 boardRevision=1，恢复补画后 board.revision=2，原稿 2396 字节。
- **不能据这个 UI 测试通过就宣布画布理解通过**：逐条看模型回复，出现“你还没画呢”。直接打开对应媒体 `.../aa454a95-8c3a-4306-9153-d062b01568e5-media/732a8b28-fc7b-479e-8a31-6a5365ffe7ca`，发现题干正常但笔迹区域全白。不是单纯模型幻觉，而是深色模式下 PencilKit 自动调整墨色，导出到白底导致白笔消失。
- 提取 `TutorSnapshot.workspaceImage` 并添加像素测试。在 `.dark` trait 下，修复前笔迹区暗像素为 0，测试实际失败：`/tmp/ai-dtl-workspace-ink-red.log`。在 `.light` trait 内生成 PencilKit 位图后，测试通过：`/tmp/ai-dtl-workspace-ink-green.log`。不修改原始 drawing，只修复证据的呈现。
- 最新版本整段回归转至 `/tmp/ai-dtl-workspace-visible-ink-device.log`；尚需完成后补写最终结果并人工查看服务器存下的证据图。

### 00:56 最终交付结果：可见笔迹＋真实五轮闭环通过

最终代码 `/tmp/ai-dtl-workspace-visible-ink-device.log`：**TEST SUCCEEDED，12 项真机单测＋1 项完整 UI 流程，全部通过，无跳过**。结果包 `/tmp/ai-dtl-device-sep20/Logs/Test/Test-ScholarPad-2026.09.21_00-54-39-+0800.xcresult`。后端相关 8 文件 47 项测试通过，typecheck、`git diff --check` 通过。

实际闭环：合成照片预览→真实千问核对→孩子确认→PencilKit 一笔→同一工作空间连续五轮输入→澄清/查看/一步求助三次真实语音输出→口头纠正→暂停保存→终止 App→恢复且不开麦→第二笔→再次保存。测试不要求用户点击。最终内容样本：

- 澄清：“每米就是量出1米长的彩带需要多少钱。”
- 查看：“你画了一条线，这条线代表多少米的彩带呢？”
- 求助：“你画的这条线，可以把它看成是1米吗？”
- 纠正后，最后一条 feedback 标记 contested，不作为后续教学事实。

Mac GET 实测合成会话 `fba02243-397a-49a4-bf86-ff94ee1c9843`：revision=14、submissions=2、feedback=3、contested=1、boardRevision=2、原稿 2396 字节。已直接查看媒体 `.../fba02243-397a-49a4-bf86-ff94ee1c9843-media/cd99a3a6-484d-4c13-a3e2-8bfd86a86e53`，确认题干和实际黑色笔迹同时存在；不是用上传成功替代可见性验收。截图 `/tmp/ai-dtl-workspace-visible-ink-attachments/1B755298-8683-4F25-99DB-43977BD86D1F.png`，恢复图 `F78CC9D9-5EDB-4B34-BACB-D25A2A51B6B2.png`。

最终 App 已由 Xcode 安装，并使用 devicectl 无测试注入重新启动 `com.houbin.aischolar.pad`，回到正常默认学习入口；没有自动开启麦克风。测试专用 USB 52991 服务已关闭，8791 学习宿主保留，healthz 返回 ok/configured=true。未提交、未推送，家庭草稿未替换。

交付范围：**至少一条“题图—说写—按证据求助—纠正—恢复”的正式链路已真机跑通**；不是所有阶段、所有语句和真实儿童学习效果全部完成。仍保留前述横屏视觉、真实纸面/Pencil/听感、高分辨率原照、识别回执重试与档案选择器限制；原生转写偶发缺完成事件由一次有界重试覆盖，但可能额外等约30秒，流畅度仍需优化。后续应在这个可运行入口上改进，不另开供应商/Agent 平台选型。

## 2026-09-21 下午：核对计划并继续收尾 T5/T7

不是全阶段完成：计划顶部已补 T0–T8 逐项状态表，明确区分已通过的主链路与未实现的子项。继续使用原分支、原工作区和千问 Omni；未提交或推送。USB 地址本轮重新核实为 `169.254.171.147`，旧地址不再适用。

### 本轮代码及复现证据

1. **转写恢复时延**：内部 response.done 已到而 ASR completed 缺失时，仅给迟到 ASR 2 秒宽限，随后走原有一次有界转写重试；不再空等通用 30 秒。保留 ASR-before-commit 关联，绝不拿 delta 当完成，也不重放教学。新增测试先以 5 秒 abort 复现失败，修复后含 30ms 迟到 completed 的重试通过。2 秒是局部宽限，不是全轮响应 SLA。
2. **恢复后纠正**：无需重新开麦，从存档最后一条反馈取得 turnId，经 hello 获取权威版本后标记 contested；反馈已改变则要求先核对，不纠正错对象。增加可注入 WorkspaceTransport，同时验证 PCM 第二帧发送失败不会发 voiceEnd 或宣称成功。原生 3 项边界测试由缺接口红测到通过；服务端测试覆盖冷连接纠正，不调用模型回复。
3. **串行合并保存**：旧实现在保存中再次保存直接返回，丢掉同步新笔迹的机会。新增测试实际得到一次写入、旧原稿、过早返回；改为共享保存任务，旧回执到达后补发最新原稿，CAS 逐次递增，同步调用者等到任务完成。额外合并窗口有界；断线/409 保留 pending event 和本机草稿，不无限重试、不覆盖冲突。
4. **退出同步顺序**：先停本机音频，再立即取消云生成；服务端串行队列结束并读取最新记录后才发送 interrupted 回执。客户端收到权威版本后保存，最后关 socket，避免与未结束教学的写入争版本。服务端延迟取消测试先复现过早 ACK，再通过；收不到回执则明确保留本机草稿，不假称 Mac 保存成功。暂停、后台和离开页面共用此路径。

### 验证记录

- 后端相关 8 文件 **48 测试通过**，session-contracts **21 测试通过**；agent-host typecheck 通过。
- `/tmp/ai-dtl-save-client-green.log`：保存合并、传输边界、缓存相关模拟器测试通过。
- `/tmp/ai-dtl-t7-boundaries-device.log`：**15 项真机单测通过**，但 UI Runner 在开启 automation mode 时超时，整次 xcodebuild 为失败，不能算五轮闭环通过。不是应用业务断言失败。
- 重试 `/tmp/ai-dtl-t7-boundaries-retry.log` **TEST SUCCEEDED**：4 项原生客户端测试（包括生成中退出的停止回执/revision 验证）和 1 项完整 UI 流程通过，UI 流程耗时 86 秒。结果包 `/tmp/ai-dtl-device-sep20/Logs/Test/Test-ScholarPad-2026.09.21_14-12-07-+0800.xcresult`。Xcode 的附加设备诊断收集仍有警告，但所有选定测试通过，命令退出码 0；不能把该警告隐去，也不将它说成业务测试失败。
- Mac HTTP GET 确认本轮合成会话 `8c826383-ded8-4419-bd05-ff8c318e7423`：revision=14、submissions=2、feedback=3、最后一条 contested=true、boardRevision=2、原稿 2396 字节。真实回复围绕彩带题和画出的线，没有转题或直接给最终数值。
- 已导出并查看 `/tmp/ai-dtl-t7-boundaries-attachments/500C72AC-DDBE-40AA-B70D-1758D69EF183.png`，可见黑色笔迹、Mac 保存状态与异议状态。题图/音频输入合成，模型、网络、设备播放和持久化真实；仍不冒充真人听感验收。
- 最新版本由 Xcode 安装；测试专用 52991 fixture 服务已关闭，8791 学习宿主保留。正常启动不带合成输入，不自动开麦。

尚欠：横屏视觉、高分辨率原照与模型缩略图分离、口头修正候选题意、识别丢回执重放、服务端消息契约严格对齐、hintUsed 事实、冲突选择与删除 UI、Mac 档案选择，以及真人纸面/Pencil/听感和儿童学习观察。不能机械勾完 T2–T8。

## 2026-09-21 继续关闭原图、题意编辑、横屏和冲突缺口

本节更新上一节的待办，不把用户要求继续验证变成再次列清单后停止。

- 原照与模型预览分离：`TutorSnapshot.originalPhoto` 保持像素尺寸、正规化方向、去除元数据；JPEG 质量压缩后仍超过阶段一 2MiB 上限时明确重拍，不无声缩小。iPad 草稿和 Mac `problemPhoto` 保存该图；另发 ≤180KB preview 给 Omni。原照不是相机 RAW 或原始 EXIF 字节副本。2400×1800 测试先发现旧代码缩至1280，再通过；API 测试逐字节验证原照可读回。
- 候选题意编辑：原生编辑页 → `/workspace/:id/statement` → statement revision 递增、保持未确认 → 再由孩子确认。空白、旧版本、同 eventId 不同正文、已确认后的修改均拒绝。编辑失败保留编辑页，不假装保存。当前支持文本输入；系统键盘听写不是 Omni 口头修正逻辑，不能把两者混称已实现。
- 冲突：409 后取得远端副本，保留本机；明确选择本机笔迹或主机版本，任何选择前把双方存入 `conflict-UUID.json`。本机选项只接续远端事实并以远端 revision CAS 保存；主机选项保留本机归档并刷新 PencilKit restoreToken。测试覆盖两种选择、笔迹数量、缓存重开和双方归档。
- 横屏：窄屏上下结构，宽屏左题目/右画布；旋转回到顶部，画布高度随可用空间变化。UI 测试断言横屏画布完整位于屏幕内、旋转前笔迹不丢、四角均可书写，不只截图存在就算通过。

### 本轮验证和失败记录

- 后端相关 8 文件49项通过，typecheck通过；原图/冲突/缓存的模拟器测试通过。
- `/tmp/ai-dtl-layout-edit-green.log`：10项真机单测＋1项题意编辑/保存恢复/横屏四角 UI 流程通过。该次遇到锁屏，解锁后自动继续；锁屏期间继续了模拟器工作。
- `/tmp/ai-dtl-remaining-simulator.log`：增加真实 CAS 冲突并选择的部分通过，但该轮旋转没有得到 landscape interface，横屏断言失败，未降低断言。不能把这轮列为全通过。
- `/tmp/ai-dtl-remaining-device-final.log` 与 `...conflict-ui-device-retry.log`：UI Runner 自己请求 USB 地址时返回离线；App 请求同一宿主正常。检查 Runner 自带 ATS 已允许请求，添加 test-bundle plist 无效，已撤回该临时配置。换成仅 UUID 隔离 DEBUG 会话可见的测试按钮，由 App 发真实 GET/PUT 制造冲突，再由普通保存/选择 UI 执行恢复；没有 mock 状态或修改家庭数据。
- Mac 外放合成短句未让 iPad 分段器收到完整回合，此声学测试失败；不把先前 PCM 注入当收音通过。改测 iPad 自身扬声器播放 WAV → 真实麦克风 → 正式分段器，未直接喂 PCM 给分段器。
- Pencil 技术验证：正式配置 pencilOnly（真机断言），固定白纸、压力样本序列化/恢复不丢；模拟器通过。自动化触摸与构造压感样本仍不是人拿 Apple Pencil 的延迟/掌拒主观体验。
- 最新综合回归 `/tmp/ai-dtl-remaining-device-acoustic.log` 正在运行，结果另补。未提交、未推送。

### 14:50 综合结果与声学验收边界

- `/tmp/ai-dtl-remaining-device-acoustic.log`：**完整 UI 学习流程通过**，包括题意修改、真实五轮 Omni、纠正、恢复两笔、制造真实主机版本冲突、选择本机续存、横屏完整可见和四角书写。17 项原生检查通过；真实声学分段测试失败，因此该次整体 `TEST FAILED`，不隐藏它。
- 直接核实 Mac 会话 `7c71be55-5993-480e-a8bf-18e082e5ac9f`：statement revision=1、record revision=17、submissions=2、feedback=3、contested=1。原照 `c9c124ba-7136-4d83-bc77-c48aaf5d2397` 为1800×680/73001字节，识别预览 `4e08e5d8-cfd7-49d2-be2d-45b4aef1dee1` 为1280×484/42953字节，确实不是同一缩略图冒充原照。
- 已查看真机全屏截图 `/tmp/ai-dtl-remaining-device-attachments/38033DF4-D5C0-4125-AA05-948FE4025F88.png`：横屏左题右画布，四角及原两笔都可见，无之前 app.screenshot 裁切黑边。测试改用全屏截图，同时保留几何及笔迹断言；不是修改图片来掩盖布局问题。
- `/tmp/ai-dtl-acoustic-diagnostic.log`：真实麦克风路由 `MicrophoneBuiltIn`，20秒收到668282字节，最大帧 RMS=0.0036492866531161426，设备音量0.1；低于分段器固定阈值0.015，未产出完整语音回合。诊断仅存计数/音量，不落原始录音。没有据此降低全局阈值或将测试改成跳过成功；已询问用户是否允许临时调高系统音量再测、完成后恢复。未获得回答前不更改系统音量。
- `/tmp/ai-dtl-remaining-delivery.log`：**17项真机原生测试＋1项真实 UI 流程通过，声学测试1项显式跳过**（该项上述已失败，仍未验收）。这次 UI 增加横屏四角书写后的保存回执断言。该轮不再调用五轮模型，五轮证据使用上一项完整实际运行，避免无变化反复计费。
- 后端49项、契约21项、typecheck、diff check通过。Pencil 的 pencilOnly 配置、压力值序列化/恢复和横竖屏可写区域有自动证据；**真人 Apple Pencil 延迟、掌拒手感与主观听感仍不能用构造压力值/手指手势替代**。纸面拍摄需相机实际对准目标，不用注入图片冒充。
- 最后补测发现重新拍照会带入旧冲突状态（`/tmp/ai-dtl-conflict-new-photo-red.log` 实际失败）；已清除换题时的 conflictRecord，`/tmp/ai-dtl-final-camera-conflict.log` **7项原生测试＋真实相机取消UI测试通过**。实际相机打开/取消不丢草稿，不等同于拍到了纸面题。
- 最新 App 已安装并以普通入口重新启动（无测试注入、不开麦）；8791 healthz=ok/configured=true；本轮临时52991音频夹具服务已关闭。未提交/推送。声学测试等待临时音量调整授权，仍未记为通过。
