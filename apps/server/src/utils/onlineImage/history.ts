import { readFile, writeAtomic } from "@toonflow/file";
import { dirname, join } from "node:path";
import conf from "@/utils/conf";
import { removeAsset } from "@/utils/assets";

export const onlineOutputDirectory = "在线生图";
export const onlineReferencePath = /^在线生图\/input\/ref[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff)$/i;
export const onlineReferenceMime = /^image\/(png|jpeg|webp|gif|avif|bmp|tiff)$/i;
export const onlineOutputPath = /^在线生图\/image[0-9a-f-]{36}\.(png|jpe?g|webp|gif|avif|bmp|tiff)$/i;

export type OnlineImageFile = { path: string; mimeType: string };
export type OnlineImageRecord = {
  id: string;
  createdAt: number;
  prompt: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  size?: string;
  ratio?: string;
  images: OnlineImageFile[];
  references: OnlineImageFile[];
};

const maxHistory = 5000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const providerPattern = /^[a-z][a-zA-Z0-9]{0,95}$/;
const ratioPattern = /^[1-9]\d{0,3}:[1-9]\d{0,3}$/;

function historyPath() {
  return join(dirname(conf.path), "onlineImageHistory.json");
}

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= max;
}

function fileOf(value: unknown, pathPattern: RegExp): OnlineImageFile | undefined {
  if (!value || typeof value !== "object") return;
  const file = value as OnlineImageFile;
  if (!pathPattern.test(file.path) || !onlineReferenceMime.test(file.mimeType)) return;
  return { path: file.path, mimeType: file.mimeType };
}

export function asOnlineImageRecord(value: unknown): OnlineImageRecord | undefined {
  if (!value || typeof value !== "object") return;
  const record = value as OnlineImageRecord;
  const images = Array.isArray(record.images) ? record.images.map(item => fileOf(item, onlineOutputPath)) : [];
  const references = Array.isArray(record.references) ? record.references.map(item => fileOf(item, onlineReferencePath)) : [];
  if (!uuidPattern.test(record.id) || typeof record.createdAt !== "number" || !Number.isFinite(record.createdAt)) return;
  if (!text(record.prompt, 20000) || !providerPattern.test(record.providerId) || !text(record.providerLabel, 256)) return;
  if (!text(record.modelId, 256) || !text(record.modelLabel, 256)) return;
  if (record.size !== undefined && !text(record.size, 64)) return;
  if (record.ratio !== undefined && (typeof record.ratio !== "string" || !ratioPattern.test(record.ratio))) return;
  if (!images.length || images.length > 64 || images.some(item => !item) || references.length > 3 || references.some(item => !item)) return;
  return {
    id: record.id, createdAt: record.createdAt, prompt: record.prompt,
    providerId: record.providerId, providerLabel: record.providerLabel,
    modelId: record.modelId, modelLabel: record.modelLabel,
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
