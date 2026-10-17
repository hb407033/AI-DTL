#!/usr/bin/env node
// 本地子进程协议夹具：不加载 Pi、不访问模型或文件，所有输入均为成人合成测试内容。
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { prompt += chunk; });
process.stdin.on("end", () => {
  if (prompt === "wait") { setInterval(() => {}, 1000); return; }
  if (prompt === "error") { process.stderr.write("synthetic-private-error"); process.exitCode = 1; return; }
  if (prompt === "oversize") { process.stdout.write("x".repeat(2 * 1024 * 1024 + 1)); return; }
  process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: prompt }] } }) + "\n");
});
