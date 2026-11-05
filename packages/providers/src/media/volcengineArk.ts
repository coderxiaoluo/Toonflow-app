import { BlockList, isIP } from "node:net";
import { volcengineEndpoint } from "./volcengineArkCatalog";

const privateAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) privateAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) privateAddresses.addSubnet(address, prefix, "ipv6");
const publicIpv6 = new BlockList();
publicIpv6.addSubnet("2000::", 3, "ipv6");

// ACT: 只做 URL 与地址字面量校验，不下载或探测参考视频；域名实际可达性由接收直链的供应商校验。
export function validateVolcengineVideoUrl(value: unknown): string {
  const url = typeof value === "string" && value.length <= 8192 && URL.canParse(value.trim()) ? new URL(value.trim()) : undefined;
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) fail("视频须为不含凭据或片段的公网 HTTP(S) 直链");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const family = isIP(host);
  if (family === 4 ? privateAddresses.check(host, "ipv4")
    : family === 6 ? !publicIpv6.check(host, "ipv6") || privateAddresses.check(host, "ipv6")
      : !host.includes(".") || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(host)) {
    fail("视频必须使用公网地址，不能使用本机、内网或特殊网络地址");
  }
  return url.href;
}

type ReferencedVideoRequest = VideoRequest & {
  referenceOrder?: ({ type: "image" | "video" | "audio"; index: number } | { type: "firstFrame" | "lastFrame" | "text" })[];
};

type ArkModel = {
  id?: string;
  mode?: unknown;
  videoRatios?: unknown;
  defaultResolution?: unknown;
  defaultDuration?: unknown;
  durationResolutionMap?: { duration?: unknown; resolution?: unknown }[];
};

type ArkThis = {
  id?: string;
  config: { apiUrl?: unknown; apiKey?: unknown };
  signal?: AbortSignal;
  models?: ArkModel[];
  tool: { fetch: typeof fetch; errorMessage?: (value: unknown) => string };
};

type Money = number | "masked" | undefined;

export type VolcengineArkBalance = {
  balance: number;
  unit: string;
  keyBalance: number | null;
  accountHidden: boolean;
};

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function apiKey(config: ArkThis["config"]) {
  const key = typeof config.apiKey === "string" ? config.apiKey.trim().replace(/^Bearer\s+/i, "").trim() : "";
  if (!key) fail("请填写 API 密钥");
  return key;
}

function apiBase(config: ArkThis["config"]) {
  if (typeof config.apiUrl !== "string" || !config.apiUrl.trim()) fail("请填写 API 地址");
  return config.apiUrl;
}

function messageOf(value: unknown, status: number) {
  const data = record(value);
  const error = record(data?.error);
  const nested = record(data?.data);
  const nestedError = record(nested?.error);
  const message = [data?.message, error?.message, nested?.message, nestedError?.message].find(item => typeof item === "string" && item.trim());
  if (typeof message === "string") return message.trim();
  if (status === 401) return "密钥缺失、无效、已禁用、已过期，或所属账户不可用";
  if (status === 503) return "服务暂时不可用，请稍后重试";
  return `请求失败（HTTP ${status}）`;
}

async function requestJson(context: ArkThis, path: string, body?: unknown) {
  const base = context.id === "developCc"
    ? path === "/api/v1/account/balance" ? "https://xapi-tool.develop.cc" : "https://video.develop.cc"
    : apiBase(context.config);
  const url = volcengineEndpoint(base, path);
  let response: Response;
  try {
    response = await context.tool.fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey(context.config)}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: context.signal,
    });
  } catch (error) {
    if (context.signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/redirect/i.test(message)) fail("接口发生了重定向，请填写最终的 HTTPS 地址");
    fail("无法连接接口，请检查 API 地址", 502);
  }
  const text = await response.text();
  let payload: unknown = {};
  if (text.trim()) {
    try { payload = JSON.parse(text); }
    catch { payload = { message: text.trim() }; }
  }
  const data = record(payload);
  if (!response.ok || data?.success === false) {
    const status = response.ok ? 400 : response.status;
    const exposed = status === 401 || status === 503 ? status : status >= 400 && status < 500 ? 400 : 502;
    const message = context.tool.errorMessage?.(payload) || messageOf(payload, status);
    if (/invalid url/i.test(message)) fail(`当前地址没有接口 ${path}。火山方舟协议需要站点根地址上的 /api/v1 与 /api/v3；以 /v1 结尾的 New API 地址不提供这两条路径。`, exposed);
    fail(message, exposed);
  }
  return data ?? {};
}

function money(value: unknown): Money {
  if (value === "****") return "masked";
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "****") return "masked";
    if (text && Number.isFinite(Number(text))) return Number(text);
  }
  return undefined;
}

function moneyPair(value: unknown) {
  if (typeof value === "string" && value.trim() === "****") return { usd: "masked" as const, cny: "masked" as const };
  const data = record(value);
  return { usd: money(data?.usd), cny: money(data?.cny) };
}

export function mapVolcengineBalance(payload: unknown): VolcengineArkBalance {
  const body = record(payload) ?? {};
  if (body.success === false) fail(messageOf(body, 400));
  const data = record(body.data) ?? body;
  const account = moneyPair(data.account_balance);
  const token = moneyPair(data.token_balance);
  const currency = account.cny !== undefined || token.cny !== undefined ? "cny" : "usd";
  const unit = currency === "cny" ? "元" : "USD";
  const accountAmount = account[currency];
  const tokenAmount = token[currency];
  const accountNumber = typeof accountAmount === "number" ? accountAmount : undefined;
  const tokenNumber = typeof tokenAmount === "number" ? tokenAmount : undefined;
  if (accountNumber === undefined && tokenNumber === undefined) fail("余额响应缺少可用金额");
  const accountHidden = accountAmount === "masked";
  const keyBalance = accountHidden ? tokenNumber ?? accountNumber!
    : tokenNumber === undefined || tokenNumber === accountNumber ? null : tokenNumber;
  return { balance: accountNumber ?? tokenNumber!, unit, keyBalance, accountHidden };
}

function modelOf(context: ArkThis, id: string) {
  return context.models?.find(item => item.id === id);
}

function numbers(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim()).map(item => item.trim()) : [];
}

function referenceLimit(model: ArkModel | undefined, kind: "image" | "video" | "audio") {
  if (!Array.isArray(model?.mode)) return undefined;
  for (const mode of model.mode) {
    if (!Array.isArray(mode)) continue;
    for (const item of mode) {
      const match = new RegExp(`^${kind}Reference:(\\d+)$`).exec(String(item));
      if (match) return Number(match[1]);
    }
  }
  return undefined;
}

function mediaUrl(input: MediaInput, kind: "image" | "audio" | "video") {
  if (input.type === "url") {
    if (kind === "video") return validateVolcengineVideoUrl(input.url);
    if (!/^https?:\/\//i.test(input.url)) fail("参考媒体需要 HTTP 或 HTTPS 地址");
    return input.url;
  }
  if (kind === "video") fail("参考视频只接受公网地址，本地视频无法提交");
  const mimeType = input.mimeType || (kind === "image" ? "image/png" : "audio/mpeg");
  if (!mimeType.startsWith(`${kind}/`)) fail(kind === "image" ? "参考图片类型不正确" : "参考音频类型不正确");
  const data = input.type === "binary" ? Buffer.from(input.data).toString("base64") : input.data.replace(/\s/g, "");
  if (!data) fail(kind === "image" ? "参考图片为空" : "参考音频为空");
  return data.startsWith("data:") ? data : `data:${mimeType};base64,${data}`;
}

function contentItem(kind: "image" | "video" | "audio", input: MediaInput, role?: string) {
  const key = `${kind}_url` as const;
  return { type: key, [key]: { url: mediaUrl(input, kind) }, ...(role ? { role } : {}) };
}

function taskId(payload: Record<string, unknown>) {
  const data = record(payload.data);
  const id = payload.id ?? data?.id;
  if (typeof id !== "string" || !/^[\w.-]+$/.test(id)) fail("未返回任务 ID");
  return id;
}

function taskState(payload: Record<string, unknown>) {
  const data = record(payload.data) ?? payload;
  const content = record(data.content) ?? record(payload.content);
  const error = record(data.error) ?? record(payload.error);
  const video = [content?.video_url, data.video_url, payload.video_url].find(item => typeof item === "string" && item.trim());
  return {
    status: String(data.status ?? payload.status ?? "").toLowerCase(),
    videoUrl: typeof video === "string" ? video.trim() : "",
    message: typeof error?.message === "string" ? error.message.trim() : "",
  };
}

function wait(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 3000);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export async function queryVolcengineBalance(options: { apiUrl: string; apiKey: string; fetch?: typeof fetch; signal?: AbortSignal }): Promise<VolcengineArkBalance> {
  const payload = await requestJson({
    config: { apiUrl: options.apiUrl, apiKey: options.apiKey },
    signal: options.signal,
    tool: { fetch: options.fetch ?? fetch },
  }, "/api/v1/account/balance");
  return mapVolcengineBalance(payload);
}

export async function getVolcengineBalance(this: ArkThis): Promise<VolcengineArkBalance> {
  const payload = await requestJson(this, "/api/v1/account/balance");
  return mapVolcengineBalance(payload);
}

export async function generateVolcengineVideo(this: ArkThis, request: ReferencedVideoRequest): Promise<MediaAsset[]> {
  const model = modelOf(this, request.model);
  const media = { image: request.images, video: request.videos, audio: request.audios };
  if (request.referenceOrder) {
    for (const [index, reference] of request.referenceOrder.entries()) {
      if (!reference || !["image", "video", "audio"].includes(reference.type) || !("index" in reference)
        || !Number.isSafeInteger(reference.index) || reference.index < 0 || !media[reference.type]?.[reference.index]) {
        fail(`参考 ${index + 1} 指向的素材不存在或类型不受支持`);
      }
    }
  }
  const prompt = request.prompt.trim().replace(/\{\{ref (\d+)\}\}/g, (marker, number: string) => {
    const reference = request.referenceOrder?.[Number(number) - 1];
    if (!reference || !("index" in reference) || !media[reference.type]?.[reference.index]) fail(`引用标记 ${marker} 没有对应素材，请重新选择引用`);
    return `@${{ image: "图片", video: "视频", audio: "音频" }[reference.type]}${reference.index + 1}`;
  });
  if (!prompt) fail("请输入视频提示词");
  const supportsEditing = this.id === "developCc" && request.model === "seedance-2.5";
  if (!supportsEditing && request.other?.videoOperation !== undefined && request.other.videoOperation !== "generate") fail("仅 Develop seedance-2.5 支持编辑或延长视频");
  const operation = supportsEditing ? request.other?.videoOperation ?? "generate" : "generate";
  if (!["generate", "edit", "extend"].includes(String(operation))) fail("视频操作模式无效");
  const modifyingVideo = operation === "edit" || operation === "extend";
  let sourceVideo: MediaInput | undefined;
  if (modifyingVideo) {
    const source = typeof request.other?.sourceVideoUrl === "string" && request.other.sourceVideoUrl.trim()
      ? request.other.sourceVideoUrl : request.videos?.length === 1 && request.videos[0]?.type === "url" ? request.videos[0].url : undefined;
    sourceVideo = { type: "url", url: validateVolcengineVideoUrl(source) };
    if (request.videos?.length && (request.videos.length !== 1 || request.videos[0]?.type !== "url" || request.videos[0].url !== sourceVideo.url)) fail("编辑或延长只允许一段原视频，请使用一个视频节点或公网直链");
    if (request.firstFrame || request.lastFrame) fail("编辑或延长不支持首尾帧，请使用混合参考模式");
  }
  const durationMap = model?.durationResolutionMap ?? [];
  const allowedDurations = [...new Set(durationMap.flatMap(item => numbers(item.duration)))];
  const fallbackDuration = typeof model?.defaultDuration === "number" ? model.defaultDuration : undefined;
  const duration = operation === "edit" ? -1 : operation === "extend"
    ? request.other?.extensionDuration ?? -1 : request.duration ?? fallbackDuration;
  if (typeof duration !== "number" || !Number.isInteger(duration)) fail("时长必须是整数秒数");
  if (modifyingVideo) {
    if (duration !== -1 && (duration < 4 || duration > 30)) fail("新增时长须为 4–30 秒，或选择自动时长");
  } else {
    if (duration < 1) fail("时长必须是明确的正整数秒数");
    if (allowedDurations.length && !allowedDurations.includes(duration)) fail(`当前模型不支持时长 ${duration} 秒，可选：${allowedDurations.join("、")}`);
  }
  const resolutionRow = durationMap.find(item => numbers(item.duration).includes(duration));
  const allowedResolutions = modifyingVideo ? [...new Set(durationMap.flatMap(item => strings(item.resolution)))] : strings(resolutionRow?.resolution);
  const fallbackResolution = typeof model?.defaultResolution === "string" ? model.defaultResolution : undefined;
  const resolution = request.resolution || fallbackResolution;
  if (!resolution) fail("请指定分辨率");
  if (allowedResolutions.length && !allowedResolutions.includes(resolution)) fail(`当前模型不支持分辨率 ${resolution}，可选：${allowedResolutions.join("、")}`);
  const ratios = strings(model?.videoRatios);
  if (!modifyingVideo && request.ratio && ratios.length && !ratios.includes(request.ratio)) fail(`当前模型不支持画幅 ${request.ratio}，可选：${ratios.join("、")}`);
  const images = request.images ?? [];
  const videos = sourceVideo ? [sourceVideo] : request.videos ?? [];
  const audios = request.audios ?? [];
  if ((request.firstFrame && !request.lastFrame) || (!request.firstFrame && request.lastFrame)) fail("首尾帧必须成对提交");
  const counts = { image: images.length + (request.firstFrame ? 1 : 0) + (request.lastFrame ? 1 : 0), video: videos.length, audio: audios.length };
  for (const kind of ["image", "video", "audio"] as const) {
    const limit = referenceLimit(model, kind);
    if (limit !== undefined && counts[kind] > limit) fail(`${{ image: "参考图", video: "参考视频", audio: "参考音频" }[kind]}最多 ${limit} 个`);
  }
  // ACT: 显式操作模式补齐网关识别关键词，避免用户选中编辑/延长后被按普通生成受理。
  const operationPrompt = operation === "edit" ? `编辑视频：${prompt}`
    : operation === "extend" && !/向前延长|向后延长|延续|续写/.test(prompt) ? `延续视频：${prompt}` : prompt;
  const content: Record<string, unknown>[] = [{ type: "text", text: operationPrompt }];
  if (request.firstFrame && request.lastFrame) {
    content.push(contentItem("image", request.firstFrame, "first_frame"), contentItem("image", request.lastFrame, "last_frame"));
  }
  content.push(
    ...images.map(item => contentItem("image", item)),
    ...videos.map(item => contentItem("video", item, supportsEditing ? "reference_video" : undefined)),
    ...audios.map(item => contentItem("audio", item)),
  );
  const signal = AbortSignal.any([AbortSignal.timeout(30 * 60_000), ...(this.signal ? [this.signal] : [])]);
  const context = { ...this, signal };
  const created = await requestJson(context, "/api/v3/contents/generations/tasks", {
    model: request.model,
    content,
    resolution,
    duration,
    ...(!modifyingVideo && request.ratio ? { ratio: request.ratio } : {}),
    ...(/^(?:seedance-|video-test$)/.test(request.model) ? { billing_mode: "tokens" } : {}),
    ...(typeof request.generateAudio === "boolean" ? { generate_audio: request.generateAudio } : {}),
    ...(typeof request.watermark === "boolean" ? { watermark: request.watermark } : {}),
  });
  const id = taskId(created);
  while (true) {
    const state = taskState(await requestJson(context, `/api/v3/contents/generations/tasks/${encodeURIComponent(id)}`));
    if (state.status === "succeeded" || state.status === "success" || state.status === "completed") {
      if (!/^https?:\/\//i.test(state.videoUrl)) fail("视频生成完成，但未返回成片地址");
      return [{ mediaType: "video", type: "url", url: state.videoUrl }];
    }
    if (["failed", "failure", "error", "rejected", "cancelled", "canceled", "expired"].includes(state.status)) {
      throw Object.assign(new Error(state.message || "视频生成失败，请核对供应商任务及费用状态"), { status: 400, code: "MEDIA_TASK_FAILED" });
    }
    await wait(signal);
  }
}
