export const volcengineArkProtocol = "volcengine-ark";

export type VolcengineArkModelInput = {
  id: string;
  label: string;
  resolutions: string[];
  defaultResolution: string;
  videoRatios: string[];
  durations: number[];
  defaultDuration: number;
  imageReferences: number;
  videoReferences: number;
  audioReferences: number;
};

type Family = Omit<VolcengineArkModelInput, "durations"> & { duration: number | [number, number] };

function durationsOf(duration: number | [number, number]) {
  if (typeof duration === "number") return [duration];
  const [start, end] = duration;
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

const families: Family[] = [
  { id: "seedance-2.0", label: "Seedance 2.0", resolutions: ["720p", "1080p", "4k"], defaultResolution: "1080p", videoRatios: ["16:9", "9:16", "1:1"], duration: [4, 15], defaultDuration: 5, imageReferences: 4, videoReferences: 1, audioReferences: 1 },
  { id: "seedance-2.0-fast", label: "Seedance 2.0 Fast", resolutions: ["480p", "720p"], defaultResolution: "720p", videoRatios: ["16:9", "9:16", "1:1"], duration: [4, 15], defaultDuration: 5, imageReferences: 4, videoReferences: 1, audioReferences: 1 },
  { id: "seedance-2.0-mini", label: "Seedance 2.0 Mini", resolutions: ["480p", "720p"], defaultResolution: "720p", videoRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"], duration: [4, 15], defaultDuration: 5, imageReferences: 9, videoReferences: 3, audioReferences: 3 },
  { id: "seedance-2.5", label: "Seedance 2.5", resolutions: ["480p", "720p", "1080p"], defaultResolution: "720p", videoRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], duration: [4, 30], defaultDuration: 5, imageReferences: 30, videoReferences: 10, audioReferences: 10 },
  { id: "video-test", label: "video-test 测试", resolutions: ["480p", "720p", "1080p", "4k"], defaultResolution: "720p", videoRatios: ["16:9", "9:16", "1:1"], duration: 4, defaultDuration: 4, imageReferences: 9, videoReferences: 3, audioReferences: 3 },
];

function familyInput(family: Family): VolcengineArkModelInput {
  const { duration, ...rest } = family;
  return { ...rest, durations: durationsOf(duration) };
}

export function recommendedVolcengineArkModels() {
  return families.map(familyInput);
}

export function volcengineArkManualTemplate(): VolcengineArkModelInput {
  const template = recommendedVolcengineArkModels().find(item => item.id === "seedance-2.0");
  if (!template) throw new Error("缺少 Seedance 2.0 规格");
  return { ...template, id: "", label: "" };
}

export function toVolcengineArkModel(input: VolcengineArkModelInput) {
  const id = input.id.trim();
  const label = input.label.trim() || id;
  return {
    id,
    label,
    type: "video" as const,
    mode: ["text", [
      `imageReference:${input.imageReferences}`,
      `videoReference:${input.videoReferences}`,
      `audioReference:${input.audioReferences}`,
    ]],
    audio: "optional" as const,
    videoRatios: input.videoRatios,
    defaultResolution: input.defaultResolution,
    defaultDuration: input.defaultDuration,
    durationResolutionMap: [{ duration: input.durations, resolution: input.resolutions }],
  };
}

const providerIdPattern = /^[a-z][a-zA-Z0-9]{0,95}$/;
const reservedProviderId = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function assertVolcengineArkProviderId(id: string) {
  if (!providerIdPattern.test(id) || reservedProviderId.test(id)) {
    throw new Error("Provider ID 须以小写字母开头，只含字母和数字，且不能是系统保留名");
  }
}

const readme = [
  "## 火山方舟兼容视频",
  "",
  "用自己的 API 密钥调用账户。API 地址填写站点根地址，例如 `https://api.example.com`。",
  "",
  "- 余额：`GET /api/v1/account/balance`",
  "- 视频：`POST /api/v3/contents/generations/tasks`，再轮询 `GET /api/v3/contents/generations/tasks/{id}`",
  "- 密钥可带或不带 `sk-` 前缀",
  "- 参考图、参考音频支持本地文件；参考视频只接受公网地址",
  "- 失败和内容审核拒绝会由服务方自动退款",
].join("\n");

export function createVolcengineArkSource(provider: { id: string; label: string; models: VolcengineArkModelInput[] }) {
  const id = provider.id.trim();
  const label = provider.label.trim();
  assertVolcengineArkProviderId(id);
  if (!label || label.length > 200) throw new Error("请输入显示名称");
  const ids = provider.models.map(item => item.id.trim());
  if (!ids.length || ids.some(item => !item) || new Set(ids).size !== ids.length) throw new Error("请至少添加一个模型，且模型 ID 不能为空或重复");
  const models = provider.models.map(toVolcengineArkModel);
  const rules = [
    { type: "input", field: "apiUrl", title: "API 地址", value: "", props: { placeholder: "https://api.example.com" } },
    { type: "input", field: "apiKey", title: "API 密钥", value: "", props: { type: "password", showPassword: true, autocomplete: "off", placeholder: "sk-…" } },
  ];
  return `const rules = ${JSON.stringify(rules, null, 2)};

export default {
  id: ${JSON.stringify(id)},
  label: ${JSON.stringify(label)},
  protocol: ${JSON.stringify(volcengineArkProtocol)},
  version: "1.0.0",
  readme: ${JSON.stringify(readme)},
  rules,
  models: ${JSON.stringify(models, null, 2)},
};
`;
}

export function volcengineEndpoint(apiUrl: string, path: string) {
  let url: URL;
  try { url = new URL(apiUrl.trim()); }
  catch { throw Object.assign(new Error("请输入有效的 HTTP API 地址"), { status: 400 }); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw Object.assign(new Error("请输入不含账号或查询参数的 HTTP API 地址"), { status: 400 });
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  const prefix = pathname === "" || pathname === "/" || /^\/api(?:\/v\d+)?$/.test(pathname) ? "" : pathname;
  return `${url.origin}${prefix}${path}`;
}
