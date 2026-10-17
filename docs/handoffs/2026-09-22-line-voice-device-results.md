# 连续语音与线段提示闭环：真机执行记录

2026-09-22，当前分支 `codex/ipad-arrival-plan`，未提交/推送，保留原有工作区。

## 结果

本轮已在真实 iPad 跑通两组自动化：

1. 原生同意、真实千问生成、选择半升、隐藏、重开不复活；另一作品生成中纠正并重开无旧图，29.569秒通过。
2. 在 PencilKit 中画第一笔→播放合成输入“这条线表示一升果汁”→独立授权短句“帮我一下”→真实语音回答与邀请→原生同意和点选→隐藏→画第二笔→继续解释→再次请求查看→保存→重开，两笔仍在、提示不显示、不自动开麦。真机最终 test-without-building 通过，见 `ai-dtl-line-physical-voice-direct.log`。相同闭环模拟器64.854秒通过。

**证据范围**：真实iPad、真实PencilKit、真实网络/千问响应及音频播放完成回调；输入为系统成人合成PCM，自动化触控通过测试模式写入PencilKit。不是儿童真实发言、不是本轮麦克风声学回路验收，也不是真人Apple Pencil压感/握笔体验验收。不能称儿童教学效果已经验证。

## 本轮修改

- `WorkspaceClient` 保留同题同版本最近实质表达，单独授权短句不覆盖该证据；暂停、换作品、纠正会清空，不借用别的题的旧话。
- 先复现单测失败：原说明为“帮我一下”，预期为“这条线表示一升果汁”；修复后客户端6项通过。
- 注意：后端原本已经会追加近期原话，因此不能把这项客户端修复描述成以前所有链路完全没有表示依据。此次明确了客户端主说明与后端上下文的一致性，并用真正分开的表达/授权轮验证。
- 真机完整跑通后检查实际话术，发现孩子已说“每份三元四角”，老师仍问“每份是多少”。新增严格的已完成等分方法+每份数量识别，只选择“邀请检验”，不判断正确、不宣称掌握。保留题干、计划、疑问等排除条件。
- 新教学行为测试先失败后通过；焦点与语音路由10项通过，typecheck通过。真实千问窄探针实际播报“你想用什么办法检查自己的结果？”，111360 bytes音频。
- 教学话术修复在完整真机流程之后实施：已独立真实验证，但未再声称整个真机UI用例在最后这条话术改动后重跑。

## 真机过程中排除的测试问题

- 锁屏导致 Xcode preflight 无限等待：中断等待，读取 lockState、先启动App，再使用已编译测试包 test-without-building，避免重新编译期间锁屏。
- 竖屏滚动落在PencilKit内而生成了笔迹：测试滚动移到画布外边缘；不把这些额外划线当孩子表达。
- 隐藏卡片后画布位置上移，原归一化落笔点在导航栏遮挡范围：从录屏确认后按画布与可见屏幕的交集计算落笔点，仍断言第二笔实际出现，不放宽计数。

## 数据与测试证据

目录 `docs/handoffs/evidence/2026-09-22-line-voice/`：

- `physical-first/`：真机选择半升、纠正重开、语音邀请截图。
- `physical-complete/`：最终真机完整语音闭环截图。
- `simulator/`：模拟器对应截图。
- 客户端红绿日志、实际模型输出和音频字节数、四段合成输入文本与SHA256、真机最终执行日志、教学话术红绿/真实探针。

最后一轮隔离宿主目录见 `ai-dtl-line-voice-device-last-host.log`。最终 `line-ui-voice` revision8，3条submission及3条feedback；首份原说明包括一升表示依据，后两份包含隐藏后的独立解释；boardRevision由1变2。scaffold revision5/status hidden/partitions2/selectedParts[0]。这是提示使用历史，不等同独立掌握。家庭数据没有被这些测试替换。

## 家庭宿主常驻

本轮开始再次发现8791无进程；过去临时调试进程不足以保证退出会话后可用。现已配置当前用户 LaunchAgent：

- plist：`/Users/houbin/Library/LaunchAgents/com.houbin.ai-dtl.learning-tutor.plist`
- label：`com.houbin.ai-dtl.learning-tutor`
- 命令：`/Users/houbin/.local/bin/node --env-file-if-exists=.env.ai.local --import tsx apps/agent-host/src/ai/learning-tutor.ts`
- cwd：本仓库；RunAtLoad及KeepAlive开启；不复制密钥到plist，不自动开麦/调用模型。
- 日志：`/Users/houbin/Library/Logs/ai-dtl-learning-tutor.log`及`ai-dtl-learning-tutor-error.log`。
- 查看：`launchctl print gui/501/com.houbin.ai-dtl.learning-tutor`
- 开始隔离测试前先停托管服务：`launchctl bootout gui/501 /Users/houbin/Library/LaunchAgents/com.houbin.ai-dtl.learning-tutor.plist`。不要只kill进程，因为会自动重启争用8791。
- 测试后恢复：`launchctl bootstrap gui/501 /Users/houbin/Library/LaunchAgents/com.houbin.ai-dtl.learning-tutor.plist`，再检查`/healthz`。
- 回退：执行上面的bootout即可停止；plist保留便于恢复。仅当前用户服务，未改系统级配置。

当前USB地址169.254.232.183；仍需每次重新检查。自动发现/地址稳定尚未实现，不把常驻宿主当作已解决地址漂移。

常驻实测：bootstrap后state=running/runs=1/PID91333；显式SIGTERM后自动恢复到runs=2/PID91707，通过USB地址访问healthz返回ok/configured=true。iPad正常入口已成功启动；不是把最后一个隔离测试作品当作家庭入口留下。

## 未完成

1. 真正的儿童语音/麦克风声学闭环及Apple Pencil体验；自动化不能代替。
2. 离线撤销的主机补偿队列（本机已持久撤下，未自动补偿到主机）。
3. 自动发现主机，免手填易漂移USB地址。
4. 较长时间、多个题目的教学效果：当前不应判定孩子“已经掌握”，也未验收跨周AI介入下降。
