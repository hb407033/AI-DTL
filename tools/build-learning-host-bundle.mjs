/** 生成不含配置/密钥的可审计宿主包；只在构建机读取现有 tsx 的 esbuild 依赖。 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const outfile = process.argv[2];
if (!outfile || !path.isAbsolute(outfile) || !outfile.endsWith(".mjs")
  || outfile.startsWith(path.join(repo, "apps")) || outfile.startsWith(path.join(repo, "packages"))) {
  throw Error("absoluteArtifactMjsPathRequired_notSourceDirectory");
}
const require = createRequire(import.meta.url);
const buildRequire = createRequire(require.resolve("tsx/package.json"));
const { build } = buildRequire("esbuild");
const banner = 'import { createRequire as __createRequire } from "node:module"; import { fileURLToPath as __fileURLToPath } from "node:url"; import { dirname as __pathDirname } from "node:path"; const require = __createRequire(import.meta.url); const __filename = __fileURLToPath(import.meta.url); const __dirname = __pathDirname(__filename);';
const result = await build({ absWorkingDir: repo, entryPoints: ["apps/agent-host/src/ai/learning-tutor.ts"],
  bundle: true, platform: "node", format: "esm", target: "node22", outfile,
  banner: { js: banner }, metafile: true, logLevel: "warning" });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sourceHashes = {};
for (const file of Object.keys(result.metafile.inputs).filter(f => !f.includes("node_modules"))) {
  sourceHashes[file] = hash(await fs.readFile(path.resolve(repo, file)));
}
const manifest = { builtAt: new Date().toISOString(), target: "node22+", bundleSha256: hash(await fs.readFile(outfile)),
  sourceHashes, configurationIncluded: false, credentialsIncluded: false };
await fs.writeFile(outfile + ".manifest.json", JSON.stringify(manifest, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ outfile, bundleSha256: manifest.bundleSha256, sources: Object.keys(sourceHashes).length }));
