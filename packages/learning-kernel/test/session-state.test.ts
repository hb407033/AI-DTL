// packages/learning-kernel/test/session-state.test.ts
import { describe, expect, test } from "vitest";
import { ACTIVE_STATES, createSessionContext, transition, type SessionState, type Signal } from "../src/session-state.js";

function at(state: SessionState, patch: Partial<ReturnType<typeof createSessionContext>> = {}) {
  return { ...createSessionContext(), state, ...patch };
}

// 设计稿 5.0 表逐行对照：[起始状态, 信号, 目标状态]
const legal: Array<[SessionState, Signal, SessionState]> = [
  ["PREPARING", { kind: "challengeValidated" }, "INDEPENDENT"],
  ["PREPARING", { kind: "curriculumInsufficient" }, "WAITING_PARENT"],
  ["INDEPENDENT", { kind: "childOutput", isNewStrategy: true }, "INDEPENDENT"],
  ["INDEPENDENT", { kind: "windowExpired" }, "ASSESSING"],
  ["INDEPENDENT", { kind: "childDone" }, "EXPLAIN_BACK"],
  ["INDEPENDENT", { kind: "hardCapReached" }, "ASSESSING"],
  ["ASSESSING", { kind: "assessedRecoverable" }, "INTERVENING"],
  ["ASSESSING", { kind: "assessedIndependentSolution" }, "EXPLAIN_BACK"],
  ["ASSESSING", { kind: "assessedBudgetExhausted" }, "SOFT_LANDING"],
  ["INTERVENING", { kind: "childOutput", isNewStrategy: true }, "INDEPENDENT"],
  ["INTERVENING", { kind: "noNewOutputWillingToContinue" }, "ASSESSING"],
  ["INTERVENING", { kind: "demoIssued" }, "RECONSTRUCT"],
  ["INTERVENING", { kind: "budgetExhausted" }, "SOFT_LANDING"],
  ["RECONSTRUCT", { kind: "reconstructDone" }, "EXPLAIN_BACK"],
  ["RECONSTRUCT", { kind: "reconstructStuck" }, "SOFT_LANDING"],
  ["EXPLAIN_BACK", { kind: "explainBackPassed" }, "TRANSFER"],
  ["EXPLAIN_BACK", { kind: "explainBackRevealedGap" }, "ASSESSING"],
  ["TRANSFER", { kind: "transferSucceeded", hasMemoryCandidate: true }, "MEMORY_PENDING"],
  ["TRANSFER", { kind: "transferSucceeded", hasMemoryCandidate: false }, "COMPLETED"],
  ["TRANSFER", { kind: "transferFailed" }, "SOFT_LANDING"],
  ["MEMORY_PENDING", { kind: "memoryAssent", choice: "record" }, "COMPLETED"],
  ["MEMORY_PENDING", { kind: "memoryAssent", choice: "unsure" }, "COMPLETED"],
  ["MEMORY_PENDING", { kind: "memoryAssent", choice: "disagree" }, "CONTESTED"],
  ["SOFT_LANDING", { kind: "softLandingChoice", choice: "simpler" }, "PREPARING"],
  ["SOFT_LANDING", { kind: "softLandingChoice", choice: "hint" }, "INTERVENING"],
  ["SOFT_LANDING", { kind: "softLandingChoice", choice: "stop" }, "COMPLETED"],
  ["WAITING_PARENT", { kind: "parentConfirmedMaterial" }, "PREPARING"],
  ["CONTESTED", { kind: "contestNewTask" }, "PREPARING"],
  ["CONTESTED", { kind: "contestVerificationDone", hasCandidate: true }, "MEMORY_PENDING"],
  ["CONTESTED", { kind: "contestVerificationDone", hasCandidate: false }, "COMPLETED"],
  ["COMPLETED", { kind: "nextChallenge" }, "PREPARING"],
];

describe("5.0 转换表：合法转换", () => {
  for (const [from, signal, to] of legal) {
    test(`${from} + ${signal.kind} → ${to}`, () => {
      const r = transition(at(from, { substantiveAttempts: 1 }), signal);
      expect(r.ok).toBe(true);
      expect(r.context.state).toBe(to);
    });
  }

  test("PREPARING → INDEPENDENT 创建检查点并把提示级别归零", () => {
    const r = transition(at("PREPARING", { hintLevel: 3 }), { kind: "challengeValidated" });
    expect(r.actions).toEqual(["createCheckpoint", "resetHintLevel"]);
    expect(r.context.hintLevel).toBe(0);
  });

  test("INTERVENING 收到新产出：撤去提示，级别回 0，但历史最高级别保留", () => {
    const r = transition(at("INTERVENING", { hintLevel: 2, maxHintLevelUsed: 2 }), { kind: "childOutput", isNewStrategy: true });
    expect(r.context).toMatchObject({ state: "INDEPENDENT", hintLevel: 0, maxHintLevelUsed: 2, newOutputSinceLastHint: true, substantiveAttempts: 1 });
    expect(r.actions).toContain("withdrawHint");
  });

  test("INDEPENDENT 的非新策略产出留在原状态且不产生动作", () => {
    const r = transition(at("INDEPENDENT"), { kind: "childOutput", isNewStrategy: false });
    expect(r.ok).toBe(true);
    expect(r.context.state).toBe("INDEPENDENT");
    expect(r.actions).toEqual([]);
  });

  test("软着陆出口置位 assisted_round，COMPLETED → PREPARING 清零", () => {
    const soft = transition(at("SOFT_LANDING"), { kind: "softLandingChoice", choice: "simpler" });
    expect(soft.context.assistedRound).toBe(true);
    const next = transition(at("COMPLETED", { assistedRound: true, hintLevel: 2 }), { kind: "nextChallenge" });
    expect(next.context).toMatchObject({ assistedRound: false, hintLevel: 0 });
  });

  test("硬预算耗尽进入 SOFT_LANDING 同样置位 assisted_round", () => {
    const r = transition(at("INTERVENING"), { kind: "budgetExhausted" });
    expect(r.context).toMatchObject({ state: "SOFT_LANDING", assistedRound: true });
  });
});

describe("5.0 元规则：儿童控制权事件在任意活动状态必须被接受", () => {
  for (const state of ACTIVE_STATES) {
    test(`${state} 接受 pauseRequest / helpRequest / contest`, () => {
      const paused = transition(at(state), { kind: "pauseRequest" });
      expect(paused.ok).toBe(true);
      expect(paused.context).toMatchObject({ state: "PAUSED_CHILD", priorState: state });

      const help = transition(at(state), { kind: "helpRequest" });
      expect(help.ok).toBe(true);
      expect(help.context.state).toBe("ASSESSING");
      expect(help.context.helpRequestedSinceLastHint).toBe(true);

      const contest = transition(at(state), { kind: "contest", targetId: "p-9" });
      expect(contest.ok).toBe(true);
      expect(contest.context.state).toBe(state);
      expect(contest.context.frozenTargetIds).toEqual(["p-9"]);
      expect(contest.actions).toEqual(["stopDiagnosticQuestions", "freezeTeaching", "askWhereDiffers"]);
    });
  }

  test("暂停后继续回到原活动状态且不继承可见提示", () => {
    const paused = transition(at("EXPLAIN_BACK", { hintLevel: 2 }), { kind: "pauseRequest" });
    const resumed = transition(paused.context, { kind: "resume" });
    expect(resumed.context).toMatchObject({ state: "EXPLAIN_BACK", priorState: null, hintLevel: 0 });
    expect(resumed.actions).toEqual(["restoreContextNoHint"]);
  });

  test("转写不确定进入 WAITING_CONFIRMATION，确认或超时都回原状态", () => {
    const waiting = transition(at("INDEPENDENT"), { kind: "transcriptUncertain" });
    expect(waiting.context).toMatchObject({ state: "WAITING_CONFIRMATION", priorState: "INDEPENDENT" });
    expect(transition(waiting.context, { kind: "transcriptConfirmed" }).context.state).toBe("INDEPENDENT");
    const timeout = transition(waiting.context, { kind: "confirmationTimeout" });
    expect(timeout.context.state).toBe("INDEPENDENT");
    expect(timeout.actions).toEqual(["keepUnconfirmed"]);
  });

  test("技术中断：检查点一致回原状态，不一致回 PREPARING", () => {
    const paused = transition(at("TRANSFER"), { kind: "techInterrupted" });
    expect(paused.context.state).toBe("PAUSED_TECH");
    expect(transition(paused.context, { kind: "techRecovered", checkpointConsistent: true }).context.state).toBe("TRANSFER");
    const restart = transition(paused.context, { kind: "techRecovered", checkpointConsistent: false });
    expect(restart.context.state).toBe("PREPARING");
    expect(restart.actions).toEqual(["restartFromSnapshot"]);
  });
});

describe("未列出的转换默认拒绝并记录策略错误", () => {
  test("COMPLETED 收到孩子产出被拒绝，状态不变", () => {
    const r = transition(at("COMPLETED"), { kind: "childOutput", isNewStrategy: true });
    expect(r.ok).toBe(false);
    expect(r.context.state).toBe("COMPLETED");
    expect(r.context.policyErrors).toEqual([{ code: "unlistedTransition", from: "COMPLETED", signal: "childOutput" }]);
  });

  test("PAUSED_CHILD 不接受求助（非活动状态，先继续再说）", () => {
    const r = transition(at("PAUSED_CHILD", { priorState: "INDEPENDENT" }), { kind: "helpRequest" });
    expect(r.ok).toBe(false);
  });

  test("演示前必须有过实质性尝试", () => {
    const r = transition(at("INTERVENING", { substantiveAttempts: 0 }), { kind: "demoIssued" });
    expect(r.ok).toBe(false);
    expect(r.context.policyErrors[0]?.code).toBe("guardFailed");
  });
});
