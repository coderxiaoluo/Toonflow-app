import { join, resolve } from "node:path";
import { mkdir, writeAtomic } from "@toonflow/file";
import {
  cloudflaredExecutableName,
  cloudflaredSha256,
  currentCloudflaredAsset,
  downloadCloudflaredAsset,
  extractCloudflaredExecutable,
} from "../src/cloudflaredAsset";

/** 下载并校验当前平台 cloudflared，写入 build/desktop/cloudflared/；失败必须抛错。 */
export default async function prepareCloudflared(projectDir: string) {
  const asset = currentCloudflaredAsset();
  if (!asset) throw new Error("桌面构建的 cloudflared 仅支持 Windows x64、macOS x64/arm64。");
  const outputDirectory = resolve(projectDir, "build/desktop/cloudflared");
  await mkdir(outputDirectory, { recursive: true });
  const archive = await downloadCloudflaredAsset(asset.name);
  if (cloudflaredSha256(archive) !== asset.hash) throw new Error("cloudflared 资源 SHA-256 校验失败");
  const executable = process.platform === "win32" ? archive : extractCloudflaredExecutable(archive);
  if (cloudflaredSha256(executable) !== asset.executableHash) throw new Error("cloudflared 可执行文件 SHA-256 校验失败");
  const target = join(outputDirectory, cloudflaredExecutableName());
  await writeAtomic(target, executable, { mode: 0o700 });
  return target;
}

if (import.meta.main) {
  const projectDir = resolve(import.meta.dir, "../../..");
  const target = await prepareCloudflared(projectDir);
  console.log(`cloudflared 已准备：${target}`);
}
