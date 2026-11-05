import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { errorFromCause, success } from "@/lib/responseFormat";
import u from "@/utils";
import { videoGenerationSchema } from "@/utils/media/schemas";
import type { GeneratedMedia, MediaGenerationRequest } from "@toonflow/tools-scaffold/runtime";

// ACT: 所有生成共用素材目录，单进程串行归档；进程重启不恢复排队请求。
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
const fields = {
  prompt: z.string().trim().min(1).max(20000),
  providerId: z.string().regex(/^[a-z][a-zA-Z0-9]{0,95}$/),
  modelId: z.string().trim().min(1).max(256),
  mediaType: z.enum(["image", "video"]).optional(),
  size: z.string().trim().min(1).max(64).optional(),
  ratio: videoGenerationSchema.shape.ratio,
  n: z.number().int().min(1).max(4).optional(),
  images: z.array(reference).max(64).optional(),
  audios: z.array(z.strictObject({
    path: z.string().regex(u.onlineImage.onlineAudioReferencePath),
    mimeType: z.string().regex(u.onlineImage.onlineAudioReferenceMime),
  })).max(64).optional(),
  videos: z.array(z.strictObject({
    path: z.string().regex(u.onlineImage.onlineVideoReferencePath),
    mimeType: z.string().regex(u.onlineImage.onlineVideoReferenceMime),
  })).max(10).optional(),
  referenceOrder: videoGenerationSchema.shape.referenceOrder,
  resolution: videoGenerationSchema.shape.resolution,
  duration: videoGenerationSchema.shape.duration,
  generateAudio: videoGenerationSchema.shape.generateAudio,
  mode: videoGenerationSchema.shape.mode,
  other: z.strictObject({
    videoOperation: z.enum(["generate", "edit", "extend"]).optional(),
    extensionDuration: z.union([z.literal(-1), z.number().int().min(4).max(30)]).optional(),
  }).optional(),
};

export default Router().post("/", validateFields(fields), async (req, res) => {
  const controller = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const close = () => { clearInterval(heartbeat); controller.abort(); };
  res.once("close", close);
  req.once("aborted", close);
  req.socket.once("close", close);
  const written: GeneratedMedia[] = [];
  try {
    res.set({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded && !res.writableNeedDrain) res.write("\n"); }, 20000);
    // 每个请求解析为独立快照，等待队列期间不再读取可变请求对象。
    const body = structuredClone(z.object(fields).parse(req.body));
    const { prompt, modelId, size } = body;
    const mediaType = body.mediaType ?? "image";
    const model = (await u.mediaGeneration.listMediaModels()).find(item => item.providerId === body.providerId && item.modelId === modelId && item.type === mediaType);
    if (!model) throw Object.assign(new Error("所选媒体模型不存在，请重新选择"), { status: 400 });
    if (mediaType === "image") {
      if (body.ratio === "adaptive" || body.audios?.length || body.videos?.length || body.referenceOrder?.length || body.other?.videoOperation && body.other.videoOperation !== "generate") {
        throw Object.assign(new Error("图片生成不支持视频参数"), { status: 400 });
      }
      if (model.imageReferences !== undefined && (body.images?.length ?? 0) > model.imageReferences) {
        throw Object.assign(new Error(`当前模型最多支持 ${model.imageReferences} 张参考图`), { status: 400 });
      }
    }
    const directory = await u.assets.getAssetsDirectory();
    const origin = `http://${req.get("host")}`;
    const sourceOrigin = req.get("origin");
    const localUi = req.hostname === "127.0.0.1" && ["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")
      && (sourceOrigin === undefined ? req.get("referer")?.startsWith(`${origin}/`) : sourceOrigin === origin);
    const createVideoTunnel = localUi ? req.app.locals.desktop?.createMediaVideoTunnel : undefined;
    if (body.videos?.length && !createVideoTunnel) throw Object.assign(new Error("本地视频生成需要在桌面客户端中操作"), { status: 400 });
    const request: MediaGenerationRequest = {
      providerId: body.providerId, modelId, prompt, outputDirectory: u.onlineImage.onlineOutputDirectory,
      size, ratio: body.ratio, images: body.images,
      ...(mediaType === "video" ? {
        audios: body.audios, referenceOrder: body.referenceOrder, resolution: body.resolution,
        duration: body.duration, generateAudio: body.generateAudio, mode: body.mode,
        videos: body.videos, other: body.other,
      } : {}),
    };
    const record = await enqueue(async () => {
      // 已停止的排队任务不得进入供应商提交步骤。
      controller.signal.throwIfAborted();
      for (let index = 0; index < (body.n ?? 1); index += 1) {
        controller.signal.throwIfAborted();
        const files = await u.mediaGeneration.generateMedia(directory, mediaType, request, controller.signal, undefined, createVideoTunnel);
        written.push(...files);
        if (files.some(file => !u.onlineImage.onlineOutputPath.test(file.path))) throw new Error("生成结果路径无效");
      }
      const created = {
        id: crypto.randomUUID(), createdAt: Date.now(), prompt, mediaType,
        providerId: model.providerId, providerLabel: (model.providerLabel.trim() || model.providerId).slice(0, 256),
        modelId: model.modelId, modelLabel: (model.label.trim() || model.modelId).slice(0, 256),
        ...(size ? { size } : {}),
        ...(body.ratio ? { ratio: body.ratio } : {}),
        ...(mediaType === "video" ? {
          resolution: body.resolution, duration: body.duration, generateAudio: body.generateAudio,
          audios: body.audios ?? [], videos: body.videos ?? [], referenceOrder: body.referenceOrder,
          other: body.other, mode: body.mode,
        } : {}),
        // ACT: 沿用 images 作为生成结果集合，旧图片历史与前端字段保持兼容。
        images: written.map(file => ({ path: file.path, mimeType: file.mimeType })),
        references: body.images ?? [],
      };
      await u.onlineImage.appendOnlineImageHistory(created);
      return created;
    });
    if (!res.destroyed) res.write(JSON.stringify(success(record)));
  } catch (err) {
    // ACT: 归档失败保留已生成素材，不调用可能触及线上资源的删除入口。
    if (!res.destroyed) res.write(JSON.stringify(errorFromCause(err)));
  } finally {
    clearInterval(heartbeat);
    res.off("close", close);
    req.off("aborted", close);
    req.socket.off("close", close);
    res.end();
  }
});
