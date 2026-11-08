# 2026-11-08 实时引导对话验证

实现分支：`cursor/ipad-realtime-guided-dialogue-93b6`，从 `codex/ipad-arrival-plan` 的 `2e98b17` 拉出。没有合并，没有部署 mini，没有改家庭作品库 `workspaces-v2`。

## 14 项

| 任务 | 结果 | 说明 |
| --- | --- | --- |
| 1 连接探针 | 本机完成，mini 待授权 | 脚本与本机读数已落盘。空闲仍用 90 秒。 |
| 2 门禁源与 JS 包 | 完成 | 30 条样例与包内 `checkDraft` 一致。相对路径不能做 esbuild alias，改用插件替换。 |
| 3 头部与门禁桥 | 完成 | 样例测试调用 `checkDraft`。快路径调用 `check` → `checkUtterance`。 |
| 4 实时会话 | 完成 | 发送排队。头部丢掉声音。取消后的旧响应丢掉，包括还没有 id 的那一次。 |
| 5 快路径 | 完成 | 头部文字不播放、不进对话。 |
| 6 慢路径 | 完成 | 应用默认走思考模型 HTTPS 和临时实时合成。明文地址不发送密钥。 |
| 7 失败表与打断 | 完成 | 无正文、只有声音、正文是 JSON，都当作想法，不放模型声音。 |
| 8 生命周期 | 完成 | 在途轮次不关闭、不换连接。轮换用当时的提示词。 |
| 9 主动开口 | 完成 | 40 秒且有新笔迹，间隔 120 秒，每题最多 3 次。 |
| 10 同步批次 | 完成 | 先记 pending，写完才 applied。409 和中途失败都不吞批次。 |
| 11 离线 outbox | 完成 | 按会话再按文件名。409 停该会话并留文件。 |
| 12 口令与开关 | 完成（未实发） | 路由有并发、过期、限流测试。没有运行发放脚本，没有展示口令。 |
| 13 界面分流 | 完成 | 模拟器 UI 测试看到「正在听你说」再看到「老师在说话」。 |
| 14 真机门槛 | 阻断 | v16 五类题已在隔离目录跑完，实时路径因 iPad 没有密钥而停。四项门槛未达标。见 `docs/handoffs/2026-11-08-realtime-vs-v16-comparison.md`。没有装 Release，默认开关仍关。 |

## 和计划不一致、已按源码改过的地方

- `selectTeachingFocus` 没有 `focus` 字段，只有 `kind`。`invite_check` 映射成 `verify`，其余映射成 `clarify`。
- 样例对账用硬门禁 `checkDraft`。快路径用 `checkUtterance`（带 softGates）。softGates 改写了原句时返回 `rewritten`，原声音不播放。
- esbuild 0.28 拒绝把相对路径当 alias 名。网络模块用 `onResolve` 指到 `tools/teaching-gates-network-stub.js`。alias 只留 `ws` 和 `node:crypto`。
- 同步不能先把批次记成已应用。台账最后一行生效：missing → pending → applied。版本不对在记 pending 之前返回 409。写到一半返回 500，同一 `batchId` 重放补齐，决策按 `responseId`、回合按 `turnId`、用量按 `callId` 去重。
- 新作品库第一笔保存的修订号是 0。测试用已经存在的修订 0，避免空库上 N 条决策停在 N-1 被误判成冲突。
- 口令文件只有 `code` 和 `expiresAt`，放在作品库目录的上一级，不进 `workspaces-v2`。密钥由进程内 `loadCredential` 读取。成功后先改名再删除。错码不消费文件。8 次失败 / 10 分钟 / IP 返回 429，文件还在。比较用固定长度的 `timingSafeEqual`。路由 `logLevel: silent`。传输仍是现有 `0.0.0.0:8791` 的明文 HTTP，没有新开端口。
- 计划没有定时器入口。空闲和主动开口由 `evaluate()` / `tick()` 驱动。
- 老师正在出声时（`prompting > 0`）不把采集帧送回模型，避免把自己的声音当孩子的话。
- 云端空闲关闭实测约 301 秒，大于 100 秒，所以客户端空闲仍是 90 秒。
- 未签名单元测试进程没有钥匙串权限（-34018）。生产默认仍是钥匙串；测试用内存存储，并只接受这个错误码。
- 界面自动轮次只在 `AI_DTL_REALTIME_AUTOTURN=1` 下把「正在听你说」留 4 秒，方便 XCUITest 采样。
- 实时模式打开时，v16 的 `onDrained` 不再把「老师在说话」清掉。通过门禁后先切到说话状态，再播放缓冲音频。
- JavaScriptCore 没有 `btoa`，包外先补一个 polyfill。`decideSlow` 的 Promise 把 resolve/reject 留住，再回到主线程完成。

## 慢路径接线

`WorkspaceClient.makeRealtimeSlowPath` 是应用实际使用的组合。文字请求按 `qwen-thinking-text.ts`：`wss` 主机换成 `https://主机/compatible-mode/v1/chat/completions`，模型 `qwen3.8-omni-flash`，`reasoning_effort: medium`，流式只保留正文，思维链不进入结果。朗读另开一条临时实时连接，指令以「只逐字读这句话：」开头，收集音频和朗读文本。数字不一致由门禁包重试一次，仍不一致就安全失败，不播放。

明文 `ws` / `http` 在发出请求前就被拒绝，密钥不会送到那个地址。错误信息不包含密钥、响应正文或思维链。取消、暂停卸载和超时都会拒绝还没完成的 JS Promise，晚到的声音不再播放，也不补一句「没想好」。

领取口令仍然是现有 `0.0.0.0:8791` 的明文 HTTP。家长设置里写明：只适合信任的家庭局域网，还没有达到可以对外发布的安全标准。这次没有把它说成安全传输，也没有改成新的端口或部署。

## 独立复核

- 批次：409 发生在 `recordSyncBatch` 之前。`recordSyncBatch` 对已 applied 返回 false，对 missing 写成 pending 并返回 true，对 pending 返回 true。测试「版本倒退返回 409 且不写入」和「决策写到一半失败不吞批次，重放只补齐一次」通过。嵌套 `serial` 用 `AsyncLocalStorage` 允许同一会话重入，避免死锁。
- 头部与声音：头部模式丢掉 `response.audio.delta`。`response.created` 之前的声音先留着，只有回复模式且 id 相符才放出。取消把已知 id 放进集合；如果取消时还没有 id，下一个 `response.created` 整段丢掉，再下一次新的请求仍可出声。对应 `testCancelBeforeResponseCreatedDropsThatResponseAndKeepsTheNext`。
- 无正文有声音、正文只有 JSON：记成想法，缓冲清掉，不放模型音频。
- 轮换：`turnInFlight(true)` 时 `speechStarted` 不替换 `current`，`evaluate` 不关闭。满 8 轮且不在途才预热 `next`，下一次开口再换。
- 领取：同一进程内排队。第二下并发读不到文件即 403。过期文件删除。错码不删。限流不删。响应体在成功时带密钥，这是领取本身的结果，不写入日志。局域网明文是既有宿主，不是这次新开的口。
- 原始录音只在内存里的帧缓冲，同步体禁止 `pcm` / `audio` / `recording` / `apiKey` / `audioBase64`。JS 包里没有这些网络入口字符串。

## 真实命令与结果

主机，仓库 `apps/agent-host`：

`npx vitest run`

结果：76 个文件、572 项通过。日志 `/tmp/host-vitest.log`。

门禁包：

`node tools/build-teaching-gates-bundle.mjs`

产物 `apps/ipad/ScholarPad/ScholarPad/Session/Gates/teaching-gates.js`（909500 字节）和同名 `.manifest.json`。包内没有 `"ws"`、`WebSocket(`、`apiKey`、`wss://`。`project.yml` 改过之后已执行 `xcodegen generate`。`.xcodeproj` 不提交。

iPad 单元，模拟器 `B6F3EE05-7E7E-422E-A40E-43725F2DB975`（iPad Pro 11-inch M5，iOS 26.5，当时为 Booted）：

`xcodebuild test -scheme ScholarPad -destination 'platform=iOS Simulator,id=B6F3EE05-7E7E-422E-A40E-43725F2DB975' -only-testing:ScholarPadTests -derivedDataPath /tmp/scholar-pad-realtime-dd CODE_SIGNING_ALLOWED=NO`

取消发生在 `response.created` 之前也会丢掉那次响应。慢路径改成真实文字请求和临时合成之后，全量结果：279 项、5 项跳过、0 失败，66.329 秒（`/tmp/scholar-pad-unit7.log`）。其中 `SlowPathCompositionTests` 7 项通过：门禁拒绝会调用文字请求和临时合成并播放合格重写；数字不一致重试一次后安全失败；取消后的晚到声音不再播放；超时不开始合成；明文地址不发送密钥。跳过的是既有的 Bonjour、故障注入主机、真机 PCM、真机麦克风，不是这次关掉的。

iPad 界面：

`xcodebuild test -scheme ScholarPad -destination 'platform=iOS Simulator,id=B6F3EE05-7E7E-422E-A40E-43725F2DB975' -only-testing:ScholarPadUITests/RealtimeModeUITests -derivedDataPath /tmp/scholar-pad-realtime-dd CODE_SIGNING_ALLOWED=NO`

`testRealtimeModeShowsListeningThenSpeakingAndPlaysWithinBudget` 通过。慢路径改成真实接线后再跑一次，13.895 秒通过（`/tmp/scholar-pad-ui7.log`）：先看到「正在听你说」，再看到「老师在说话」。假服务只绑 `127.0.0.1:8799`。这不能证明真机门槛。

本机探针：

`node --env-file=.env.ai.local --import tsx apps/agent-host/scripts/measure-realtime-connect.ts`

握手 p50 416 ms，p90 499 ms。样本：416、499、514、371、460、402、333、320、463、447。空闲关闭约 301 秒。输出没有地址和密钥。

对照脚本只用临时 jsonl 跑过，打印中位数并注明假数据不能证明门槛：

`node --import tsx apps/agent-host/scripts/report-latency-comparison.ts`

## 没有做、也不能用这次结果代替的事

- mini 探针、mini 上的服务、SSH、部署。待授权。
- 5 类题里，v16 已跑，实时对照没有跑成。记录在 `docs/handoffs/2026-11-08-realtime-vs-v16-comparison.md`。四项门槛没有达标，默认开关仍然关闭。
- 四项真机门槛（中位数 ≤ 4 秒、抢答/口诀 ≤ v16、慢路径 ≤ 30%、token ≤ v16 的一半）没有测量。`realtimeMode` 默认仍是关。没有装 Release。没有家长开麦确认。
- `tools/allow-ipad-key-handout.sh` 没有运行，没有领取，没有展示 6 位口令。
- 本机 8791 上已有的学习宿主没有被当作验收对象，也没有停掉。

## 回退

家长设置里的实时开关默认关。没有密钥、也没有这次启动的 `-realtimeMode YES` 时，仍走原来的 v16 主机对话。要退回这次分支，在合并前直接不合并即可。若已合并，把开关保持关闭，并恢复到合并前的 `2e98b17`。
