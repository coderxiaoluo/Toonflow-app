import { openaiImagesEndpoint, resolveOpenaiImageSize } from "./openaiImagesCatalog";

type ImageModel = {
  id?: string;
  mode?: unknown;
  imageSizes?: unknown;
  imageRatios?: unknown;
  imageReferences?: unknown;
};

type ImageThis = {
  id?: string;
  config: { apiUrl?: unknown; apiKey?: unknown };
  signal?: AbortSignal;
  models?: ImageModel[];
  tool: { fetch: typeof fetch; errorMessage?: (value: unknown) => string };
};

const imageTimeout = 10 * 60_000;
const maxImageBytes = 8 * 1024 * 1024;
const maxRequestBytes = 32 * 1024 * 1024;

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim()).map(item => item.trim()) : [];
}

function apiKey(config: ImageThis["config"]) {
  const key = typeof config.apiKey === "string" ? config.apiKey.trim().replace(/^Bearer\s+/i, "").trim() : "";
  if (!key) fail("请填写 API 密钥");
  return key;
}

function apiBase(config: ImageThis["config"]) {
  if (typeof config.apiUrl !== "string" || !config.apiUrl.trim()) fail("请填写 API 地址");
  return config.apiUrl;
}

function messageOf(value: unknown, status: number) {
  const data = record(value);
  const error = record(data?.error) ?? record(data?.failure);
  const message = [error?.message, data?.message].find(item => typeof item === "string" && item.trim());
  if (typeof message === "string") return message.trim();
  if (status === 401) return "API 密钥无效或已停用";
  if (status === 402) return "余额不足";
  if (status === 429) return "请求过于频繁，请稍后重试";
  return `请求失败（HTTP ${status}）`;
}

function modelOf(context: ImageThis, id: string) {
  return context.models?.find(item => item.id === id);
}

function referenceLimit(model: ImageModel | undefined) {
  const modes = Array.isArray(model?.mode) ? model.mode.flat().map(String) : [];
  if (!modes.includes("singleImage") && !modes.includes("multiReference")) return 0;
  const declared = typeof model?.imageReferences === "number" && Number.isInteger(model.imageReferences) && model.imageReferences >= 0
    ? model.imageReferences : undefined;
  if (!modes.includes("multiReference")) return Math.min(1, declared ?? 1);
  return declared ?? 16;
}

function tiersOf(model: ImageModel | undefined) {
  const tiers = strings(model?.imageSizes).map(item => item.toUpperCase()).filter(item => item === "1K" || item === "2K" || item === "4K");
  return tiers.length ? tiers : ["1K", "2K", "4K"];
}

function assetsOf(payload: Record<string, unknown>): MediaAsset[] {
  const nested = record(payload.result);
  const rows = [payload.data, nested?.data, payload.images].find(Array.isArray) ?? [];
  const assets: MediaAsset[] = [];
  for (const item of rows) {
    const row = record(item);
    if (typeof row?.url === "string" && /^https?:\/\//i.test(row.url)) assets.push({ mediaType: "image", type: "url", url: row.url });
    else if (typeof row?.b64_json === "string" && row.b64_json.trim()) assets.push({ mediaType: "image", type: "base64", data: row.b64_json.trim(), mimeType: "image/png" });
  }
  if (!assets.length && typeof payload.url === "string" && /^https?:\/\//i.test(payload.url)) assets.push({ mediaType: "image", type: "url", url: payload.url });
  return assets;
}

function taskId(payload: Record<string, unknown>, response: Response) {
  if (typeof payload.id === "string" && payload.id.trim()) return payload.id.trim();
  const location = response.headers.get("location") ?? "";
  const match = /\/images\/results\/([^/?#]+)/.exec(location);
  if (match?.[1]) return decodeURIComponent(match[1]);
  fail("未返回图片任务编号");
}

function wait(signal: AbortSignal, ms: number) {
  const delay = Math.min(30_000, Math.max(5_000, ms));
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delay);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

async function callApi(context: ImageThis, path: string, body?: string | FormData, json = false) {
  const url = openaiImagesEndpoint(context.id === "developCc" ? "https://image.develop.cc" : apiBase(context.config), path);
  let response: Response;
  try {
    response = await context.tool.fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey(context.config)}`,
        ...(json ? { "Content-Type": "application/json" } : {}),
      },
      body,
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
  return { response, payload: record(payload) ?? {} };
}

function expose(status: number) {
  if (status === 401 || status === 402 || status === 404 || status === 409 || status === 413 || status === 429 || status === 503 || status === 504) return status;
  return status >= 400 && status < 500 ? 400 : 502;
}

function reject(context: ImageThis, payload: Record<string, unknown>, status: number): never {
  fail(context.tool.errorMessage?.(payload) || messageOf(payload, status), expose(status));
}

async function imageFile(context: ImageThis, input: MediaInput, index: number) {
  let bytes: Uint8Array;
  let mime = input.mimeType || "image/png";
  if (input.type === "url") {
    if (!/^https?:\/\//i.test(input.url)) fail("参考图需要 HTTP 或 HTTPS 地址");
    let response: Response;
    try { response = await context.tool.fetch(input.url, { redirect: "error", signal: context.signal }); }
    catch (error) {
      if (context.signal?.aborted) throw error;
      fail("无法读取参考图", 502);
    }
    if (!response.ok) fail(`读取参考图失败（HTTP ${response.status}）`, expose(response.status));
    bytes = new Uint8Array(await response.arrayBuffer());
    const header = response.headers.get("content-type")?.split(";")[0]?.trim();
    if (header) mime = header;
  } else if (input.type === "base64") {
    bytes = Buffer.from(input.data.replace(/^data:[^;,]+;base64,/, "").replace(/\s/g, ""), "base64");
  } else bytes = input.data;
  if (!bytes.byteLength) fail("参考图为空");
  if (bytes.byteLength > maxImageBytes) fail("单张参考图不能超过 8 MB");
  if (!mime.toLowerCase().startsWith("image/")) fail("参考图必须是图片文件");
  const extension = mime.toLowerCase() === "image/jpeg" ? "jpg" : mime.toLowerCase() === "image/webp" ? "webp" : mime.toLowerCase() === "image/gif" ? "gif" : "png";
  const name = input.name?.split(/[\\/]/).pop()?.replace(/[^\w.-]+/g, "") || `image-${index + 1}.${extension}`;
  return { bytes, mime, name };
}

async function finish(context: ImageThis, response: Response, payload: Record<string, unknown>, signal: AbortSignal): Promise<MediaAsset[]> {
  if (response.status === 202 || String(payload.status ?? "").toLowerCase() === "running") {
    const id = taskId(payload, response);
    const retryAfter = Number(payload.poll_after_seconds ?? response.headers.get("retry-after"));
    await wait(signal, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000);
    return poll(context, id, signal);
  }
  if (!response.ok) reject(context, payload, response.status);
  const assets = assetsOf(payload);
  if (!assets.length) fail("未返回图片");
  return assets;
}

async function poll(context: ImageThis, id: string, signal: AbortSignal): Promise<MediaAsset[]> {
  while (true) {
    signal.throwIfAborted();
    const { response, payload } = await callApi(context, `/v1/images/results/${encodeURIComponent(id)}`);
    const status = String(payload.status ?? "").toLowerCase();
    const assets = assetsOf(payload);
    if (status === "succeeded" || status === "success" || status === "completed" || (response.ok && !status && assets.length)) {
      if (!assets.length) fail("图片已完成，但未返回结果");
      return assets;
    }
    if (["failed", "failure", "error", "rejected", "cancelled", "canceled"].includes(status)) reject(context, payload, response.ok ? 502 : response.status);
    if (!response.ok && response.status !== 202 && ![429, 502, 503, 504].includes(response.status)) reject(context, payload, response.status);
    const retryAfter = Number(payload.poll_after_seconds ?? response.headers.get("retry-after"));
    await wait(signal, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000);
  }
}

export async function generateOpenaiImage(this: ImageThis, request: ImageRequest): Promise<MediaAsset[]> {
  const prompt = request.prompt.trim();
  if (!prompt) fail("请输入图片提示词");
  if (request.mask) fail("当前图片接口不支持蒙版局部重绘");
  const model = modelOf(this, request.model);
  const ratios = strings(model?.imageRatios);
  if (request.ratio && ratios.length && !ratios.includes(request.ratio)) fail(`当前模型不支持画幅 ${request.ratio}，可选：${ratios.join("、")}`);
  const size = resolveOpenaiImageSize(request.size, request.ratio, tiersOf(model));
  const images = request.images ?? [];
  const limit = referenceLimit(model);
  if (images.length > limit) fail(limit ? `参考图最多 ${limit} 张` : "当前模型不支持参考图");
  if (request.n !== undefined && (!Number.isInteger(request.n) || request.n < 1 || request.n > 10)) fail("生成数量须为 1 到 10 的整数");
  const quality = request.quality?.trim().toLowerCase();
  if (quality && !["low", "medium", "high", "xhigh", "max", "auto"].includes(quality)) fail("画质只支持 low、medium、high、xhigh、max、auto");
  const outputFormat = request.outputFormat?.trim().toLowerCase().replace("jpg", "jpeg");
  if (outputFormat && !["png", "jpeg", "webp"].includes(outputFormat)) fail("输出格式只支持 png、jpeg、webp");
  const fields: Record<string, string> = {
    model: request.model,
    prompt,
    size,
    response_format: "url",
    ...(request.n !== undefined ? { n: String(request.n) } : {}),
    ...(quality ? { quality } : {}),
    ...(outputFormat ? { output_format: outputFormat } : {}),
  };
  const signal = AbortSignal.any([AbortSignal.timeout(imageTimeout), ...(this.signal ? [this.signal] : [])]);
  const context = { ...this, signal };
  if (!images.length) {
    const result = await callApi(context, "/v1/images/generations", JSON.stringify(fields), true);
    return finish(context, result.response, result.payload, signal);
  }
  const files: { bytes: Uint8Array; mime: string; name: string }[] = [];
  let total = 0;
  for (const [index, image] of images.entries()) {
    const file = await imageFile(context, image, index);
    total += file.bytes.byteLength;
    if (total > maxRequestBytes) fail("单次参考图合计不能超过 32 MB");
    files.push(file);
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files) form.append("image[]", new Blob([Uint8Array.from(file.bytes).buffer], { type: file.mime }), file.name);
  const result = await callApi(context, "/v1/images/edits", form);
  return finish(context, result.response, result.payload, signal);
}
