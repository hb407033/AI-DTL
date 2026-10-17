// 导出指定隔离测试会话的可核查证据，不扫描/导出家庭的其他记录。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
const id = process.argv[2];
if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw Error("Provide the exact test session UUID");
const source = path.join(os.homedir(), "Library/Application Support/ai-dtl/workspaces-v2");
const bundle = JSON.parse(readFileSync(path.join(source, `${id}.json`), "utf8"));
if (bundle.record.sessionId !== id) throw Error("Session mismatch");
const output = path.join("/tmp/ai-dtl-natural-evidence", id);
mkdirSync(output, { recursive: true });
const media = bundle.media.map(entry => {
  if (!/^[0-9a-f-]{36}$/i.test(entry.id)) throw Error("Invalid media id");
  const bytes = readFileSync(path.join(source, `${id}-media`, entry.id));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== entry.hash) throw Error("Media hash mismatch");
  const file = `${entry.id}.${entry.mime === "image/png" ? "png" : "jpg"}`;
  writeFileSync(path.join(output, file), bytes);
  return { file, kind: entry.kind, bytes: bytes.length, sha256 };
});
writeFileSync(path.join(output, "record.json"), JSON.stringify(bundle.record, null, 2));
writeFileSync(path.join(output, "media-manifest.json"), JSON.stringify(media, null, 2));
const fixture = JSON.parse(readFileSync("/tmp/ai-dtl-natural-loop-audio/manifest.json", "utf8"));
writeFileSync(path.join(output, "input-manifest.json"), JSON.stringify(fixture, null, 2));
console.log(JSON.stringify({ output, sessionId: id, revision: bundle.record.revision,
  feedback: bundle.record.feedback, submissions: bundle.record.submissions, media }, null, 2));
