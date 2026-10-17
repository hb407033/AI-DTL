# “看得见、能操作”的教学：目标逐项验收

时间：2026-09-22 18:51。当前工作区、真实 iPad、现有千问 Omni；未提交或推送。

## 结论与范围

原目标的一题线段教学工程闭环已具备并通过当前版本真机重跑：表达 → 核对理解并征求同意 → 真实模型生成 → 点选等分 → 隐藏 → 继续写画、表达、得到回应；纠正及迟到结果走独立失效分支。不建通用图形引擎，不增常驻建模入口。

输入是合成语音和自动化触控，真实设备运行 PencilKit，真实模型返回并播放语音。用户此前允许模拟输入；这里证明产品链路可运行，不证明儿童真实学习效果、麦克风声学质量或 Pencil 压感体验。教师提示的使用不作为独立掌握证据。

## 原目标要求与权威证据

| 要求 | 当前实现与本轮证据 |
| --- | --- |
| 孩子先表达 | `line-ui-voice.json` 首条 submission 保存“一升果汁…一半”的表达与 boardRevision=1；不是从题干伪造孩子原话。 |
| 老师理解、征求同意 | 主机生成待核对 meaning/anchor/sourceQuote；原生邀请呈现这些内容。UI 测试同意前断言不存在分段按钮，只有点同意才生成。 |
| 图的数量、单位、关系正确 | 实际模型记录 whole=1、unit=升果汁、partitions=2、selectedParts=[0]；界面实际显示“1/2 升果汁”。这里物理单位为升，包含对象词的显示文本未强称规范化单位。来源和锚点在生成前后相同；契约 13 项、状态/存档等后端 20 项本轮通过。 |
| 原稿与提示分离 | `LineScaffoldView` 独立于 `ChildCanvasView`；不向 PKDrawing 写模型图。真机 UI 断言操作提示后原稿仍1笔，隐藏后孩子再添一笔变2笔。`TutorSnapshotTests` 真机4项通过，提示记录另有区域。语音上下文显式 owner=teacher、状态、选段，不以选段证明掌握。 |
| 纠正后旧提示失效 | 真机同意后立即撤下，再重开无邀请/旧图；`line-ui-correct.json` 状态 invalidated/revision=3/无line。后端用例实际阻塞生成并在其返回前 invalidate，验证迟到结果拒绝。此前真机9项离线补同步验证保证失败/重启不复活、补发幂等。 |
| 隐藏后继续表达 | `line-ui-voice.json` scaffold hidden/revision=5；主记录revision=9、boardRevision=2，后两份 submission 保留孩子隐藏后将6.8元平均分的说明。真实末轮语音为“你想用什么办法检查自己的结果？”。重开仍2笔、无提示、无自动开麦。 |

## 本轮运行记录

- 真机 `LineScaffoldUITests`：2项通过，28.801秒和46.056秒，无跳过；两项覆盖正常教学闭环与纠正分支，纠正并非在同一语音作品里故意制造错误含义。
- 真机 `TutorSnapshotTests`：4项通过。
- 后端 `line-scaffold`、`workspace-scaffold`、`workspace-teaching-context`：20项通过；契约13项通过。
- 原始证据目录：`docs/handoffs/evidence/2026-09-22-line-goal-audit/`，包含真实模型转写/回应日志、3份合成作品的主机存档、真机执行日志与截图。
- 完整UI结果：`/tmp/ai-dtl-device-sep20/Logs/Test/Test-ScholarPad-2026.09.22_18-49-05-+0800.xcresult`。
- 快照结果：`/tmp/ai-dtl-device-sep20/Logs/Test/Test-ScholarPad-2026.09.22_18-50-47-+0800.xcresult`。测试期间有密集图片处理的4.13秒hang诊断，功能用例通过；不把此轮称为性能验收。
- UI测试结束诊断包采集有非测试失败警告；两项用例逐条 passed、进程成功退出，未靠该警告掩盖用例失败。

## 恢复与后续边界

隔离宿主已停止，家庭 LaunchAgent 恢复，重新打开正式 App。测试不写家庭 Workspace，不读取或打印凭据。

后续孩子真实体验、多个题型推广、跨周提示递减、纯USB断开重接体验仍可继续，但不把这些扩大目标混入本次“一题一种必要辅助图”的工程验收；也不宣称已完成这些扩展。
