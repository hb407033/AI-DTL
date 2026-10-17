// 人工核验的三题包（2026-09-17 批准设计）：内容与验收夹具，不是会话编排逻辑。
// prompt 是孩子可见文案；verification 是人工核验依据，绝不默认下发；hints 与题干分开保存。
export const FRACTION_PACK_VERSION = "fraction-pack-2026-09-17-v1";

export type FractionChallengeRole = "explore" | "targeted" | "transfer";

export interface FractionChallenge {
  id: string;
  role: FractionChallengeRole;
  prompt: string;
  verification: string;
  hints: string[];
}

export const fractionPack: { version: string; challenges: FractionChallenge[] } = {
  version: FRACTION_PACK_VERSION,
  challenges: [
    {
      id: "fraction-compare-01",
      role: "explore",
      prompt: "两张同样大的纸，一张涂了 3/4，另一张涂了 2/3。哪张涂得更多？请画一画或说说你的理由。",
      verification: "3/4 = 9/12 > 8/12 = 2/3，涂 3/4 的更多；题目不给孩子通分步骤",
      hints: ["可以用下面的空白矩形，把两张纸分成同样多的小格，再数一数涂色的格子。"],
    },
    {
      id: "fraction-whole-01",
      role: "targeted",
      prompt: "两张同样大的纸，一张分成 2 等份涂了 1 份，另一张分成 4 等份涂了 2 份。涂色的面积一样吗？说说你的理由。",
      verification: "1/2 = 2/4，涂色面积一样大；只检验整体与等分表征，不诊断根因",
      hints: ["注意两张纸是一样大的。可以把它们画出来，比一比涂色部分。"],
    },
    {
      id: "fraction-transfer-01",
      role: "transfer",
      prompt: "两张同样大的纸，一张涂了 4/5，另一张涂了 3/4。哪张涂得更多？请独立说明你的依据。",
      verification: "4/5 = 16/20 > 15/20 = 3/4，涂 4/5 的更多",
      hints: ["想一想刚才：两个分数分母不一样的时候，你是怎么把它们变成同样份数再比较的？"],
    },
  ],
};

export function getChallenge(id: string): FractionChallenge | undefined {
  return fractionPack.challenges.find((c) => c.id === id);
}
