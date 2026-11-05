import { Router } from "express";
import { success } from "@/lib/responseFormat";

export default Router().post("/", async (req, res) => {
  if (!req.is("application/octet-stream") || !Buffer.isBuffer(req.body) || !req.body.length || req.body.length > 100 * 1024 * 1024) {
    throw Object.assign(new Error("请上传不超过 100 MB 的视频文件"), { status: 400 });
  }
  const bytes: Buffer = req.body;
  const header = bytes.subarray(0, 16).toString("ascii");
  const extension = header.slice(4, 8) === "ftyp" && !/avif|avis|M4A |M4B /.test(header.slice(8, 12))
    ? header.slice(8, 12) === "qt  " ? "mov" : "mp4"
    : bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) ? "webm" : undefined;
  if (!extension) throw Object.assign(new Error("仅支持 MP4、MOV 或 WebM 视频文件"), { status: 400 });
  const controller = new AbortController();
  const close = () => controller.abort();
  res.once("close", close);
  try {
    const form = new FormData();
    form.set("reqtype", "fileupload");
    form.set("time", "24h");
    form.set("fileToUpload", new Blob([new Uint8Array(bytes)], { type: extension === "mov" ? "video/quicktime" : `video/${extension}` }), `video.${extension}`);
    // ACT: 不落盘、不持有删除凭据；素材由 Litterbox 按 24 小时有效期自动过期，不主动删除远端对象。
    const response = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", {
      method: "POST", body: form, redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]),
    });
    if (!response.ok) throw Object.assign(new Error(`Litterbox 上传失败（HTTP ${response.status}），请稍后重试`), { status: 502 });
    const value = (await response.text()).trim();
    const url = value.length <= 2048 && URL.canParse(value) ? new URL(value) : undefined;
    if (!url || url.protocol !== "https:" || url.hostname !== "litter.catbox.moe" || url.port || url.username || url.password || url.search || url.hash || !/^\/[a-zA-Z0-9]+\.(?:mp4|mov|webm)$/.test(url.pathname)) {
      throw Object.assign(new Error("Litterbox 未返回有效的视频临时链接"), { status: 502 });
    }
    res.json(success({ url: url.href, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }));
  } finally {
    res.off("close", close);
  }
});
