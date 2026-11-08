# 语音连续性、打断与恢复：实施与交接

日期：2026-11-01。范围仅为语音会话和音频生命周期，未修改教学决策、提示框架或画布源码。工作分支 `codex/ipad-arrival-plan`，起点 `e5f553f`。

## 当前交付边界

代码与隔离验证已完成主体修复，Mac mini 已切换新宿主。**用户恢复原账号后，正式 iPad 已于本次重试成功覆盖安装，但启动与最终真机回归仍被 iPad 的开发者证书信任检查阻止。** 原团队 `YZQ2T35W5C` 已恢复可用签名；没有卸载原应用、清除数据或转移签名密钥。

重试证据：`/Users/houbin/Library/Application Support/ai-dtl/acceptance/2026-11-01-ipad-original-signing.FpkLL9`。原 bundle `com.houbin.aischolar.pad`，原团队构建成功、`codesign --verify --deep --strict`通过、设备安装成功；新描述文件到期日2026-11-08。覆盖安装前后63个原文件缺失0、变化0。`native-regression.xcresult`/日志记录测试启动失败，不能把 build-for-testing 或安装成功算成37项计划内真机测试通过。需要在 iPad 系统设置完成该开发者的信任/验证后，再继续原定单测及 UI 回归。

为不阻塞开发，在同一台 iPad 上使用独立 bundle `com.houbin.aischolar.pad.voicevalidation` 验证，不混用原应用的数据容器。中间版本真机26项通过；最终回归两次被 iOS 的开发者证书信任检查拒绝，未继续重复尝试绕过。最新客户端的状态机验证另在 macOS 执行，不能冒充最终真机听感或声学验收。

## 已修复

1. **转写失败不结束整场对话。** 服务端单独跟踪正在转写的轮次，失败回执包含当前 turnId、转写阶段和权威存档；客户端匹配该阶段，不要求此时尚不存在的 responseId。权限错误、损坏作品、过期证据仍不能被恢复白名单吞掉。没有自动重放旧录音。
2. **有限恢复连接。** 接收失败和发送网络错误均进入最多两次重连，只发 hello，不重新开场或重发授权、旧音频；暂停、退出、作品变化会阻止重连。
3. **取消分成两个屏障。** `interruptAccepted` 立即确认接收；`interrupted` 在旧操作排空后返回权威版本。新插话可暂存在本机，收到最终回执后只提交一次。未收到接收确认仍保留短超时；确认后最多等10秒，然后走有限恢复，不无限挂起。
4. **取消异步准备中的旧任务。** 连接 generation 之外增加单轮 operation token。开场照片/证据尚未提交时只在本机取消；已取消的证据上传完成也不能再发送旧 startDiscussion/authorize。宿主同步登记排队中的 turn，避免 voiceStart 尚在读盘就插话时误报 staleTurn。
5. **播报时仍能接收插话。** 输入输出共用一个 AVAudioEngine，开启 voice processing，使用 voiceChat；播放开始/停声不再关闭麦克风。端点检测已有足够语音后通知客户端取消旧回复，保留正在说的插话前缀。安静时仍只在本机保留有限前滚，不持续上传静音。
6. **启动与退出边界。** 麦克风启动单飞，先完成启动再开场，避免等待权限期间生成的播放引擎被替换；退出会取消尚未完成的证据准备，未提交的开场不向主机发无效取消。
7. **“等一下”不是结束通话。** 新客户端的“等一下/停一下/我先想一想”等完整短句只暂停老师，保持连接和本地收音；明确“暂停/我想休息/不要给我提示”仍结束。短暂停顿不生成学习结论，也不自动重发上一句。

### 新旧版本兼容

新客户端通过 WS URL query `voiceRecovery=1` 明确声明支持无 responseId 的转写恢复；旧宿主忽略 query，新宿主对无声明的旧客户端保留原转写失败行为。这不是学习权限，也不改变教学授权。不能向旧客户端直接发送它会忽略、从而卡在 working 的恢复事件。

## 验证与证据

全部私有资料、设备日志与备份在本机目录：

`/Users/houbin/Library/Application Support/ai-dtl/acceptance/2026-11-01-voice-recovery.46ZjBy`

- 宿主最终完整测试 **73文件、556项通过**，见 `host-full-final.log`。
- `workspace-listening-recovery.test.ts` 使用真实 WS、路由和临时存档，模型为替身：同一连接26次输入，夹入4次转写失败、2次取消，成功交付20次老师回复；取消的回复不播报、不记作有效历史，不重复授权或交付。另覆盖20轮输入、新旧协议和建立 turn 前的取消。
- 独立评审先复现两条 evidence 取消竞态，修复后 Swift harness 均通过。完整 macOS XCTest最终 **30项通过**（仓库28项＋额外2项），使用实际客户端与 Foundation 模型、音频替身；日志 `mac-review.log` / `mac-final-green.log`，源哈希与适配清单 `mac-review-manifest.json`。不能用它证明 AEC、麦克风听感或真实模型教学质量。
- 中间版本真机26项通过，包含播报期间麦克风保持开启、音频生命周期、20轮恢复和取消超过3秒的暂存；日志 `ipad-green.log`。后续最终版本的启动失败如实保留在 `ipad-green-final.log`、`ipad-regression-final.log`。
- 最终源码 iOS Swift 6 `build-for-testing` 成功，见 `ipad-final-build.log`；构建成功不等于设备启动/测试成功。独立验证版产物在 `/tmp/ai-dtl-voice-validation-20261101/Build/Products/Debug-iphoneos/ScholarPad.app`，不是原 bundle 的可覆盖包。
- TypeScript 全量检查仍有原有两处 `photo-learning-closure.test.ts` 的 TS2578，没有借此修改无关测试。
- 本轮没有新付费模型调用；教学与模型配置保持原样。故障注入、合成音频/媒体生命周期和真实孩子使用是不同证据。

## Mac mini 部署与恢复

独立包在 `~/Library/Application Support/ai-dtl/runtime/2026-11-01-voice-recovery/`，不含配置和密钥。40个输入源哈希、包哈希和隔离 healthz 在切换前核对；最终包 `learning-tutor-voice-recovery-v2.mjs`，SHA256 `671cb223841eb9d3103fc74a4dbab5b66b9b45b8dc31afc1c2cac5568204ebca`，核验时PID `93860`，healthz 200/configured=true/hostId未变；详见私有 `mini-final.json`。原模型配置文件继续由现有固定 Node 22 启动参数加载，没有读取或打印密钥。

备份：mini `/tmp/ai-dtl-voice-upgrade.SnpGZJ`，包括原 LaunchAgent 与作品副本；原 v14 与本轮v1包均保留。紧接 bootout 的 bootstrap 曾出现 Input/output error；等待旧服务移除后，从 Application Support 中同配置的 plist 注册成功，已恢复 launchd 管理。开机用的 LaunchAgents plist 也指向最终v2包。临时 nohup 进程已正常停止，不能把它当作开机恢复完成。

切换前后 mini 67个原文件缺失0、变化0；原 iPad 容器63个文件缺失0、变化0。没有删除材料。备份与文件哈希只保留在私有证据目录，不提交家庭作品。

收尾已备份并卸载本轮创建的独立 `voicevalidation` 测试 App，避免出现两个同名 AI-DTL 图标；正式 `com.houbin.aischolar.pad` 仍安装。测试数据保存在私有 `validation-app-data`，源码、构建包与证据均可重建，没有卸载正式应用。

## 延迟与后续任务

本轮只消除媒体侧的重复开关引擎及已开麦时固定400ms重开等待，未声称真实模型端到端延迟已显著下降。原先的“转写→决策→复核→整句语音缓冲”仍在，不能为了抢首音绕过教学与播报一致性检查。

后续顺序：

1. 原 Apple ID 登录/描述文件与正式覆盖安装已完成；现在需在 iPad 的“设置→通用→VPN与设备管理”中完成原开发者的信任/验证。这需要系统允许，不能绕过检查。
2. 信任后继续最终版本的37项计划内真机单测和隔离 UI 回归，再补真实插话/回声误触发的声学验收；本次尚未执行，不与以前的中间版本真机26项混算。
3. 再做有界真实模型延迟实验：分别记录说完、转写、决策/改写/复核、语音首块、扬声器实际首音；保留尾部延迟与失败，不把云端首音当作孩子听见。
4. 仓库仅配置 GitHub origin，没有 GitLab remote/上游。本轮不得猜测 GitLab 地址或擅自改变远端。用户开工前已有的 TutorSnapshot.swift、TutorSnapshotTests.swift 与旧交接文档改动应继续保留，不夹带进本任务提交。

本轮改动暂留工作区，未提交、未推送；两端起点与分支已核对，不擅自用 GitHub 替代缺失的 GitLab 推送目标。后续接手只处理本报告列出的会话改动，保留三份既有改动。
