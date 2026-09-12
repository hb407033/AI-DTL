import { expect, test } from "vitest";
import { PERMISSION_MATRIX } from "../../src/growth/permission-matrix.js";
import { openLearningDatabase } from "../../src/growth/database.js";
import { GrowthLedgerService } from "../../src/growth/ledger-service.js";
import { ScriptedReplayBridge } from "../../src/bridges/scripted-replay-bridge.js";
import { fakePlugin } from "../helpers/fake-plugin.js";

const cells: Array<{ actor: string; column: string; allow: readonly string[] }> = Object.entries(PERMISSION_MATRIX).flatMap(([actor, columns]) => Object.entries(columns).map(([column, allow]) => ({ actor, column, allow })));
test("职责矩阵确有25格，确认记录只有服务门禁入口", () => {
  expect(cells).toHaveLength(25);
  expect(cells.filter(cell => cell.allow.some(action => action.startsWith("commit"))).map(cell => cell.actor)).toEqual(["service", "service"]);
});
test.each(cells)("$actor × $column 的端口不暴露裸存储/任意提交", ({ actor, column, allow }) => {
  const db = openLearningDatabase(":memory:");
  try {
    const ledger = GrowthLedgerService.open({ db, clock: () => 10 });
    const target = actor === "child" ? ledger.childPort() : actor === "parent" ? ledger.parentPort() : actor === "plugin" ? fakePlugin : actor === "bridge" ? new ScriptedReplayBridge({ scriptVersion: 1, turns: [] }) : ledger;
    expect(target).not.toHaveProperty("commitRecord"); expect(target).not.toHaveProperty("store"); expect(target).not.toHaveProperty("writeRecord");
    if (actor === "child" && column === "rights") { expect(target).toHaveProperty("requestDeletion"); expect(target).not.toHaveProperty("executeDeletion"); }
    if (actor === "parent" && column === "trends") { expect(allow).toEqual(["review"]); expect(target).toHaveProperty("review"); expect(target).not.toHaveProperty("correctTrend"); }
    if (actor === "parent" && column === "artifacts") expect(ledger.parentPort().exportArchive("kid")).toHaveProperty("exportedAt", 10);
    if (!allow.length) { expect(target).not.toHaveProperty("recordAssent"); expect(target).not.toHaveProperty("executeDeletion"); }
  } finally { db.close(); }
});
