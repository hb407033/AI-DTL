import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHostIdentity, discoveryArguments } from "../src/ai/host-discovery.js";
import { buildLearningTutor } from "../src/ai/learning-tutor.js";

test("主机身份跨重启稳定、与其他目录隔离", async () => {
  const root = await mkdtemp(join(tmpdir(), "dtl-host-"));
  try {
    const a = await loadHostIdentity(join(root, "a"));
    expect(await loadHostIdentity(join(root, "a"))).toBe(a);
    expect(await loadHostIdentity(join(root, "b"))).not.toBe(a);
    expect(discoveryArguments(a)).toContain("_ai-dtl._tcp");
    expect(discoveryArguments(a)).toContain(`hostId=${a}`);
    const app = await buildLearningTutor(null, { hostId: a });
    try {
      expect((await app.inject("/healthz")).json()).toMatchObject({ hostId: a, discoveryVersion: 1, mode: "learning-tutor" });
    } finally { await app.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
