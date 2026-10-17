import { mkdtempSync, readFileSync, rmSync, chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { FRACTION_PACK_VERSION } from "../src/learning/fraction-pack.js";
import {
  DEFAULT_LEARNING_SESSION_DIR,
  LearningSessionStore,
  type LearningSessionRecord,
} from "../src/learning/learning-session-store.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../../packages/session-contracts/fixtures/fraction-learning-v1.json", import.meta.url), "utf8"),
) as {
  boardStates: LearningSessionRecord["board"][];
  submissions: LearningSessionRecord["submissions"];
};

const dirs: string[] = [];
function tempStore(options: { atomicWrite?: (target: string, contents: string) => Promise<void> } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "learning-store-"));
  dirs.push(directory);
  return { directory, store: new LearningSessionStore({ directory, ...options }) };
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

let seq = 0;
function makeRecord(overrides: Partial<LearningSessionRecord> = {}): LearningSessionRecord {
  seq += 1;
  return {
    schemaVersion: 1,
    sessionId: `session-${seq}`,
    eventId: `event-${seq}`,
    packVersion: FRACTION_PACK_VERSION,
    challengeId: "fraction-compare-01",
    phase: "exploring",
    revision: 0,
    childInkBase64: Buffer.from("opaque-pencilkit-bytes").toString("base64"),
    board: { revision: 0, rectangles: [] },
    hintsVisible: false,
    hintUsed: false,
    submissions: [],
    feedback: [],
    ...overrides,
  };
}

describe("Mac 权威学习记录存储", () => {
  test("保存再读完全一致：题包版本、阶段、笔迹、矩形、提交、反馈与异议全部还原", async () => {
    const { store } = tempStore();
    const record = makeRecord({
      phase: "reviewing",
      revision: 3,
      board: fixture.boardStates[0]!,
      hintsVisible: true,
      hintUsed: true,
      submissions: fixture.submissions,
      feedback: [
        { feedbackId: "fb-1", submissionId: "submission-9", summary: "我看到你把两张纸都分成了 12 格。", contested: true },
      ],
    });
    await expect(store.save(record)).resolves.toEqual({ ok: true });
    const loaded = await store.load(record.sessionId);
    expect(loaded).toEqual({ status: "ok", record });
  });

  test("默认目录在用户 Application Support 下，绝不写进源码目录", () => {
    expect(DEFAULT_LEARNING_SESSION_DIR).toContain("Application Support");
    expect(DEFAULT_LEARNING_SESSION_DIR.startsWith(process.cwd())).toBe(false);
  });

  test("同 eventId/同 revision 重复保存幂等：第二次不再写盘", async () => {
    let writes = 0;
    const { directory, store } = tempStore({
      atomicWrite: async (target, contents) => {
        writes += 1;
        const tmp = `${target}.tmp`;
        writeFileSync(tmp, contents, "utf8");
        const { renameSync } = await import("node:fs");
        renameSync(tmp, target);
      },
    });
    const record = makeRecord();
    await expect(store.save(record)).resolves.toEqual({ ok: true });
    await expect(store.save({ ...record })).resolves.toEqual({ ok: true });
    expect(writes).toBe(1);
    const onDisk = readFileSync(path.join(directory, `${record.sessionId}.json`), "utf8");
    expect(JSON.parse(onDisk)).toEqual(record);
  });

  test("旧 revision 被拒绝且不覆盖现有记录；同 revision 不同 eventId 同样拒绝", async () => {
    const { store } = tempStore();
    const record = makeRecord({ revision: 2, eventId: "e-new" });
    await expect(store.save(record)).resolves.toEqual({ ok: true });
    await expect(store.save(makeRecord({ sessionId: record.sessionId, revision: 1, eventId: "e-old" })))
      .resolves.toEqual({ ok: false, reason: "staleRevision" });
    await expect(store.save(makeRecord({ sessionId: record.sessionId, revision: 2, eventId: "e-other" })))
      .resolves.toEqual({ ok: false, reason: "staleRevision" });
    await expect(store.load(record.sessionId)).resolves.toEqual({ status: "ok", record });
  });

  test("写入失败不报成功：注入的写盘失败会让 save 抛错且不留下半成品", async () => {
    const { directory, store } = tempStore({
      atomicWrite: async () => {
        throw new Error("diskFull");
      },
    });
    const record = makeRecord();
    await expect(store.save(record)).rejects.toThrow("diskFull");
    await expect(store.load(record.sessionId)).resolves.toEqual({ status: "missing" });
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(directory).filter((f) => f.startsWith(record.sessionId))).toEqual([]);
  });

  test.skipIf(process.geteuid?.() === 0)("只读目录上的真实写盘失败同样抛错", async () => {
    const { directory, store } = tempStore();
    chmodSync(directory, 0o555);
    try {
      await expect(store.save(makeRecord())).rejects.toThrow();
    } finally {
      chmodSync(directory, 0o755);
    }
  });

  test("损坏文件：读取报错、保留原文件、且不允许被新保存静默覆盖", async () => {
    const { directory, store } = tempStore();
    const record = makeRecord({ revision: 1 });
    await store.save(record);
    const file = path.join(directory, `${record.sessionId}.json`);
    writeFileSync(file, "{ not json !!!", "utf8");
    await expect(store.load(record.sessionId)).resolves.toEqual({ status: "corrupt" });
    await expect(store.save(makeRecord({ sessionId: record.sessionId, revision: 2, eventId: "e-2" })))
      .resolves.toEqual({ ok: false, reason: "corruptExisting" });
    expect(readFileSync(file, "utf8")).toBe("{ not json !!!");
  });

  test("结构非法（多余字段如音频/能力标签、坏 base64、路径穿越 sessionId）拒绝保存", async () => {
    const { store } = tempStore();
    const base = makeRecord();
    await expect(store.save({ ...base, audio: "raw-recording" } as LearningSessionRecord))
      .resolves.toEqual({ ok: false, reason: "invalidRecord" });
    await expect(store.save({ ...base, abilityLabels: ["weak-fractions"] } as unknown as LearningSessionRecord))
      .resolves.toEqual({ ok: false, reason: "invalidRecord" });
    await expect(store.save({ ...base, childInkBase64: "not!!base64" }))
      .resolves.toEqual({ ok: false, reason: "invalidRecord" });
    await expect(store.save({ ...base, sessionId: "../escape" }))
      .resolves.toEqual({ ok: false, reason: "invalidRecord" });
    await expect(store.load(base.sessionId)).resolves.toEqual({ status: "missing" });
  });

  test("删除后读取为 missing，迟到保存不得复活该记录（墓碑跨实例生效）", async () => {
    const { directory, store } = tempStore();
    const record = makeRecord({ revision: 1 });
    await store.save(record);
    await store.delete(record.sessionId);
    await expect(store.load(record.sessionId)).resolves.toEqual({ status: "missing" });
    await expect(store.save(makeRecord({ sessionId: record.sessionId, revision: 5, eventId: "e-late" })))
      .resolves.toEqual({ ok: false, reason: "deleted" });
    // 模拟宿主重启：新实例读到同一目录，墓碑依然拦截
    const reopened = new LearningSessionStore({ directory });
    await expect(reopened.load(record.sessionId)).resolves.toEqual({ status: "missing" });
    await expect(reopened.save(makeRecord({ sessionId: record.sessionId, revision: 9, eventId: "e-later" })))
      .resolves.toEqual({ ok: false, reason: "deleted" });
    await expect(reopened.delete(record.sessionId)).resolves.toBeUndefined();
  });

  test("删除也能清理损坏文件，给恢复留明确出口", async () => {
    const { directory, store } = tempStore();
    const record = makeRecord({ revision: 1 });
    await store.save(record);
    writeFileSync(path.join(directory, `${record.sessionId}.json`), "garbage", "utf8");
    await expect(store.load(record.sessionId)).resolves.toEqual({ status: "corrupt" });
    await store.delete(record.sessionId);
    await expect(store.load(record.sessionId)).resolves.toEqual({ status: "missing" });
  });
});
