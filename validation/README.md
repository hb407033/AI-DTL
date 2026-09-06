# 阶段 0 验证材料

- `wizard-of-oz/`：家长扮演 Agent 的教学闭环验证材料（提示卡、记录模板）。
- `results/`：真实家庭结果。**整个目录被 .gitignore 忽略**，只保留 `.gitkeep`。录音、PCM、完整笔迹、家庭环境信息一律不入库。

三项门禁（教学 / 原生设备 / Codex）各自出一份 JSON，最后由 `pnpm gate:report` 汇总；任一 `BLOCKED` 则总状态 `BLOCKED`，否则任一 `FAIL` 为 `FAIL`，三项全过才是 `PASS`。
