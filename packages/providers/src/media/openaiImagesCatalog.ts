export const openaiImagesProtocol = "openai-images";

const aspects = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "5:4", "4:5"] as const;
const tierOrder = ["1K", "2K", "4K"] as const;

const pixels: Record<string, Record<string, string>> = {
  "1:1": { "1K": "1024x1024", "2K": "2048x2048", "4K": "2880x2880" },
  "4:3": { "1K": "1152x864", "2K": "2048x1536", "4K": "3200x2400" },
  "3:4": { "1K": "864x1152", "2K": "1536x2048", "4K": "2400x3200" },
  "3:2": { "1K": "1536x1024", "2K": "2304x1536", "4K": "3456x2304" },
  "2:3": { "1K": "1024x1536", "2K": "1536x2304", "4K": "2304x3456" },
  "16:9": { "1K": "1344x768", "2K": "2048x1152", "4K": "3840x2160" },
  "9:16": { "1K": "768x1344", "2K": "1152x2048", "4K": "2160x3840" },
  "21:9": { "1K": "1536x656", "2K": "2304x992", "4K": "3840x1648" },
  "5:4": { "1K": "1120x896", "2K": "1920x1536", "4K": "3200x2560" },
  "4:5": { "1K": "896x1120", "2K": "1536x1920", "4K": "2560x3200" },
};

export type OpenaiImageModelInput = {
  id: string;
  label: string;
  tiers: string[];
  references: number;
  ratios?: string[];
};

const families: OpenaiImageModelInput[] = [
  { id: "gpt-image-2", label: "gpt-image-2", tiers: ["1K", "2K", "4K"], references: 16 },
  { id: "gemini-3.1-flash-image", label: "Nano Banana 2", tiers: ["1K", "2K", "4K"], references: 14 },
  { id: "gemini-3-pro-image", label: "Nano Banana Pro", tiers: ["1K", "2K", "4K"], references: 14 },
  { id: "gemini-nano-banana-2.1", label: "Nano Banana 2.1", tiers: ["1K", "2K", "4K"], references: 0 },
  { id: "gpt-image-2.5-flare", label: "gpt-image-2.5-flare", tiers: ["1K", "2K", "4K"], references: 16 },
  { id: "gpt-image-2.5-sunburst", label: "gpt-image-2.5-sunburst", tiers: ["1K", "2K", "4K"], references: 16 },
  { id: "image-01", label: "image-01", tiers: ["1K"], references: 1 },
  { id: "image-01-live", label: "image-01-live", tiers: ["1K"], references: 1 },
  { id: "image-test", label: "image-test", tiers: ["1K"], references: 0, ratios: ["1:1"] },
];

function fail(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

export function recommendedOpenaiImageModels() {
  return families.map(item => ({ ...item, tiers: [...item.tiers], ...(item.ratios ? { ratios: [...item.ratios] } : {}) }));
}

export function openaiImageManualTemplate(): OpenaiImageModelInput {
  const template = recommendedOpenaiImageModels().find(item => item.id === "gpt-image-2");
  if (!template) throw new Error("缺少 gpt-image-2 规格");
  return { ...template, id: "", label: "" };
}

export function resolveOpenaiImageSize(size: string | undefined, ratio: string | undefined, tiers: readonly string[]) {
  const allowed = tierOrder.filter(item => tiers.includes(item));
  if (!allowed.length) fail("当前模型没有可用的分辨率档");
  const raw = size?.trim() ?? "";
  if (/^\d+x\d+$/i.test(raw)) {
    const normalized = raw.toLowerCase();
    const tier = tierOrder.find(item => aspects.some(aspect => pixels[aspect]?.[item] === normalized));
    if (!tier || !allowed.some(item => item === tier)) fail(`当前模型不支持尺寸 ${raw}，可选分辨率：${allowed.join("、")}`);
    return normalized;
  }
  let tier: string = allowed[0]!;
  let aspect = "";
  if (/^\d+:\d+$/.test(raw)) aspect = raw;
  else if (raw && raw.toLowerCase() !== "auto") {
    if (!/^[124]k$/i.test(raw)) fail(`不支持的尺寸 ${raw}`);
    tier = raw.toUpperCase();
    if (!allowed.some(item => item === tier)) fail(`当前模型不提供 ${tier}，可选：${allowed.join("、")}`);
  }
  if (!aspect) aspect = ratio?.trim() || (tier === "4K" ? "16:9" : "1:1");
  const value = pixels[aspect]?.[tier];
  if (!value) fail(`不支持的画幅 ${aspect}，可选：${aspects.join("、")}`);
  return value;
}

export function toOpenaiImageModel(input: OpenaiImageModelInput) {
  const id = input.id.trim();
  const label = input.label.trim() || id;
  const tiers = tierOrder.filter(item => input.tiers.includes(item));
  if (!id) throw new Error("请填写模型 ID");
  if (!tiers.length) throw new Error(`模型 ${id} 至少要有一档分辨率`);
  if (!Number.isInteger(input.references) || input.references < 0 || input.references > 16) throw new Error(`模型 ${id} 的参考图数量须为 0 到 16`);
  const ratios = input.ratios?.length ? aspects.filter(item => input.ratios!.includes(item)) : [...aspects];
  if (!ratios.length) throw new Error(`模型 ${id} 至少要有一种画幅`);
  const mode = input.references > 1 ? ["text", "singleImage", "multiReference"] : input.references === 1 ? ["text", "singleImage"] : ["text"];
  return { id, label, type: "image" as const, mode, imageSizes: [...tiers], imageRatios: [...ratios], imageReferences: input.references };
}

const providerIdPattern = /^[a-z][a-zA-Z0-9]{0,95}$/;
const reservedProviderId = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const readme = [
  "## OpenAI 图像",
  "",
  "用自己的 API 密钥调用账户。API 地址填写站点根地址，例如 `https://image.example.com`，不要带 `/v1`。",
  "",
  "- 文生图：`POST /v1/images/generations`",
  "- 参考图：`POST /v1/images/edits`，单张不超过 8 MB，单次不超过 32 MB",
  "- 认证：`Authorization: Bearer <密钥>`",
  "- 分辨率由尺寸和画幅决定，模型名不带档位",
  "- 图片直链保留 3 天，生成后会立即转存",
  "- 不支持蒙版局部重绘",
  "- 别名与官方名等价：`nano-banana-2` = `gemini-3.1-flash-image`，`nano-banana-pro` = `gemini-3-pro-image`，`nano-banana-2.1` = `gemini-nano-banana-2.1`",
].join("\n");

export function createOpenaiImagesSource(provider: { id: string; label: string; models: OpenaiImageModelInput[] }) {
  const id = provider.id.trim();
  const label = provider.label.trim();
  if (!providerIdPattern.test(id) || reservedProviderId.test(id)) throw new Error("Provider ID 须以小写字母开头，只含字母和数字，且不能是系统保留名");
  if (!label || label.length > 200) throw new Error("请输入显示名称");
  const models = provider.models.map(toOpenaiImageModel);
  if (!models.length || new Set(models.map(item => item.id)).size !== models.length) throw new Error("请至少添加一个模型，且模型 ID 不能为空或重复");
  const rules = [
    { type: "input", field: "apiUrl", title: "API 地址", value: "", props: { placeholder: "https://image.example.com" } },
    { type: "input", field: "apiKey", title: "API 密钥", value: "", props: { type: "password", showPassword: true, autocomplete: "off", placeholder: "sk-…" } },
  ];
  return `const rules = ${JSON.stringify(rules, null, 2)};

export default {
  id: ${JSON.stringify(id)},
  label: ${JSON.stringify(label)},
  protocol: ${JSON.stringify(openaiImagesProtocol)},
  version: "1.0.0",
  readme: ${JSON.stringify(readme)},
  rules,
  models: ${JSON.stringify(models, null, 2)},
};
`;
}

export function openaiImagesEndpoint(apiUrl: string, path: string) {
  let url: URL;
  try { url = new URL(apiUrl.trim()); }
  catch { fail("请输入有效的 HTTP API 地址"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail("请输入不含账号或查询参数的 HTTP API 地址");
  const pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1(?:\/images(?:\/(?:generations|edits))?)?$/, "");
  return `${url.origin}${pathname}${path}`;
}
