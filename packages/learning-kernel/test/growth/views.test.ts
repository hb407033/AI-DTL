import { expect, test } from "vitest";
import { childFacingView, parentFacingView, agentFacingView } from "../../src/growth/views.js";
import { fakePlugin } from "../helpers/fake-plugin.js";

test("孩子投影保留五类内容与异议目标，不泄露计数、家长标签和推理", () => {
  const view = childFacingView({ events: [], records: [], points: [], artifacts: [], manifest: fakePlugin.manifest,
    hypotheses: [{ hypothesisKey: "h1", discipline: "fake", status: "suspected", stopsDrivingPersonalization: false,
      counts: { supportingChallenges: 2, refutingChallenges: 0, distinctSurfaceContexts: 2, independentTransferSuccesses: 0, hintedSuccesses: 0 },
      lastObservedAt: 1, expiresAt: 999 }], deletionRequests: [], firstUseAcknowledged: true });
  expect(Object.keys(view)).toEqual(["myQuestions", "myExplorations", "myArtifacts", "myCorrectedGuesses", "myNewMethods", "activeGuesses", "scaffoldLine", "records", "deletionRequests", "firstUseAcknowledged"]);
  expect(view.activeGuesses[0]?.text).toBe(fakePlugin.manifest.hypothesisCatalog[0]?.childFacingGuess);
  expect(JSON.stringify(view)).not.toMatch(/hypothesisKey|counts|nextVerification|hintHistory|关系表征断点/);
  expect(view.activeGuesses[0]?.contestTarget).toEqual({ kind: "hypothesis", id: "h1" });
});

test("家长与Agent投影分开，空档案仍有可用视图", () => {
  const input = { hypotheses: [], points: [], records: [] };
  expect(parentFacingView(input)).toHaveProperty("discussionQuestions");
  expect(agentFacingView(input)).toHaveProperty("hintHistory");
  expect(parentFacingView(input)).not.toHaveProperty("hintHistory");
});
