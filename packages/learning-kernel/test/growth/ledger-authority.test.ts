import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { openLearningDatabase } from "../../src/growth/database.js";
import { GrowthLedgerService } from "../../src/growth/ledger-service.js";
import { InMemorySessionStore } from "../../src/store.js";
import { SqliteSessionStore } from "../../src/sqlite-store.js";

const root = new URL("../../../../", import.meta.url).pathname;
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (["node_modules", ".build", "build", "DerivedData", ".git"].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sources(path) : path.endsWith(".ts") && path.includes("/src/") ? [path] : [];
  });
}

test("包入口不导出存储，生产代码只有服务持有成长写存储", () => {
  const index = readFileSync(new URL("../../src/index.ts", import.meta.url), "utf8");
  expect(index).not.toMatch(/growth\/(?:database|store\/growth-sqlite)/);
  const files = [...sources(join(root, "packages")), ...sources(join(root, "apps"))];
  const offenders = files.filter(path => !path.endsWith("/growth/ledger-service.ts") && !path.includes("/growth/store/") &&
    /(?:from|import\s*\()\s*["'][^"']*growth-sqlite(?:\.js)?["']/.test(readFileSync(path, "utf8")));
  expect(offenders).toEqual([]);
});

test("同意端口只有提交同意方法，普通端口没有裸提交入口", () => {
  const db = openLearningDatabase(":memory:");
  try {
    const ledger = GrowthLedgerService.open({ db, clock: () => 10 });
    expect(Object.keys(ledger.assentPort())).toEqual(["recordAssent"]);
    for (const port of [ledger.sessionPort(), ledger.parentPort(), ledger.childPort()]) {
      expect(port).not.toHaveProperty("recordAssent");
      expect(port).not.toHaveProperty("commitRecord");
      expect(port).not.toHaveProperty("store");
    }
  } finally { db.close(); }
});

test("档1作品无需同意且不能携带结论，模型描述不进入任一提案存储", () => {
  const db = openLearningDatabase(":memory:");
  try {
    const ledger = GrowthLedgerService.open({ db, clock: () => 10 });
    const artifact = { learnerId: "kid", artifactId: "a", artifactVersionId: "av", sessionId: "s", discipline: "fake",
      versionNo: 1, writer: "host_snapshot" as const, contentRef: "session:s", contentHash: "hash", payload: { text: "我今天粗心" } };
    expect(ledger.sessionPort().ingestArtifactVersion(artifact)).toEqual({ artifactVersionId: "av" });
    expect(() => ledger.sessionPort().ingestArtifactVersion({ ...artifact, payload: { claim: "结论" } })).toThrow("t1.noCapabilityClaim");
    expect(db.prepare("SELECT count(*) AS n FROM memory_decisions").get()?.n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM growth_records").get()?.n).toBe(0);
    for (const store of [new InMemorySessionStore(), new SqliteSessionStore(db)]) {
      store.saveProposal("s", { proposalId: "p", accepted: false, reasons: [], decidedAt: 10,
        proposal: { proposalId: "p", spokenResponse: "试一试", learnerTask: "试一试", hintLevel: 0, canvasActions: [], expectedEvidence: [],
          memoryCandidate: { description: "ZZQQ-MEMORY-DESCRIPTION-9911", evidenceEventIds: [] } } });
      expect(JSON.stringify(store.listProposals("s"))).not.toContain("ZZQQ-MEMORY-DESCRIPTION-9911");
    }
  } finally { db.close(); }
});
