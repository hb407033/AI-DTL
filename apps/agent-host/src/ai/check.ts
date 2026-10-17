import { inspectAiConfig } from "./config.js";
const report = inspectAiConfig();
console.log(JSON.stringify(report, null, 2));
console.log("只检查配置格式；未调用模型，未验证 Key 权限。");
if (!report.qwen.ready || !report.pi.ready) process.exitCode = 1;
