/** 小数除法专用提示词规则，从 workspace-teaching-decision.ts 搬迁，只在该题族注入。 */
import { preciseDivide } from "../decimal-division-policy.js";
import type { TeachingInput } from "../../ai/workspace-teaching-decision.js";

interface DivisionResult { a: number; b: number; power: number; answer: number; converted: string }
interface DivisionState {
  resolved: string[]; transfer: { statement: string; a: number; b: number; reported?: number; checked: boolean } | undefined;
  reported: number | undefined; operationCheck: string | undefined;
}

/** 返回命名规则槽位，调用方在原位置插入，保留通用规则之间的顺序及条件空行。 */
export function decimalDivisionPromptRules(
  d: DivisionResult, state: DivisionState | undefined, focus: string | undefined, options: string[],
  intent: { calculationFirst: boolean; calculationSteps: boolean },
  input: TeachingInput,
  mentionsNumber: (text: string, number: number) => boolean,
) {
  return {
    method: `实际题目是小数除法，不沿用资料里可能过时的小数乘法单元。主线是被除数和除数同时乘同一倍数${d.power}、商不变，转为${d.converted}。method必须scale_both。不教倒数、不将除以0.5转换为乘2，不把这种捷径作为解释。`,
    visibleSteps: "有可见步骤或口述计算，先承接已有正确部分；已经转换成整数就不退回让他重新估大估小。商不变理由未说明只限制理解结论，不规定每轮必须先追问理由；先接住当前计算、检验或澄清请求。不能只背口诀就宣布理解。",
    wrongQuotient: "若出现可核对的整数除法错商，先检查商的每一位是否有计算依据。零可能多余，不能问‘零该放在哪一位’暗示必须保留或挪动零；可核对这个零是否需要。不直接报正确商；如果本轮已自行修正，不能继续批评旧图错误。",
    progress: state ? `宿主已核对的理解证据=${state.resolved.join("、") || "尚无"}；本轮focus允许${options.join("或")}。transformation=同时变换两个数；invariance=为什么同时扩大后商不变；place_value=尝试整数计算或核对商的位值；verify=孩子选择办法核验；return=交还独立尝试。未解决证据不是强制提问顺序。` : "",
    focusChoice: options.includes("place_value") && options.length > 1 ? "本轮不要默认选invariance：孩子主动问原因就选invariance；否则准备动手算或试除就选place_value，给出正确商优先verify。选择看最新表达，不要求说出‘我想先算’这句暗号。理由未说明仍留待以后，不伪造理解，不机械卡住计算。" : "",
    transformationChoice: options.includes("transformation") && options.length > 1 ? "还没有孩子正确变换的证据。初次求助可选transformation，给一个具体小动作；不要求先证明商不变才能动手，不替孩子列完整转换式。" : "",
    calculationSteps: intent.calculationSteps && focus === "place_value" ? `孩子本轮具体要竖式/计算步骤：utterance须承接竖式或数位，只检查${d.converted}的一个书写/除法步骤。不要偷换成乘法检验，也不要直接演示完整竖式或报商。` : "",
    operationCheck: state?.operationCheck ? `完整操作待核对：孩子提出了补零，不能只肯定‘划掉小数点相当于乘10’。本轮只检查被除数${d.a}经过孩子整套操作会写成什么数，只问这一个结果；不同时追问除数、位置、条件或为什么。先不认定一定错，也不肯定整个规则。区分缺位补足与额外添零要在得到孩子具体操作后进行，不能在本轮堆成几个问题。` : "",
    verifiedWithoutReason: state?.resolved.includes("verify") && !state.resolved.includes("invariance") ? "计算已经核对一致但理由证据不足。孩子没有主动追问理由时选择return，简短交还独立尝试；不强迫再讲理由，不说已经懂了。不将这次交还当作完成理解验收。" : "",
    withholdAnswer: ![...input.history.map(h => h.child), input.child].some(text => mentionsNumber(text, preciseDivide((state?.transfer ?? d).a, (state?.transfer ?? d).b)))
      ? `孩子没有给出正确商，utterance不得说${preciseDivide((state?.transfer ?? d).a, (state?.transfer ?? d).b)}或其中文读法，也不得拆成商的各位数字暗示答案。` : "",
    inviteCalculation: focus === "place_value" && state?.reported === undefined ? "孩子尚未提供商，只邀请他尝试计算或说自己的步骤；不得预填商的2和5，不得假定商有百位。" : "",
    transfer: state?.transfer ? `孩子已另举新例${state.transfer.statement}，与原题分开核对。新例乘法检验${state.transfer.checked ? "已核对一致，交还独立尝试" : "还未核对一致，仅讨论新例中一处可检查点"}。不能把新例的答案当成原题的新答案，不能退回重问原题已解释的问题。` : "",
    reported: state?.reported !== undefined ? `孩子最近报告的商=${state.reported}；‘我改成某数’在这段计算上下文中是改商，不是把除数或被除数改成该数。不得混淆数学角色。` : "",
    quantityMeaning: "解释商不变时，总量和每份同时乘同一倍数，组数不变。不能说‘份数整体放大而每份大小没变’；换计数单位时真实数量未改变，但两边记录的数一起变了。",
    transformation: "transformation且review：只指出孩子两边变化不同，问另一边准备如何处理；不能直接替他说完整的转换式。hint也只给一处小动作，不一口气选倍数、改两数再列式。",
    checkInvitation: "孩子有结果后邀请用乘法检验：商×除数是否回到被除数。这不是除以0.5改乘2。孩子自己说明理由并完成检验后，交还独立尝试或提出一道同类小数除法检验迁移，不提供新题解答，不宣布掌握或标签化。",
    verify: "verify焦点下：review先问孩子自己想用什么办法检验，不能指定乘法算式替他选方法；hint权限才可以提醒商乘除数，仍由孩子计算。",
    operationAction: state?.operationCheck ? `本轮执行的唯一教学动作：请孩子给出${d.a}划点并补零后写出的数。utterance只用一句自然的提问，必须提到补零，只有一个问题和一个问号；不附加第二句问题，不先讲原理，不说‘对/正确’。其他焦点的提问指导本轮不执行。` : "",
  };
}

/** 非小数除法题的通用方法行。 */
export function nonDivisionMethodLine(): string {
  return "按当前题目和课程选择方法，不套用其他题型的固定提问。method用ordinary。";
}

/** 非小数除法题的通用检验邀请。 */
export function nonDivisionCheckInvitation(): string {
  return "孩子有结果后先邀请自己选择检验办法：估计范围、反向核对、代回关系、画小例子或改变一个条件均可，不能把某一题型的验算套给其他题。孩子已解释关系并自检后，邀请独立试一个小变化，再交还控制权，不宣布掌握。";
}

