import { z } from "zod";

/** 拒绝识别器的服务说明，不把非空字符串等同于题干。兼容旧单题识别器。 */
export function isRecognitionNotice(text: string): boolean {
  return /(?:请|建议|需要|无法|不能|看不清|识别不到|识别到).{0,100}(?:重新拍|重拍|只拍一道|只包含这道|包含多道|无法识别|看不清)|^(?:请重新拍照|无法识别|看不清|图片模糊|照片模糊)/u.test(text);
}

const resultSchema = z.strictObject({ status: z.enum(["single", "multiple", "unreadable"]),
  candidates: z.array(z.string().trim().min(1).max(8000)).max(12), message: z.string().max(1000) });
export function parsePhotoRecognition(raw: string) {
  const text = raw.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "");
  if (!text || text.length > 16000) throw Error("invalidRecognition");
  if (!text.startsWith("{")) {
    if (isRecognitionNotice(text) || (text.match(/(?:^|\n)\s*[（(]?\d+[）).、]/gu) ?? []).length > 1) {
      return { status: "unreadable" as const, candidates: [], message: "还没有识别出可核对的题意，请重新拍清楚，或手动写下问题。" };
    }
    if (text.length > 8000) throw Error("invalidRecognition");
    return { status: "single" as const, candidates: [text], message: "请对照照片核对题意。" };
  }
  const result = resultSchema.parse(JSON.parse(text));
  if (result.status === "single" && result.candidates.length !== 1
    || result.status === "multiple" && result.candidates.length < 2
    || result.status === "unreadable" && result.candidates.length !== 0
    || result.candidates.some(isRecognitionNotice)) throw Error("invalidRecognition");
  return { ...result, message: result.status === "multiple" ? "照片里有多道题，请先选一道，再核对题意。"
    : result.status === "unreadable" ? "题目还没看清，请重拍或手动写下问题；照片已保留。" : "请对照照片核对题意。" };
}
