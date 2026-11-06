import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

export const cloudflaredRelease = "2026.10.7";
// 官方 release assets 的 SHA-256 digest（tgz 校验压缩包；Windows 资源本身就是 exe）。
// https://api.github.com/repos/cloudflare/cloudflared/releases/tags/2026.10.7
// executableHash：磁盘上可执行文件本体的 SHA-256（mac 与压缩包 hash 不同）。
export const cloudflaredPlatformAssets = {
  win32: {
    name: "cloudflared-windows-amd64.exe",
    hash: "2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343",
    executableHash: "2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343",
  },
  darwinArm64: {
    name: "cloudflared-darwin-arm64.tgz",
    hash: "3586ccf397e98e5f437e60e7c307ca6ac463e110580503af8bb8e6f9ebf831bd",
    executableHash: "2136431d5eb467bf447d2ee514b713e192719b143aec1d9e09bf7dc290d5bb12",
  },
  darwinAmd64: {
    name: "cloudflared-darwin-amd64.tgz",
    hash: "02f3edfd87684dd5b705607688e4eb4b323f6e777b81e7b3a85af556aa356848",
    executableHash: "5c55e77da7012cebca19170357e196176c48c9647cc2ead404702fa125ddbd86",
  },
} as const;

export const cloudflaredMaxDownloadSize = 80 * 1024 * 1024;

export type CloudflaredAsset = (typeof cloudflaredPlatformAssets)[keyof typeof cloudflaredPlatformAssets];

export function cloudflaredSha256(content: Uint8Array) {
  return createHash("sha256").update(content).digest("hex");
}

export function currentCloudflaredAsset(): CloudflaredAsset | undefined {
  return process.platform === "win32" && process.arch === "x64" ? cloudflaredPlatformAssets.win32
    : process.platform === "darwin" && process.arch === "arm64" ? cloudflaredPlatformAssets.darwinArm64
    : process.platform === "darwin" && process.arch === "x64" ? cloudflaredPlatformAssets.darwinAmd64
    : undefined;
}

export function cloudflaredExecutableName() {
  return process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

export async function downloadCloudflaredAsset(name: string, signal?: AbortSignal) {
  let url = new URL(`https://github.com/cloudflare/cloudflared/releases/download/${cloudflaredRelease}/${name}`);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (url.protocol !== "https:" || url.username || url.password || url.port
      || !["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(url.hostname)) {
      throw new Error("cloudflared 下载重定向不属于官方 GitHub HTTPS 地址");
    }
    const response = await fetch(url, { redirect: "manual", signal, headers: { "User-Agent": "Toonflow" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("cloudflared 下载重定向缺少地址");
      url = new URL(location, url);
      continue;
    }
    const declared = response.headers.get("content-length");
    if (!response.ok || !response.body || (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > cloudflaredMaxDownloadSize))) {
      await response.body?.cancel();
      throw new Error(`下载 cloudflared 失败或文件过大（HTTP ${response.status}）`);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > cloudflaredMaxDownloadSize) throw new Error("cloudflared 下载超过 80 MB 上限");
        chunks.push(value);
      }
      return Buffer.concat(chunks, size);
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  throw new Error("cloudflared 下载重定向次数过多");
}

export function extractCloudflaredExecutable(archive: Buffer) {
  // ACT: 固定官方 tgz，仅在内存中读取 cloudflared 普通文件，不将归档路径写入磁盘。
  const tar = gunzipSync(archive, { maxOutputLength: 128 * 1024 * 1024 });
  let executable: Buffer | undefined;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString().split("\0")[0];
    const sizeField = header.subarray(124, 136).toString().replace(/\0.*$/, "").trim();
    if (!/^[0-7]+$/.test(sizeField)) throw new Error("cloudflared 归档长度无效");
    const size = parseInt(sizeField, 8);
    const start = offset + 512;
    if (!Number.isSafeInteger(size) || start + size > tar.length) throw new Error("cloudflared 归档不完整");
    if (name === "cloudflared" || name === "./cloudflared") {
      if (executable || ![0, 48].includes(header[156]!) || header.subarray(345, 500).some(byte => byte !== 0)) {
        throw new Error("cloudflared 归档不是唯一的普通可执行文件");
      }
      executable = tar.subarray(start, start + size);
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  if (!executable?.length || executable.length > cloudflaredMaxDownloadSize) throw new Error("cloudflared 归档缺少可执行文件");
  return executable;
}
