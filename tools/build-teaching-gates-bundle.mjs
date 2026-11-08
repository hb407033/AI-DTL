// 把唯一一份教学门禁源码打成无网络的 IIFE，供主机测试和 iPad JavaScriptCore 共用。
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function loadEsbuild() {
  // tsx 依赖 esbuild，但 pnpm 不把它挂到 tsx/node_modules。从仓库的 pnpm 目录加载，不新增依赖。
  const bundled = readdirSync(path.join(root, "node_modules/.pnpm")).find(name => name.startsWith("esbuild@"));
  if (!bundled) throw new Error("esbuildMissing");
  return createRequire(path.join(root, "node_modules/.pnpm", bundled, "node_modules/esbuild/package.json"))("esbuild");
}
const esbuild = loadEsbuild();
const entry = path.join(root, "apps/agent-host/src/ai/teaching-gates-entry.ts");
const stub = path.join(root, "tools/teaching-gates-network-stub.js");

export async function buildTeachingGates(outfile) {
  await mkdir(path.dirname(outfile), { recursive: true });
  const result = await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "iife",
    globalName: "TeachingGates",
    platform: "neutral",
    target: "es2020",
    metafile: true,
    legalComments: "none",
    // esbuild 0.28 拒绝以 ./ 或绝对路径做 alias 键。相对模块改由插件映射到同一 stub，效果与计划里的 alias 相同。
    alias: { ws: stub, "node:crypto": stub },
    plugins: [{
      name: "teaching-gates-block-network",
      setup(build) {
        const blocked = /(?:^|\/)(?:qwen-workspace-session|qwen-thinking-text|workspace-voice-provider|qwen-session)(?:\.js|\.ts)?$|^(?:ws|node:crypto|node:fs|node:fs\/promises|node:path|node:os|node:url|node:child_process|node:zlib)$/;
        build.onResolve({ filter: blocked }, () => ({ path: stub }));
      },
    }],
  });
  const bundle = await readFile(outfile);
  const sourceHashes = {};
  for (const file of Object.keys(result.metafile.inputs)) {
    if (file.includes("teaching-gates-network-stub")) continue;
    const absolute = path.resolve(file);
    sourceHashes[path.relative(root, absolute)] = createHash("sha256").update(await readFile(absolute)).digest("hex");
  }
  const manifest = { sourceHashes, bundleSha256: createHash("sha256").update(bundle).digest("hex") };
  await writeFile(`${outfile}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const launched = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (launched) {
  const outfile = path.join(root, "apps/ipad/ScholarPad/ScholarPad/Session/Gates/teaching-gates.js");
  await buildTeachingGates(outfile);
}
