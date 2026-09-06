import { describe, expect, test } from "vitest";
import { screenChildFacingText } from "../../src/growth/forbidden-labels.js";
import { renderChildFacingText, renderEvidenceSummaryText, renderScaffoldLine, type DiscreteCounts } from "../../src/growth/child-text.js";

// 孩子读到的每一句都由模板拼装，模板里只有连接词与整数；具体的词来自插件。
// 家长与模型因此在结构上写不出一句孩子没看过的话（设计稿 §2.7、规范 9.5）。
const counts: DiscreteCounts = {
  supportingChallenges: 3, refutingChallenges: 0, distinctSurfaceContexts: 2,
  independentTransferSuccesses: 2, hintedSuccesses: 1,
};

describe("儿童版文案", () => {
  test("拟写入的那句话由插件短语与整数拼成，没有自由描述", () => {
    const text = renderChildFacingText({ childFacingGoalPhrase: "说清楚这一步为什么成立", surfaceContextLabel: "换了数字的这种题", counts });
    expect(text).toBe("换了数字的这种题里，说清楚这一步为什么成立这件事，你自己做出来了 2 次。");
  });

  test("证据摘要只报数，不下判断", () => {
    expect(renderEvidenceSummaryText({ counts, selfCorrectionRuns: 1 }))
      .toBe("我看到的是：一共 3 次这样的题，其中 2 次你一点提示都没用；有 1 次是你自己发现不对再改过来的。");
  });

  test("脚手架那句是中性呈现：两个整数，不是分数也不是排名", () => {
    const line = renderScaffoldLine(2, 5);
    expect(line).toBe("最近这些题，你自己做出来了 2 次，一共做了 5 次。");
    expect(line).not.toMatch(/分|名|等级|排/);
  });

  test("模板渲染出的四段文字过得了禁止标签筛查", () => {
    const hits = screenChildFacingText({
      childFacingText: renderChildFacingText({ childFacingGoalPhrase: "说清楚这一步为什么成立", surfaceContextLabel: "换了数字的这种题", counts }),
      evidenceSummaryText: renderEvidenceSummaryText({ counts, selfCorrectionRuns: 1 }),
      targetObjectLabel: "换了数字的这种题", scopeLabel: "这一族题目",
    }, []);
    expect(hits).toEqual([]);
  });

  test("计数为 0 时话也说得通，不出现负数或空洞", () => {
    const zero: DiscreteCounts = { supportingChallenges: 0, refutingChallenges: 0, distinctSurfaceContexts: 0, independentTransferSuccesses: 0, hintedSuccesses: 0 };
    expect(renderChildFacingText({ childFacingGoalPhrase: "试着自己检查一遍", surfaceContextLabel: "这种题", counts: zero })).toContain("0 次");
    expect(renderEvidenceSummaryText({ counts: zero, selfCorrectionRuns: 0 })).not.toMatch(/undefined|NaN|-/);
  });
});
