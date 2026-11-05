import { t } from "@/lib/i18n";
import { z } from "zod";

const modelSchema = z.object({
  id: z.string().optional(), name: z.string().optional(),
  display_name: z.string().optional(), displayName: z.string().optional(),
  inputTokenLimit: z.number().int().positive().optional(),
  outputTokenLimit: z.number().int().positive().optional(),
  type: z.enum(["text", "image", "video", "audio"]).optional(),
  modelInfo: z.record(z.string(), z.json()).optional(),
});

export async function fetchProviderModels({ apiUrl, protocol, apiKey, signal }: { apiUrl: string; protocol: string; apiKey: string; signal?: AbortSignal }) {
  const url = new URL(apiUrl);
  if (url.pathname === "/") url.pathname = "/v1";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (protocol === "anthropic-messages") {
    headers["anthropic-version"] = "2023-06-01";
    headers["x-api-key"] = apiKey;
    url.searchParams.set("limit", "1000");
  } else if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const models = new Map<string, { id: string; label: string; contextWindow?: number; maxOutputTokens?: number; type?: "text" | "image" | "video" | "audio"; modelInfo?: Record<string, z.infer<ReturnType<typeof z.json>>> }>();
  const cursors = new Set<string>();
  const timeoutSignal = AbortSignal.timeout(30000);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  while (true) {
    let response: Response;
    try {
      response = await fetch(url, { headers, signal: requestSignal, redirect: "error" });
    } catch {
      if (signal?.aborted) signal.throwIfAborted();
      throw new Error(requestSignal.aborted ? "模型列表请求超时，请检查服务端网络或代理后重试" : "无法连接模型列表接口，请检查服务端网络、代理及证书设置");
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) throw new Error("模型列表鉴权失败（HTTP 401）：请检查 API Key 是否完整、有效且未停用");
      if (response.status === 403) throw new Error("模型列表访问被拒绝（HTTP 403）：请检查令牌权限、分组或网关访问限制");
      if (response.status === 429) throw new Error("模型列表请求过于频繁（HTTP 429），请稍后重试");
      throw new Error(t`模型列表获取失败（HTTP ${response.status}），请检查 API 地址、连接协议和密钥是否正确。`);
    }
    const result = z.object({
      data: z.array(modelSchema),
      has_more: z.boolean().optional(), last_id: z.string().nullable().optional(),
    }).parse(await response.json());
    const items = result.data;
    for (const item of items) {
      const id = item.id?.trim();
      if (!id) throw new Error("获取到的模型列表包含无效的模型 ID，无法正常加载。");
      models.set(id, { id, label: item.display_name || item.displayName || id, contextWindow: item.inputTokenLimit, maxOutputTokens: item.outputTokenLimit,
        ...(item.type ? { type: item.type } : {}), ...(item.modelInfo ? { modelInfo: item.modelInfo } : {}) });
    }
    const cursor = protocol === "anthropic-messages" && result.has_more ? result.last_id : undefined;
    if (protocol === "anthropic-messages" && result.has_more && !cursor) throw new Error("模型列表缺少分页游标，无法继续获取后续模型。");
    if (!cursor) break;
    if (cursors.has(cursor)) throw new Error("模型列表返回了重复的分页游标，已停止获取后续模型。");
    cursors.add(cursor);
    url.searchParams.set("after_id", cursor);
  }
  return [...models.values()];
}
