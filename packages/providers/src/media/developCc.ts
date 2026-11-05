// ACT: 宿主禁止供应商 import，模型须为字面量；以下规格与现有协议 catalog 匹配，待服务端动态元数据确认后覆盖。
const rules = [
  {
    type: "input",
    field: "apiKey" as const,
    title: "API 密钥",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
] as const;

export default {
  id: "developCc",
  label: "develop.cc",
  icon: "",
  version: "1.0.0",
  protocols: ["openai-images", "volcengine-ark"],
  modelsUrl: "https://image.develop.cc/v1/models",
  readme: "## develop.cc\n\n图片使用 https://image.develop.cc 的 OpenAI Images generations/edits；视频使用 https://video.develop.cc 的火山 Ark 任务提交与轮询。两者共用 API 密钥。\n\n内置模型规格沿用现有 OpenAI Images、火山 Ark catalog，尚未联网确认。可通过获取模型列表读取 /v1/models 返回的 modelInfo 并覆盖同名规格；/v1/spec 的响应结构尚未确认，不猜测元数据。",
  rules,
  models: [
    {
      id: "gpt-image-2", label: "gpt-image-2", type: "image",
      mode: ["text", "singleImage", "multiReference"], imageReferences: 16,
      imageSizes: ["1K", "2K", "4K"], imageRatios: ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "5:4", "4:5"],
    },
    {
      id: "gpt-image-2.5-flare", label: "gpt-image-2.5-flare", type: "image",
      mode: ["text", "singleImage", "multiReference"], imageReferences: 16,
      imageSizes: ["1K", "2K", "4K"], imageRatios: ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "5:4", "4:5"],
    },
    {
      id: "gpt-image-2.5-sunburst", label: "gpt-image-2.5-sunburst", type: "image",
      mode: ["text", "singleImage", "multiReference"], imageReferences: 16,
      imageSizes: ["1K", "2K", "4K"], imageRatios: ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "5:4", "4:5"],
    },
    {
      id: "gemini-3.1-flash-image", label: "Nano Banana 2", type: "image",
      mode: ["text", "singleImage", "multiReference"], imageReferences: 14,
      imageSizes: ["1K", "2K", "4K"], imageRatios: ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "5:4", "4:5"],
    },
    {
      id: "gemini-3-pro-image", label: "Nano Banana Pro", type: "image",
      mode: ["text", "singleImage", "multiReference"], imageReferences: 14,
      imageSizes: ["1K", "2K", "4K"], imageRatios: ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "5:4", "4:5"],
    },
    {
      id: "gemini-nano-banana-2.1", label: "Nano Banana 2.1", type: "image",
      mode: ["text", "singleImage", "multiReference"], imageReferences: 14,
      imageSizes: ["1K", "2K", "4K"], imageRatios: ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "5:4", "4:5"],
    },
    {
      id: "image-01", label: "image-01", type: "image",
      mode: ["text", "singleImage"], imageReferences: 1,
      imageSizes: ["1K"], imageRatios: ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "5:4", "4:5"],
    },
    {
      id: "image-01-live", label: "image-01-live", type: "image",
      mode: ["text", "singleImage"], imageReferences: 1,
      imageSizes: ["1K"], imageRatios: ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "5:4", "4:5"],
    },
    {
      id: "image-test", label: "image-test", type: "image",
      mode: ["text"], imageReferences: 0, imageSizes: ["1K"], imageRatios: ["1:1"],
    },
    {
      id: "seedance-2.0", label: "Seedance 2.0", type: "video",
      mode: ["text", ["imageReference:4", "videoReference:1", "audioReference:1"]], audio: "optional",
      videoRatios: ["16:9", "9:16", "1:1"], defaultResolution: "1080p", defaultDuration: 5,
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["720p", "1080p", "4k"] }],
    },
    {
      id: "seedance-2.0-fast", label: "Seedance 2.0 Fast", type: "video",
      mode: ["text", ["imageReference:4", "videoReference:1", "audioReference:1"]], audio: "optional",
      videoRatios: ["16:9", "9:16", "1:1"], defaultResolution: "720p", defaultDuration: 5,
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p"] }],
    },
    {
      id: "seedance-2.0-mini", label: "Seedance 2.0 Mini", type: "video",
      mode: ["text", ["imageReference:9", "videoReference:3", "audioReference:3"]], audio: "optional",
      videoRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"], defaultResolution: "720p", defaultDuration: 5,
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p"] }],
    },
    {
      id: "seedance-2.5", label: "Seedance 2.5", type: "video",
      mode: ["text", ["imageReference:30", "videoReference:10", "audioReference:10"]], audio: "optional",
      videoRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], defaultResolution: "720p", defaultDuration: 5,
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30], resolution: ["480p", "720p", "1080p"] }],
    },
    {
      id: "video-test", label: "video-test 测试", type: "video",
      mode: ["text", ["imageReference:9", "videoReference:3", "audioReference:3"]], audio: "optional",
      videoRatios: ["16:9", "9:16", "1:1"], defaultResolution: "720p", defaultDuration: 4,
      durationResolutionMap: [{ duration: [4], resolution: ["480p", "720p", "1080p", "4k"] }],
    },
  ],
} satisfies ProviderDefinition<typeof rules>;
