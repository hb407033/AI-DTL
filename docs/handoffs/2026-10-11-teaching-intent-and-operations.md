# 教学诉求与完整操作：两条真实失败样本修复

AI-DTL / AI 学科心智学习系统。日期：2026-10-11。

## 范围与设计改变

承接 `2026-10-10-natural-child-reactions-acceptance.md` 的两个未完成项。不增加平台、不切模型，继续 Qwen3.8 Omni Flash Realtime、教学决策与纯播报分离。开工时Mac mini不通，使用此前获准的本机宿主；收工双机状态见下。所有测试使用合成儿童反应和隔离作品，未重写家庭原照、题干或笔迹。

1. **理解证据不再等于固定教学顺序。** `divisionProgress` 继续保守记录尚未解决的理由；`focusOptions` 独立决定当前允许的教学动作。孩子正确变换两数后可以先计算、有正确商后可以检验，不要求说出“我想先算”这句暗号。明确选择先计算时，该选择在当前会话历史内继续生效；主动回问理由时可以转回解释。检验一致后可交还独立尝试，但未说明理由不能因此得到 `invariance` 或“已经理解”的结论。`handoff` 是控制权交还，不是掌握验收；新增回归明确检查这一点，成长记录不因交还自动写入。
2. **检查完整操作，不只承接正确前半句。** “划掉小数点再补零”进入待核对状态，撤回旧的变换/理由证据。老师本轮只请孩子给出一个数经过整套操作后的写法，不同时问两数、位置、条件和原因。孩子明确修正并提供正确整数式后解除待核对。否定额外补零、一般缺位补零问题不能被直接判为错误算法。
3. **算式结果与数学角色。** “算出125÷5=25”先从完整算式取商，不能把125当作商；竖式的“12÷5商2余2、落下5”是原题子步骤，不当成新题。老师不能把孩子改正的商25说成除数25。核对205时判断零是否有计算依据，不能诱导孩子只移动一个本来多余的零。

这不是全科推理器或通用数学证明器。没有将有限的证据解析规则包装成任意语义理解，也没有将老师说过的解释写成孩子已理解。

## 修改入口

- `apps/agent-host/src/learning/decimal-division-policy.ts`：会话选择、完整操作待核对、算式结果提取。
- `apps/agent-host/src/ai/workspace-teaching-decision.ts`：允许动作集合、按当前诉求选动作、单一操作核对、数学角色/额外零门禁、一次修复要求。
- `apps/agent-host/test/teaching-intent-and-operations.test.ts`：原始失败原话、跨轮选择、主动回问、补零否定、错误承接及复测中新出现的失败。
- `apps/agent-host/test/workspace-teaching-decision.test.ts`：205的有效教学动作改为计算检查；保留课程、抢答、证据、持久化、重放、纯播报隔离检查。
- `apps/agent-host/scripts/probe-reaction-voice-loop.ts`：原话回放与动态孩子；`--failures-only` 跑两条失败分支，`--regressions-only` 再包含两个动态分支。
- `apps/agent-host/scripts/probe-teaching-reactions.ts`：增加完整操作定向探针。
- `apps/agent-host/scripts/probe-division-dialogue.ts`：界面验收允许合理开场动作；错商必须先核对计算，后续理由、检验和交还要求不变。
- `apps/ipad/ScholarPad/ScholarPadUITests/ChildLearningFlowUITests.swift`：只增强测试启动后的实际横屏窗口检查；没有修改Swift产品界面。界面复测另发现：有实际图片时允许先检查图中的计算，但不把图片存在本身记成变换/理由已解决。

## 验证与证据

稳定目录：`/Users/houbin/Library/Application Support/ai-dtl/acceptance/2026-10-11-teaching-intent-and-operations/`。

- 测试先行：最初8条新回归全部失败；后续动态表达暴露固定焦点仍压过“我试着除”，新增失败测试后改为允许动作集合。对应红灯及绿灯记录保留，不通过放宽抢答、掌握结论或修复次数来换绿灯。
- 相关后端回归：19文件111项通过；其中本轮失败样本及边界16项通过，不是全仓测试。`backend-final.log`、`original-samples-green.log`。
- 类型检查仍只有既有 `photo-learning-closure.test.ts:9`、`:11` 两处无效 `@ts-expect-error`，不能称全量通过。
- 早期真实语音回放曾出现“竖式请求被换成乘法检验”、商/除数角色混淆、补零分支连续两次生成多问题而被拒绝。失败结果保留；之后收窄该分支为“一个数的完整操作结果”这一教学动作，不扩大修复次数。
- **最终定向真实语音回归：2类14回合、0失败**，`voice-targeted-final.json/log`。12条非暂停回复均有真实PCM，2次自主暂停无新教学/音频；PCM在 `targeted-audio/`。使用真实WS→ASR→教学决策→纯播报→隔离存档，而非预填老师台词。人工检查两个重点：先列竖式不再被原理追问覆盖；补零操作被完整核对、孩子改正后继续计算并交还。最后的交还只有 `transformation, verify`，没有伪造 `invariance`。
- 最后一次扩展动态测试并非全绿：4类中有2类失败，一类在未复述转换式时被焦点门禁阻塞，已补失败测试并允许核验正确商、保持证据不补造；另一类转写完成后等待播报超时。保留 `voice-broad-before-final.json/log`。**没有把这次失败的扩展轮次算作通过，也没有宣称最终代码已完成全部动态回归**。播报超时不能仅凭日志归因供应商。
- **模拟器完整界面回归未通过。** 初次回归在看图开场被原理/变换焦点阻塞，已增加“有实际图片可先核对计算”的回归与修正。之后模拟器实际窗口保持834×1210竖向尺寸，测试中的语音入口不可点；加启动后方向检查再跑，明确在10秒横屏窗口门禁失败，最终15.012秒、1项1失败。`simulator-orientation-gate.log`、`simulator-before-orientation-gate.log`、`window-orientation.png` 与 `orientation-screens/`。没有降低断言、跳过失败或将构建通过冒充界面通过；尚不能判定是模拟器设置、系统方向行为还是应用问题，不能据此直接归因布局代码。
- Xcode测试构建成功，实际语音定向验收仍以隔离WS探针为证据，不能冒充真机/Pencil听感验收。最终本机8791宿主已重启载入更新，`host-health-final.json` 为 `ok / configured=true`。模型ID只核对非敏感字段，实际仍为 `qwen3.8-omni-flash-realtime`。

## 复跑

```sh
# 仓库根目录；只加载已有本机配置，不读取或回显凭据。
export AI_DTL_PROBE_DIRECTORY=/tmp/ai-dtl-division-decision.8gWaJc
export AI_DTL_REACTIONS_DIRECTORY="$(mktemp -d /tmp/ai-dtl-intent-recheck.XXXXXX)"
/Users/houbin/.local/bin/node --env-file-if-exists=.env.ai.local --import tsx \
  apps/agent-host/scripts/probe-reaction-voice-loop.ts --regressions-only
```

云端探针串行运行。有实际API费用。动态孩子仅看题目与可见对话，不读取教学焦点或期待答案；不是现实儿童，也不能用接口通过代替学习有效性验证。

## 环境与交接边界

- 仓库实际在 `/Users/houbin/Documents/Codex/2026-08-29/wo-yo`，工作分支 `codex/ipad-arrival-plan`。保留既有大量未提交内容，没有批量提交其他人的工作。
- 真机先前锁屏，最终只读检查已解锁，`passcodeRequired=false`（`device-lock-final.log`）；本轮没有完成真机完整界面验收。本轮没有改Swift产品客户端，只改了自动化测试；宿主更新无需重装iPad才能生效。模拟器结果不冒充真机验收。
- 开工Mac mini不可达；最终 `twin-status --no-fetch` 已返回两端HEAD均为 `e2a14d1`、分支均为 `codex/ipad-arrival-plan`，两端均有未提交内容。HEAD相同不等于未提交文件内容相同；本轮没有在mini上修改或部署，也没有覆盖/同步它的未提交工作。继续在mini实施前先逐文件对比。本机只有私有GitHub远端，没有配置GitLab；不虚报已经推送GitLab。
- 下一步先查明模拟器方向/窗口门禁并补完整界面回归，再检查真实孩子是否感到被理解。扩展动态分支的最终全轮复测、播报超时稳定性、图片里的数学事实如何成为宿主结构化证据、更多自然表述和完整竖式可视化，不在这两条定向修复内宣称完成。人工也仍可观察到review下老师会主动指定乘法检验，标签为place_value时的动作授权还需统一，不能称严格无旁路的教学策略系统。
