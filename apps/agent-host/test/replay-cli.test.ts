// apps/agent-host/test/replay-cli.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { runReplay } from "../src/replay-cli.js";

const script = JSON.parse(readFileSync(new URL("../fixtures/scripted-happy-path.json", import.meta.url), "utf8"));
const childEvents = JSON.parse(readFileSync(new URL("../fixtures/child-events-help-path.json", import.meta.url), "utf8"));

describe("脚本回放", () => {
  test("求助两次 → 两级提示 → 独立算出 → 讲回 → 无提示迁移成功 → COMPLETED", async () => {
    const trace = await runReplay({ script, childEvents });
    expect(trace.finalState).toBe("COMPLETED");
    expect(trace.hintLevels).toEqual([1, 2]);
    expect(trace).toMatchObject({ maxHintLevelUsed: 2, independentSuccess: true, assistedRound: false, policyErrors: 0 });
    expect(trace.outbound.filter((m) => m.type === "speak").map((m) => (m as { text: string }).text)).toEqual(["你现在已经确定了什么？", "0.3 还能换成什么说法？"]);
  });
  test("迁移答错以 SOFT_LANDING 结束", async () => {
    const wrong = { ...childEvents, steps: [...childEvents.steps.slice(0, -1), { atMs: 100000, payload: { type: "ANSWER", text: "14" } }] };
    const trace = await runReplay({ script, childEvents: wrong });
    expect(trace.finalState).toBe("SOFT_LANDING");
  });
});
