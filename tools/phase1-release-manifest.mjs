// 第一阶段 T5：发布清单与源码指纹。只枚举明确源码目录、配置模板与锁文件并计算 SHA-256；
// 排除 .env*（.env.ai.example 模板例外）、auth、Keychain、工作区数据、证据个人内容、缓存/构建产物。
// 记录 Git HEAD 和 dirty 标记；构建产物自己的 SHA-256 另算，但不把产物作为源码。
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { execSync } from "node:child_process";

export const DEFAULT_WHITELIST_DIRS = [
  "apps/agent-host/src",
  "apps/agent-host/test",
  "packages/session-contracts/src",
  "packages/session-contracts/test",
  "packages/session-contracts/fixtures",
  "packages/learning-kernel/src",
  "apps/ipad/ScholarPad/ScholarPad",
  "apps/ipad/Shared",
  "assets/brand",
  "docs/superpowers",
  "scripts",
  "tools",
  "deploy/macos",
];
export const DEFAULT_WHITELIST_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "apps/agent-host/package.json",
  "packages/session-contracts/package.json",
  "packages/learning-kernel/package.json",
  "apps/ipad/ScholarPad/project.yml",
  ".env.ai.example",
];

// 排除：密钥/本地环境（.env.* 但 .env.ai.example 模板例外）、依赖、构建产物、工作区数据、证据中的个人内容、git 元数据。
export const DEFAULT_EXCLUDE = [
  /(^|\/)node_modules(\/|$)/,
  // 匹配 .env. 后跟非 ai.example 的任意后缀（.env.local、.env.ai.local、.env.production 等）
  /\.env\.(?!ai\.example(?:$|\/))/,
  // 纯 .env 文件（无后缀）
  /(^|\/)\.env$/,
  /(^|\/)\.git(\/|$)/,
  /DerivedData/,
  /(^|\/)workspaces-v2(\/|$)/,
  /(^|\/)evidence(\/|$)/,
  /(^|\/)\.build(\/|$)/,
  /(^|\/)build(\/|$)/,
  /\.DS_Store$/,
];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function walk(dir, root, exclude, out) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(root, full);
    if (exclude.some((re) => re.test(rel))) continue;
    if (entry.isDirectory()) await walk(full, root, exclude, out);
    else if (entry.isFile()) out.push(rel);
  }
}

/** 枚举白名单源码文件，返回确定性排序的相对路径数组。 */
export async function enumerateSourceFiles(root, options = {}) {
  const dirs = options.whitelistDirs ?? DEFAULT_WHITELIST_DIRS;
  const files = options.whitelistFiles ?? DEFAULT_WHITELIST_FILES;
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;
  const out = [];
  for (const d of dirs) {
    const full = join(root, d);
    try { await stat(full); } catch { continue; }
    await walk(full, root, exclude, out);
  }
  for (const f of files) {
    const rel = f;
    if (exclude.some((re) => re.test(rel))) continue;
    try { await stat(join(root, f)); out.push(rel); } catch { /* 缺失文件跳过 */ }
  }
  return Array.from(new Set(out)).sort();
}

/** 计算源码指纹：每文件 "rel:sha256(content)" 排序后整体 sha256。 */
export async function sourceFingerprint(root, options = {}) {
  const files = await enumerateSourceFiles(root, options);
  const lines = [];
  for (const rel of files) {
    let content;
    try { content = await readFile(join(root, rel)); }
    catch { continue; }
    lines.push(`${rel}:${sha256(content)}`);
  }
  return sha256(Buffer.from(lines.join("\n"), "utf8")).toString("hex");
}

function gitHead(root) {
  try { return execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}
function gitDirty(root) {
  try { const s = execSync("git status --porcelain", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); return s.trim().length > 0; }
  catch { return false; }
}

export async function buildReleaseManifest(root, options = {}) {
  const fingerprint = await sourceFingerprint(root, options);
  return {
    stage: "v1-stage-1",
    sourceHead: options.gitHead ?? gitHead(root),
    dirty: options.dirty ?? gitDirty(root),
    sourceFingerprint: fingerprint,
    hostPort: 8791,
    appBundleId: "com.houbin.aischolar.pad",
    // 模型字段：仅接受显式非敏感标签或环境变量 AI_DTL_MODEL_LABEL；不读密钥，不以静态默认冒充实际运行模型。
    model: options.model ?? process.env.AI_DTL_MODEL_LABEL ?? "unknown",
    limitations: ["half-duplex"],
  };
}

// CLI：node tools/phase1-release-manifest.mjs [repoRoot]
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? process.cwd();
  const manifest = await buildReleaseManifest(root);
  console.log(JSON.stringify(manifest, null, 2));
}
