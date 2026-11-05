import { readFile, writeAtomic } from "@toonflow/file";
import { dirname, join } from "node:path";
import conf from "@/utils/conf";
import { removeAsset } from "@/utils/assets";
import { z } from "zod";
import { videoGenerationSchema } from "@/utils/media/schemas";
import { validateVolcengineVideoUrl } from "@toonflow/providers/media/volcengineArk";
import type { MediaGenerationRequest } from "@toonflow/tools-scaffold/runtime";

export const onlineOutputDirectory = "在线生图";
export const onlineReferencePath = /^在线生图\/input\/ref[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff)$/i;
export const onlineReferenceMime = /^image\/(png|jpeg|webp|gif|avif|bmp|tiff)$/i;
export const onlineVideoReferencePath = /^在线生图\/input\/ref[0-9a-f-]{36}\.(mp4|mov|webm)$/i;
export const onlineVideoReferenceMime = /^video\/(mp4|quicktime|webm)$/i;
export const onlineAudioReferencePath = /^在线生图\/input\/ref[0-9a-f-]{36}\.(mp3|wav|ogg|webm|flac|aac|m4a|opus|pcm)$/i;
export const onlineAudioReferenceMime = /^audio\/(mpeg|wav|ogg|webm|flac|aac|mp4|opus|pcm)$/i;
export const onlineOutputPath = /^在线生图\/(?:image[0-9a-f-]{36}\.(?:png|jpe?g|webp|gif|avif|bmp|tiff)|video[0-9a-f-]{36}\.(?:mp4|webm|mov|ogv))$/i;

export type OnlineImageFile = { path: string; mimeType: string };
export type OnlineImageRecord = {
  id: string;
  createdAt: number;
  prompt: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  mediaType?: "image" | "video";
  size?: string;
  ratio?: string;
  resolution?: string;
  duration?: number;
  generateAudio?: boolean;
  images: OnlineImageFile[];
  references: OnlineImageFile[];
  audios?: OnlineImageFile[];
  videos?: OnlineImageFile[];
  videoUrls?: string[];
  referenceOrder?: MediaGenerationRequest["referenceOrder"];
  mode?: MediaGenerationRequest["mode"];
  other?: { videoOperation?: "generate" | "edit" | "extend"; sourceVideoUrl?: string; extensionDuration?: number };
};

const maxHistory = 5000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const providerPattern = /^[a-z][a-zA-Z0-9]{0,95}$/;
const ratioPattern = /^(?:adaptive|[1-9]\d{0,3}:[1-9]\d{0,3})$/;

function historyPath() {
  return join(dirname(conf.path), "onlineImageHistory.json");
}

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= max;
}

function fileOf(value: unknown, pathPattern: RegExp, mediaType = "image"): OnlineImageFile | undefined {
  if (!value || typeof value !== "object") return;
  const file = value as OnlineImageFile;
  if (typeof file.path !== "string" || typeof file.mimeType !== "string" || !pathPattern.test(file.path)) return;
  if (mediaType === "video" ? !/^video\/(mp4|webm|quicktime|ogg)$/i.test(file.mimeType) || (pathPattern === onlineOutputPath && !/\/video/.test(file.path))
    : mediaType === "audio" ? !onlineAudioReferenceMime.test(file.mimeType)
      : !onlineReferenceMime.test(file.mimeType) || /\/video/.test(file.path)) return;
  return { path: file.path, mimeType: file.mimeType };
}

export function asOnlineImageRecord(value: unknown): OnlineImageRecord | undefined {
  if (!value || typeof value !== "object") return;
  const record = value as OnlineImageRecord;
  const mediaType = record.mediaType ?? "image";
  if (mediaType !== "image" && mediaType !== "video") return;
  const images = Array.isArray(record.images) ? record.images.map(item => fileOf(item, onlineOutputPath, mediaType)) : [];
  const references = Array.isArray(record.references) ? record.references.map(item => fileOf(item, onlineReferencePath)) : [];
  if (!uuidPattern.test(record.id) || typeof record.createdAt !== "number" || !Number.isFinite(record.createdAt)) return;
  if (!text(record.prompt, 20000) || !providerPattern.test(record.providerId) || !text(record.providerLabel, 256)) return;
  if (!text(record.modelId, 256) || !text(record.modelLabel, 256)) return;
  if (record.size !== undefined && !text(record.size, 64)) return;
  if (record.ratio !== undefined && (typeof record.ratio !== "string" || !ratioPattern.test(record.ratio) || mediaType === "image" && record.ratio === "adaptive")) return;
  if (record.resolution !== undefined && !text(record.resolution, 64)) return;
  if (record.duration !== undefined && (!Number.isInteger(record.duration) || record.duration <= 0 || record.duration > 3600)) return;
  if (record.generateAudio !== undefined && typeof record.generateAudio !== "boolean") return;
  if (!images.length || images.length > 64 || images.some(item => !item) || references.length > 64 || references.some(item => !item)) return;
  const audios = record.audios === undefined ? [] : Array.isArray(record.audios) ? record.audios.map(item => fileOf(item, onlineAudioReferencePath, "audio")) : undefined;
  if (!audios || audios.length > 64 || audios.some(item => !item)) return;
  const videos = record.videos === undefined ? [] : Array.isArray(record.videos) ? record.videos.map(item => fileOf(item, onlineVideoReferencePath, "video")) : undefined;
  if (!videos || videos.length > 64 || videos.some(item => !item)) return;
  if (!videoGenerationSchema.shape.referenceOrder.safeParse(record.referenceOrder).success || !videoGenerationSchema.shape.mode.safeParse(record.mode).success) return;
  const other = z.strictObject({
    videoOperation: z.enum(["generate", "edit", "extend"]).optional(),
    sourceVideoUrl: z.string().max(8192).optional(),
    extensionDuration: z.union([z.literal(-1), z.number().int().min(4).max(30)]).optional(),
  }).optional().safeParse(record.other);
  if (!other.success) return;
  let videoUrls: string[] = [];
  try {
    if (record.videoUrls !== undefined) {
      if (!Array.isArray(record.videoUrls) || record.videoUrls.length > 64) return;
      videoUrls = record.videoUrls.map(url => validateVolcengineVideoUrl(url));
    }
    if (other.data?.sourceVideoUrl !== undefined) validateVolcengineVideoUrl(other.data.sourceVideoUrl);
  } catch { return; }
  if (record.referenceOrder?.some(reference => !("index" in reference) || !({ image: references, video: videos.length ? videos : videoUrls, audio: audios }[reference.type]?.[reference.index]))) return;
  if (mediaType === "video" && [...record.prompt.matchAll(/\{\{ref (\d+)\}\}/g)].some(match => !record.referenceOrder?.[Number(match[1]) - 1])) return;
  return {
    id: record.id, createdAt: record.createdAt, prompt: record.prompt,
    providerId: record.providerId, providerLabel: record.providerLabel,
    modelId: record.modelId, modelLabel: record.modelLabel,
    mediaType,
    ...(record.resolution ? { resolution: record.resolution } : {}),
    ...(record.duration !== undefined ? { duration: record.duration } : {}),
    ...(record.generateAudio !== undefined ? { generateAudio: record.generateAudio } : {}),
    ...(mediaType === "video" ? {
      audios: audios as OnlineImageFile[], videos: videos as OnlineImageFile[], videoUrls, referenceOrder: record.referenceOrder, mode: record.mode, other: other.data,
    } : {}),
    ...(record.size ? { size: record.size } : {}),
    ...(record.ratio ? { ratio: record.ratio } : {}),
    images: images as OnlineImageFile[],
    references: references as OnlineImageFile[],
  };
}

async function readRaw() {
  try {
    const data = JSON.parse(await readFile(historyPath(), "utf8"));
    if (!Array.isArray(data)) throw new Error("在线生图历史格式不正确");
    return data as unknown[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

// ACT: 单进程串行写历史，避免两次原子写互相覆盖；进程重启后不恢复未写完的记录。上限 5000 条。
let pending = Promise.resolve();
function enqueue<T>(task: () => Promise<T>) {
  const result = pending.then(task, task);
  pending = result.then(() => undefined, () => undefined);
  return result;
}

export async function listOnlineImageHistory() {
  return (await readRaw()).flatMap(item => {
    const record = asOnlineImageRecord(item);
    return record ? [record] : [];
  });
}

export function appendOnlineImageHistory(record: OnlineImageRecord) {
  if (!asOnlineImageRecord(record)) throw Object.assign(new Error("历史记录无效"), { status: 500 });
  return enqueue(async () => {
    const current = await readRaw();
    await writeAtomic(historyPath(), JSON.stringify([record, ...current].slice(0, maxHistory)), { mode: 0o600 });
  });
}

export function deleteOnlineImageHistory(id: string) {
  return enqueue(async () => {
    const current = await readRaw();
    const matched = current.filter(item => !!item && typeof item === "object" && (item as { id?: unknown }).id === id);
    if (!matched.length) throw Object.assign(new Error("记录不存在"), { status: 404 });
    await writeAtomic(historyPath(), JSON.stringify(current.filter(item => !item || typeof item !== "object" || (item as { id?: unknown }).id !== id)), { mode: 0o600 });
    for (const item of matched) {
      const record = asOnlineImageRecord(item);
      if (!record) continue;
      for (const image of record.images) {
        await removeAsset(image.path).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    }
  });
}
