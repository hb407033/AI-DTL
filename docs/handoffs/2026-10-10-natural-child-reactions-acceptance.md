# 真实儿童反应分支：实现与验收

日期：2026-10-10（笔记本时区）。AI-DTL / AI 学科心智学习系统。

**结论：本轮修复和工程分支测试已推进，但自然教学体验尚不能判通过。** 最新动态孩子测试虽无接口错误，人工审阅仍发现忽略计算诉求、重复原理追问及不准确的口头承接，见下方未完成项。不能以测试绿灯代替教学验收。

后续记录：这里列出的两条真实失败样本已在2026-10-11定向修复并完成14回合真实语音补测；界面回归仍有单独失败。详见 [教学诉求与完整操作修复](2026-10-11-teaching-intent-and-operations.md)，不改写本文件的历史验收结果。

## 本轮目标与边界

不再只验证预设正确台词。围绕五年级小数除法 `12.5÷0.5`，测试不会、反复不会、错改一个数、错商、错检验、猜中、词义不懂、换钱/长度思路、不愿画图、质疑老师、纠正转写、撤回跟读、另换新题、自主暂停。

继续使用本机宿主及 Qwen3.8 Omni Flash Realtime；教学决策与纯播报分离。没有接入 Hermes/Pi，没有改用新平台或模型。家庭作品、原照、笔迹未删除或重写；所有探针存储和音频使用隔离目录。

## 发现后修正的问题

1. “我不会/没听懂”没有总能得到具体帮助：补直接求助表达，但引用、假设、否定、独立模式不因此得到提示权限；重复求助要求换更小的例子。
2. 只改除数被误当新题：区分单边变换与独立新例；孩子修正另一边后解除旧错误，不持续批评。
3. 换单位解释必须背固定句式：接纳数值可核对的元→角及钱总数未增加、单位变细的说明。错误换算不算理解。
4. 孩子说“别再问为什么”仍被追问：本轮转为协商/澄清，允许先试算或暂歇；不把跳过解释记为理解。
5. 计划中的检验、跟读、撤回或算错检验会留下虚假的完成状态：保守撤销相应已解决焦点。
6. 老师预填商的数字、把错答案说成事实、替孩子给出正确检验乘积：增加对应门禁，继续保护原题与新例的答案。
7. 口头“你理解错了”后补充内容丢失：异议先落盘；带补充的口头纠正同轮澄清，纯按钮异议不擅自启动教学。iPad 等待该回应，不提前完成本轮或重开麦克风。
8. 模型修复看不到上一稿：仅一次修复内提供被拒草稿及具体要求，不放宽校验、不自动播放坏稿。草稿不写入生产日志。
9. 实测出现“米换厘米是十倍”的错误提示：补单位知识约束及这一已观察错误的门禁。此门禁不是完整数学事实验证器。

## 可检查的证据

稳定目录：`/Users/houbin/Library/Application Support/ai-dtl/acceptance/2026-10-10-natural-child-reactions/`。

| 检查 | 已观察结果 |
| --- | --- |
| 最终相关后端回归 | 27 文件、118 项通过，`backend-final.log`；不是全仓测试 |
| TypeScript | 仍只有既有 `photo-learning-closure.test.ts:9`、`:11` 两处未使用 `@ts-expect-error`，`typecheck-final.log`；不能称全量类型检查通过 |
| 新客户端行为 | 11 项客户端测试通过，含纠正接续等待；`client-green.log` 为模拟器结果，前一轮真机同组亦通过 |
| 真实模型多反应 | 14 类宽测试，13 类通过，连续求助一类的第二轮因抢答被门禁拒绝；保留 `broad-reactions-including-blocked.json`。补具体修复要求后，单独重跑该类5轮通过，`repeated-help-after-repair.json`。不是一次14类全绿 |
| 动态孩子前测 | `voice-before-refusal-fix.json`：5类27回合工程链路零报错，但人工审阅发现连续追问为什么；因此不能将零错误等同于教学通过，之后已修复 |
| 固定语音分支 | `voice-before-final-acknowledgement-fix.json` 前3类共15回合走通，覆盖求助、换思路、错检验、新题、纠正补充、暂停；后2类在原承接语校验下失败，文件完整保留 |
| 最新动态语音分支 | 最后修正承接语校验后，2类12回合、0工程错误，`adaptive-voice-final.json`。10条非暂停回应有真实PCM，2次暂停无新教学/音频。**人工教学审阅仍未通过**，不能称“全部自然反应已接住” |
| 完整界面回归 | 模拟器1项0失败、104.397秒，`simulator-end-to-end.log`；拍照确认→真实PencilKit手势→6轮真实模型语音→服务器决策核对→保存。截图在 `simulator-screens/`；隔离作品 `simulator-workspace.json` |
| 真机安装 | 最新Debug包安装到 iPad `00008112-000509D9268A201E` 成功，安装服务返回 bundleID `com.houbin.aischolar.pad`、databaseSequenceNumber 4252；保留家庭沙盒，不卸载 |
| 最终真机回归/启动 | **未完成**：设备后来自动锁屏，`passcodeRequired=true`，启动返回 `FBSOpenApplicationErrorDomain code 7 / Locked`。取消等待，不绕过密码、不要求家长现在点击；`device-locked.log`。此前一次真机测试因云端断线失败，`device-cloud-failure.log`；不算通过 |
| 本机8791宿主 | LaunchAgent已重启载入最终源码，`host-health-final.json` 为 `ok / learning-tutor / configured=true`；只关闭本轮临时8797探针 |

并行云端联调曾出现 `connectionClosed`、转写失败/超时；一次真机UI回归也因此失败。之后改为串行复测。不能据此断言供应商限流，也不能删除这些失败或将它们算作通过。

## 复跑入口

仓库：`/Users/houbin/Documents/Codex/2026-08-29/wo-yo`，分支 `codex/ipad-arrival-plan`。仓库既有大量未提交/未跟踪内容；本轮没有批量提交，不覆盖其他人的改动。

`apps/agent-host/scripts/probe-teaching-reactions.ts`：只预置儿童表达与行为边界，老师回复来自真实模型；默认14类，支持 `--scenario=不会再不会` 定向复测。

`apps/agent-host/scripts/probe-reaction-voice-loop.ts`：真实生产同源WS、ASR、决策、纯播报、隔离持久化。前三类为固定儿童反应；后两类由模型仅看题目与可见对话、根据老师上一句生成孩子的新回应，不读取内部教学焦点或验收条件。固定的最终暂停验证是否停止调用和播报。支持 `--adaptive-only`。

```sh
# 使用全新目录；不要指定家庭作品目录。
export AI_DTL_REACTIONS_DIRECTORY="$(mktemp -d /tmp/ai-dtl-reactions.XXXXXX)"
/Users/houbin/.local/bin/node --env-file-if-exists=.env.ai.local --import tsx \
  apps/agent-host/scripts/probe-teaching-reactions.ts

# 语音探针还需此前 make-division-fixtures.mjs 生成的 problem.jpg 等夹具目录。
export AI_DTL_PROBE_DIRECTORY="/tmp/ai-dtl-division-decision.8gWaJc"
export AI_DTL_REACTIONS_DIRECTORY="$(mktemp -d /tmp/ai-dtl-voice-reactions.XXXXXX)"
/Users/houbin/.local/bin/node --env-file-if-exists=.env.ai.local --import tsx \
  apps/agent-host/scripts/probe-reaction-voice-loop.ts
```

需要中文 Tingting 声音、ffmpeg、本机既有模型配置。凭据不进入脚本/文档/证据。真实模型调用有接口费用；串行运行云端探针。

## 不能夸大的边界与下一步

最新动态对话留下的两个明确未完成项：

1. 孩子说“别总跟我绕单位，我想先算”，老师仍回到“为什么份数不变”。孩子多次表达125÷5不可能等于205时，也仍重复商不变。静态的必选焦点与证据识别不足会压过孩子当前诉求；只增加更多拒绝短语不能算根治。下一步须以这些实际对话为失败样本，让“未解决知识点”约束掌握结论，而不是强制每轮按同一顺序提问。
2. 孩子提出“划掉小数点、再补零”，老师只承接“划掉相当于乘10”，漏查了补零，口头上容易被理解为肯定整个错误规则。下一步先核对孩子提出的完整操作，不把部分正确说成整句正确。

这两项不自动写入能力档案，不在本轮宣称解决；原始儿童/老师话语均在 `adaptive-voice-final.json` 可检查。

- 动态孩子仍是合成角色，不是真人儿童；非空PCM及上游转写匹配不等于独立审听或学习有效性验证。
- 表达识别仍是保守的小数除法规则，不是跨题型语义诊断。数钱拆分、交换乘法检验顺序等更多自然说法仍需单独补证据，不能泛称任意说法都能理解。
- 语音探针用合成题照和口述反应，不假称动态分支包含真人新笔迹。模拟器界面回归另检查实际 PencilKit 手势与照片确认，最终真机UI回归待补。
- 本轮最新完整界面通过证据来自模拟器，不是真机；真机安装成功也不等于锁屏后的实际启动/运行已通过。锁屏前同组客户端测试11项通过，不能替代最终UI验收。
- 输出被门禁拒绝时最多修复一次；仍失败必须明确失败，不自由答题兜底。云端提前断线尚不是零概率问题。
- 下一优先级是以上两项的失败样本与教学焦点规则，不再扩展平台、堆题型或靠更多预设正确台词掩盖问题；之后再扩展自主步骤/新笔迹修正。
- Mac mini 仍离线；回家先双机对比，再同步列出的文件和验证。本机当前仅配置GitHub私有远端，无GitLab，不能假称已同步或推送。
