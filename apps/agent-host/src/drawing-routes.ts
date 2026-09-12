import type { FastifyInstance } from "fastify";
import type { GrowthLedgerService } from "@ai-scholar/learning-kernel";
import { z } from "zod";
import { validatePreviewPNG } from "./png-preview.js";

// PencilKit is opaque on Mac: enforce transport bounds; the native client validates decoding.
const schema = z.object({ revision: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/), drawing: z.string().max(6_000_000), preview: z.string().max(3_000_000) }).strict();
function decode(value: string, limit: number) {
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > limit || bytes.toString("base64") !== value) throw new Error("invalidDrawingPayload");
  return bytes;
}
export function registerDrawingRoutes(child: FastifyInstance, parent: FastifyInstance, ledger: GrowthLedgerService) {
  const port = ledger.drawingPort();
  const status = (error: unknown) => String(error).includes("Deleted") ? 410 : String(error).includes("NotFound") ? 404 : String(error).includes("invalid") ? 400 : 409;
  child.put("/child/sessions/:id/drawing", { bodyLimit: 9_100_000 }, async (request, reply) => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalidDrawingPayload" });
    try {
      const { revision, drawing, preview } = parsed.data;
      const bytes = decode(preview, 2_000_000);
      validatePreviewPNG(bytes);
      return port.save("child-1", (request.params as { id: string }).id, revision, decode(drawing, 4_000_000), bytes);
    } catch (error) { return reply.code(status(error)).send({ error: error instanceof Error ? error.message : "drawingFailed" }); }
  });
  child.get("/child/sessions/:id/drawing", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return port.restore("child-1", (request.params as { id: string }).id) ?? reply.code(404).send({ error: "drawingNotFound" }); }
    catch (error) { return reply.code(status(error)).send({ error: error instanceof Error ? error.message : "drawingFailed" }); }
  });
  parent.get("/parent/artifacts/:id/drawing-preview", async (request, reply) => {
    const data = port.preview("child-1", (request.params as { id: string }).id);
    reply.header("Cache-Control", "no-store");
    return data ? reply.type("image/png").send(data) : reply.code(404).send({ error: "drawingNotFound" });
  });
}
