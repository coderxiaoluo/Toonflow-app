import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { errorFromCause, success } from "@/lib/responseFormat";
import u from "@/utils";
import type { GeneratedMedia } from "@toonflow/tools-scaffold/runtime";

// ACT: 出图写入同一个素材目录，目录锁不能并发。请求在单进程里排队。
let generationQueue = Promise.resolve();
function enqueue<T>(task: () => Promise<T>) {
  const result = generationQueue.then(task, task);
  generationQueue = result.then(() => undefined, () => undefined);
  return result;
}

const reference = z.strictObject({
  path: z.string().regex(u.onlineImage.onlineReferencePath),
  mimeType: z.string().regex(u.onlineImage.onlineReferenceMime),
});

export default Router().post("/", validateFields({
  prompt: z.string().trim().min(1).max(20000),
  providerId: z.string().regex(/^[a-z][a-zA-Z0-9]{0,95}$/),
  modelId: z.string().trim().min(1).max(256),
  size: z.string().trim().min(1).max(64).optional(),
  ratio: z.string().regex(/^[1-9]\d{0,3}:[1-9]\d{0,3}$/).optional(),
  n: z.number().int().min(1).max(4).optional(),
  images: z.array(reference).max(3).optional(),
}), async (req, res) => {
  const controller = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const close = () => { clearInterval(heartbeat); controller.abort(); };
  res.once("close", close);
  req.once("aborted", close);
  req.socket.once("close", close);
  const written: GeneratedMedia[] = [];
  let saved = false;
  try {
    res.set({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded && !res.writableNeedDrain) res.write("\n"); }, 20000);
    const prompt = req.body.prompt.trim();
    const modelId = req.body.modelId.trim();
    const size = typeof req.body.size === "string" ? req.body.size.trim() : undefined;
    const model = (await u.mediaGeneration.listMediaModels()).find(item => item.providerId === req.body.providerId && item.modelId === modelId && item.type === "image");
    if (!model) throw Object.assign(new Error("所选图片模型不存在，请重新选择"), { status: 400 });
    const directory = await u.assets.getAssetsDirectory();
    const request = {
      providerId: req.body.providerId, modelId, prompt, outputDirectory: u.onlineImage.onlineOutputDirectory,
      ...(size ? { size } : {}),
      ...(req.body.ratio ? { ratio: req.body.ratio } : {}),
      ...(req.body.images?.length ? { images: req.body.images } : {}),
    };
    const record = await enqueue(async () => {
      for (let index = 0; index < (req.body.n ?? 1); index += 1) {
        controller.signal.throwIfAborted();
        const files = await u.mediaGeneration.generateMedia(directory, "image", request, controller.signal);
        written.push(...files);
        if (files.some(file => !u.onlineImage.onlineOutputPath.test(file.path))) throw new Error("生成结果路径无效");
      }
      const created = {
        id: crypto.randomUUID(), createdAt: Date.now(), prompt,
        providerId: model.providerId, providerLabel: (model.providerLabel.trim() || model.providerId).slice(0, 256),
        modelId: model.modelId, modelLabel: (model.label.trim() || model.modelId).slice(0, 256),
        ...(size ? { size } : {}),
        ...(req.body.ratio ? { ratio: req.body.ratio } : {}),
        images: written.map(file => ({ path: file.path, mimeType: file.mimeType })),
        references: req.body.images ?? [],
      };
      await u.onlineImage.appendOnlineImageHistory(created);
      saved = true;
      return created;
    });
    if (!res.destroyed) res.write(JSON.stringify(success(record)));
  } catch (err) {
    if (!saved) {
      await Promise.all(written.map(async file => {
        try { await u.assets.removeAsset(file.path); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("在线生图回滚失败", file.path, error); }
      }));
    }
    if (!res.destroyed) res.write(JSON.stringify(errorFromCause(err)));
  } finally {
    clearInterval(heartbeat);
    res.off("close", close);
    req.off("aborted", close);
    req.socket.off("close", close);
    res.end();
  }
});
