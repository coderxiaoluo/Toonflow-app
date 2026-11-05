import conf from "@/utils/conf";

export const developCcApiUrl = "https://api.develop.cc/v1";
export const developCcProtocol = "openai-completions";

export function getDevelopCcApiKey() {
  const value: unknown = conf.get("settings.developCc.apiKey");
  return typeof value === "string" ? value.trim().replace(/^Bearer(?:\s+|$)/i, "").trim() : "";
}

// ACT: 只执行随应用发布的适配器，磁盘旧文件仅用于读取模型元数据，不能取得统一密钥。
export const developCcSource = `export default {
  id: "developCc",
  label: "develop.cc",
  protocols: ["openai-images", "volcengine-ark"],
  modelsUrl: "https://api.develop.cc/v1/models",
  rules: [{ type: "input", field: "apiKey", title: "API Key", value: "" }],
  models: [],
};
`;
