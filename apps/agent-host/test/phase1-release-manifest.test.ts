import { expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
// tsc 无法静态解析 .mjs，vitest/tsx 运行时正常；抑制此导入的类型解析错误。
// @ts-expect-error TS2307
import { buildReleaseManifest, enumerateSourceFiles } from "../../tools/phase1-release-manifest.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "release-manifest-"));
  // 构造白名单内的最小源码结构
  await mkdir(path.join(root, "apps/agent-host/src"), { recursive: true });
  await mkdir(path.join(root, "packages/session-contracts/src"), { recursive: true });
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await mkdir(path.join(root, "deploy/macos"), { recursive: true });
  await mkdir(path.join(root, "apps/ipad/Shared"), { recursive: true });
  await mkdir(path.join(root, "assets/brand"), { recursive: true });
  await mkdir(path.join(root, "packages/session-contracts/fixtures"), { recursive: true });
  await mkdir(path.join(root, "tools"), { recursive: true });
  await writeFile(path.join(root, "apps/agent-host/src/a.ts"), "export const a = 1;\n");
  await writeFile(path.join(root, "packages/session-contracts/src/b.ts"), "export const b = 2;\n");
  await writeFile(path.join(root, "scripts/run.sh"), "#!/bin/sh\n");
  await writeFile(path.join(root, "deploy/macos/x.plist"), "<plist/>\n");
  await writeFile(path.join(root, "apps/ipad/Shared/Shared.swift"), "let x = 1\n");
  await writeFile(path.join(root, "assets/brand/logo.svg"), "<svg/>\n");
  await writeFile(path.join(root, "packages/session-contracts/fixtures/case1.json"), "{}\n");
  await writeFile(path.join(root, "tools/phase1-release-manifest.mjs"), "export {}\n");
  await writeFile(path.join(root, "package.json"), "{}\n");
  await writeFile(path.join(root, ".env.ai.example"), "DASHSCOPE_API_KEY=\n");
  return root;
}

test("两次无改动生成相同源码摘要；源码变更摘要变化；密钥文件不被枚举", async () => {
  const root = await fixture();
  try {
    const opts = { gitHead: "abc123", dirty: false };
    const m1 = await buildReleaseManifest(root, opts);
    const m2 = await buildReleaseManifest(root, opts);
    expect(m1.sourceFingerprint).toBe(m2.sourceFingerprint);
    expect(m1.sourceHead).toBe("abc123");
    expect(m1.stage).toBe("v1-stage-1");
    expect(m1.hostPort).toBe(8791);
    expect(m1.appBundleId).toBe("com.houbin.aischolar.pad");
    expect(m1.limitations).toEqual(["half-duplex"]);
    // 静态默认不得冒充实际运行 model；未显式指定时为 unknown
    expect(m1.model).toBe("unknown");
    const mExplicit = await buildReleaseManifest(root, { ...opts, model: "glm-5.2" });
    expect(mExplicit.model).toBe("glm-5.2");

    // 模拟密钥文件：不应被枚举，指纹不变
    await writeFile(path.join(root, ".env.ai.local"), "DASHSCOPE_API_KEY=secret\n");
    const m3 = await buildReleaseManifest(root, opts);
    expect(m3.sourceFingerprint).toBe(m1.sourceFingerprint);
    const files = await enumerateSourceFiles(root, opts);
    expect(files.some((f: string) => f.endsWith(".env.ai.local"))).toBe(false);
    expect(files.some((f: string) => f.endsWith(".env.ai.example"))).toBe(true);

    // 源码变更：指纹变化
    await writeFile(path.join(root, "apps/agent-host/src/a.ts"), "export const a = 2;\n");
    const m4 = await buildReleaseManifest(root, opts);
    expect(m4.sourceFingerprint).not.toBe(m1.sourceFingerprint);

    // node_modules 不被枚举
    await mkdir(path.join(root, "apps/agent-host/src/node_modules"), { recursive: true });
    await writeFile(path.join(root, "apps/agent-host/src/node_modules/dep.js"), "x");
    const files2 = await enumerateSourceFiles(root, opts);
    expect(files2.some((f: string) => f.includes("node_modules"))).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("XcodeGen 输入变更影响指纹：Shared/brand/fixture/manifest", async () => {
  const root = await fixture();
  try {
    const opts = { gitHead: "abc123", dirty: false };
    const base = await buildReleaseManifest(root, opts);

    // apps/ipad/Shared 变更 → 指纹变化
    await writeFile(path.join(root, "apps/ipad/Shared/Shared.swift"), "let x = 2\n");
    const mShared = await buildReleaseManifest(root, opts);
    expect(mShared.sourceFingerprint).not.toBe(base.sourceFingerprint);
    await writeFile(path.join(root, "apps/ipad/Shared/Shared.swift"), "let x = 1\n");

    // assets/brand 变更 → 指纹变化
    await writeFile(path.join(root, "assets/brand/logo.svg"), "<svg version=\"2\"/>\n");
    const mBrand = await buildReleaseManifest(root, opts);
    expect(mBrand.sourceFingerprint).not.toBe(base.sourceFingerprint);
    await writeFile(path.join(root, "assets/brand/logo.svg"), "<svg/>\n");

    // packages/session-contracts/fixtures 变更 → 指纹变化
    await writeFile(path.join(root, "packages/session-contracts/fixtures/case1.json"), "{\"v\":1}\n");
    const mFixture = await buildReleaseManifest(root, opts);
    expect(mFixture.sourceFingerprint).not.toBe(base.sourceFingerprint);
    await writeFile(path.join(root, "packages/session-contracts/fixtures/case1.json"), "{}\n");

    // manifest 工具自身变更 → 指纹变化
    await writeFile(path.join(root, "tools/phase1-release-manifest.mjs"), "export { x }\n");
    const mTool = await buildReleaseManifest(root, opts);
    expect(mTool.sourceFingerprint).not.toBe(base.sourceFingerprint);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("私有 .env* 文件不被枚举（.env.ai.example 模板例外）", async () => {
  const root = await fixture();
  try {
    const opts = { gitHead: "abc123", dirty: false };
    // 放入各种私有 env 文件
    await writeFile(path.join(root, ".env"), "SECRET=1\n");
    await writeFile(path.join(root, ".env.local"), "SECRET=2\n");
    await writeFile(path.join(root, ".env.production"), "SECRET=3\n");
    await writeFile(path.join(root, ".env.ai.local"), "KEY=secret\n");
    // 也放入白名单目录内的 .env
    await writeFile(path.join(root, "apps/agent-host/src/.env.local"), "KEY=secret\n");
    const files = await enumerateSourceFiles(root, opts);
    expect(files.some((f: string) => f === ".env")).toBe(false);
    expect(files.some((f: string) => f === ".env.local")).toBe(false);
    expect(files.some((f: string) => f === ".env.production")).toBe(false);
    expect(files.some((f: string) => f === ".env.ai.local")).toBe(false);
    expect(files.some((f: string) => f.endsWith("src/.env.local"))).toBe(false);
    // 模板文件应被枚举
    expect(files.some((f: string) => f === ".env.ai.example")).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
