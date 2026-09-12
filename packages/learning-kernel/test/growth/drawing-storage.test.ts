import { expect, test } from "vitest";
import { openLearningDatabase } from "../../src/growth/database.js";
import { GrowthLedgerService } from "../../src/growth/ledger-service.js";

test("BLOB 与版本删除同事务，失败回滚保留两者，删除墓碑阻止再上传", () => {
  const db = openLearningDatabase(":memory:"), ledger = GrowthLedgerService.open({ db, clock: () => 1 });
  try {
    ledger.sessionPort().ingestArtifactVersion({ learnerId: "child", artifactId: "art", artifactVersionId: "v1", sessionId: "session", discipline: "math", versionNo: 1, writer: "host_snapshot", contentRef: "session:session", contentHash: "hash", payload: {} });
    const port = ledger.drawingPort();
    port.save("child", "session", "revision", Buffer.from("drawing"), Buffer.from("preview"));
    const parent = ledger.parentPort(), subject = { kind: "artifact" as const, id: "art" };
    db.exec("CREATE TRIGGER fail_drawing_delete BEFORE DELETE ON drawing_blobs BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
    expect(() => parent.executeDeletion("child", subject, parent.deletionPreview("child", subject).preview)).toThrow("injected failure");
    expect(port.restore("child", "session")?.revision).toBe("revision");
    db.exec("DROP TRIGGER fail_drawing_delete");
    parent.executeDeletion("child", subject, parent.deletionPreview("child", subject).preview);
    expect(db.prepare("SELECT count(*) AS n FROM drawing_blobs").get()?.n).toBe(0);
    expect(() => port.save("child", "session", "revision2", Buffer.from("drawing"), Buffer.from("preview"))).toThrow("drawingDeleted");
  } finally { ledger.close(); }
});

test("画布首次归属稳定，同会话后续作品删除也清掉共享原画布", () => {
  const db = openLearningDatabase(":memory:"), ledger = GrowthLedgerService.open({ db, clock: () => 1 });
  try {
    const add = (artifactId: string) => ledger.sessionPort().ingestArtifactVersion({ learnerId: "child", artifactId, artifactVersionId: artifactId + "-v1", sessionId: "session", discipline: "math", versionNo: 1, writer: "host_snapshot", contentRef: "session:session", contentHash: "hash", payload: {} });
    add("z-first");
    const port = ledger.drawingPort();
    expect(port.save("child", "session", "one", Buffer.from("drawing"), Buffer.from("preview")).artifactId).toBe("z-first");
    add("a-later");
    expect(port.save("child", "session", "two", Buffer.from("drawing2"), Buffer.from("preview2")).artifactId).toBe("z-first");
    const parent = ledger.parentPort(), subject = { kind: "artifact" as const, id: "a-later" };
    parent.executeDeletion("child", subject, parent.deletionPreview("child", subject).preview);
    expect(port.preview("child", "z-first")).toBeNull();
    expect(db.prepare("SELECT count(*) AS n FROM drawing_blobs").get()?.n).toBe(0);
  } finally { ledger.close(); }
});
