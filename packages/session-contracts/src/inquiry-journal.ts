import { z } from "zod";
import { workspaceIdSchema } from "./workspace-learning.js";

export const inquiryKindSchema = z.enum(["observation", "question", "conjecture", "representation", "strategy", "verification", "transfer", "reflection"]);
const statement = z.string().trim().min(1).max(4000);
export const inquiryEntrySchema = z.strictObject({
  entryId: workspaceIdSchema,
  kind: inquiryKindSchema,
  author: z.enum(["child", "parent"]),
  text: statement,
  evidenceIds: z.array(workspaceIdSchema).max(20),
  revises: workspaceIdSchema.optional(),
  transfer: z.strictObject({ context: statement, method: statement, check: statement, outcome: statement }).optional(),
}).refine(e => (e.kind === "transfer") === !!e.transfer, "迁移需要记录新情境、方法、检验及实际结果");
export const inquiryJournalSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  entries: z.array(inquiryEntrySchema).max(500),
});
export type InquiryEntry = z.infer<typeof inquiryEntrySchema>;
export type InquiryJournal = z.infer<typeof inquiryJournalSchema>;
