# 左侧布局与画布工具试用版

2026-10-09，mini 主源码 codex/ipad-arrival-plan。

## 范围

- 横屏左侧分成当前探索、一起讨论、作品与记录；主按钮为开启／暂停对话，拍照换题归属题目，家长设置使用齿轮入口。
- 浅色学习桌面、紧凑导航标题、统一分组留白、独立白纸画布，横竖屏均保留原照与拍照入口。
- 画布提供画笔、整笔橡皮、撤销、重做、清空，所有工具44pt触控区域。
- 清空用明确的确认／保留弹窗，只修改当前笔迹，可撤销；照片、题目、已冻结的历史证据不删除。
- 修改笔迹仍经原有onDrawing与差分事件入口持久化；旋转保留历史，换题重置撤销历史，避免撤销到另一题。
- 历史最多30项，另有12MB字节约束；不新增依赖、模型调用或后端数据变更。

## 验证

- 真机9项通过、0失败、0跳过、无运行时警告：4项CanvasTools单测，5项UI测试。
- UI实际拖动写一笔→橡皮擦除→撤销恢复→清空取消→清空确认→撤销恢复→重做清空。
- 横竖屏画布可见面积均≥55%；原照展开与返回、拍照入口、工具入口均可见且可触达。
- 首轮失败定位：原生大标题挤占画布、工具触控区域不足、iPad popover不显示取消按钮。分别通过紧凑标题、明确contentShape/44pt区域、alert确认修复，未降低验收阈值。
- 笔迹恢复阶段状态发布延后到主线程下一调度，消除view update期间发布警告。
- 自动拖动使用DEBUG隔离夹具允许的手指输入，未冒充真人Apple Pencil主观手感验收。
- 部分XCUIApplication.screenshot在iPad横屏导出出现裁切／方向元数据问题；以XCUIScreen截图和真实可见面积检查为准，新测试截图已改用XCUIScreen。

证据：drawing-tools-accepted.log、screenshots目录；完整xcresult保留在/tmp/ai-dtl-photo-final.7bIlHG/drawing-tools-accepted.xcresult。

## 源码

- apps/ipad/ScholarPad/ScholarPad/Session/LearningWorkspaceView.swift
- apps/ipad/ScholarPad/ScholarPad/Canvas/ChildCanvasView.swift
- apps/ipad/ScholarPad/ScholarPad/Canvas/CanvasTools.swift（新增）
- apps/ipad/ScholarPad/ScholarPadTests/CanvasToolsTests.swift（新增）
- apps/ipad/ScholarPad/ScholarPadUITests/WorkspaceDrawingToolsUITests.swift（新增）

构建前运行xcodegen generate纳入新文件。没有覆盖笔记本旧业务源码，没有重启家庭8791服务，没有删除家庭学习记录。保留已有未提交改动，未混合提交或推送。

## 最终安装与补充验证

- 真正的PKDrawing解码／再编码测试暴露了序列化字节不稳定导致的旋转撤销历史丢失；改用既有restoreToken区分同一作品重建和外部恢复，不依赖字节相等判断。
- 最终版本重新执行4项CanvasTools单测与1项真实工具交互UI测试：5项通过、0失败、0跳过、0运行时警告。此前其他4项布局／拍照UI测试对应代码未再改动。
- 最终证据：drawing-tools-release.log、release-screenshots；完整结果/tmp/ai-dtl-photo-final.7bIlHG/drawing-tools-release.xcresult。
- 最终3个历史恢复相关文件已同步回mini主源码。devicectl确认安装com.houbin.aischolar.pad成功，随后无测试参数正常启动成功，未卸载应用或删除家庭缓存。
- 收工twin-status：mini分支codex/ipad-arrival-plan，HEAD e2a14d1，194项已有及本次未提交改动，未设上游；工具无法连接houbin-mbp.local，故未声称完成双机／远端同步，也未混合提交或推送。
