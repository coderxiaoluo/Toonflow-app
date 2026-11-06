import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as timers from "node:timers/promises";
import { lstat, mkdir, open, readFile, realpath, stat, writeAtomic } from "@toonflow/file";
import { PATHS } from "electrobun/main";
import {
  cloudflaredExecutableName,
  cloudflaredMaxDownloadSize,
  cloudflaredRelease,
  cloudflaredSha256,
  currentCloudflaredAsset,
  downloadCloudflaredAsset,
  extractCloudflaredExecutable,
} from "./cloudflaredAsset";

const maxVideoSize = 100 * 1024 * 1024;
const installations = new Map<string, { controller: AbortController; promise: Promise<string>; users: number }>();

async function installCloudflared(directory: string, signal: AbortSignal) {
  const asset = currentCloudflaredAsset();
  if (!asset) throw new Error("本机视频隧道仅支持 Windows x64、macOS x64/arm64");
  const folder = join(directory, "cloudflared", cloudflaredRelease, `${process.platform}-${process.arch}`);
  await mkdir(folder, { recursive: true });
  signal.throwIfAborted();
  const archivePath = join(folder, "download");
  let archive: Buffer | undefined;
  try {
    const info = await lstat(archivePath);
    if (info.isFile() && info.size > 0 && info.size <= cloudflaredMaxDownloadSize) archive = await readFile(archivePath, { signal });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!archive || cloudflaredSha256(archive) !== asset.hash) {
    archive = await downloadCloudflaredAsset(asset.name, signal);
    if (cloudflaredSha256(archive) !== asset.hash) throw new Error("cloudflared SHA-256 校验失败");
    signal.throwIfAborted();
    await writeAtomic(archivePath, archive);
  }
  signal.throwIfAborted();
  const executable = process.platform === "win32" ? archive : extractCloudflaredExecutable(archive);
  const target = join(folder, cloudflaredExecutableName());
  // 每次使用都校验缓存，不执行 PATH 中版本和来源未知的程序。
  let valid = false;
  try {
    const info = await lstat(target);
    valid = info.isFile() && info.size === executable.length && (process.platform === "win32" || (info.mode & 0o111) !== 0)
      && cloudflaredSha256(await readFile(target, { signal })) === cloudflaredSha256(executable);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  signal.throwIfAborted();
  if (!valid) await writeAtomic(target, executable, { mode: 0o700 });
  signal.throwIfAborted();
  return target;
}

async function bundledCloudflaredPath(signal: AbortSignal) {
  const asset = currentCloudflaredAsset();
  if (!asset) return undefined;
  const path = join(PATHS.RESOURCES_FOLDER, "app", cloudflaredExecutableName());
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size <= 0 || info.size > cloudflaredMaxDownloadSize) return undefined;
    if (process.platform !== "win32" && (info.mode & 0o111) === 0) return undefined;
    signal.throwIfAborted();
    if (cloudflaredSha256(await readFile(path, { signal })) !== asset.executableHash) return undefined;
    return path;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function cloudflaredPath(directory: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const bundled = await bundledCloudflaredPath(signal);
  if (bundled) return bundled;
  const key = resolve(directory);
  let job = installations.get(key);
  if (!job || job.controller.signal.aborted) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("cloudflared 安装超过 3 分钟")), 180000);
    const created = { controller, promise: Promise.resolve(""), users: 0 };
    created.promise = installCloudflared(key, controller.signal).finally(() => {
      clearTimeout(timeout);
      if (installations.get(key) === created) installations.delete(key);
    });
    job = created;
    installations.set(key, job);
  }
  job.users++;
  const current = job;
  let abort: () => void = () => {};
  try {
    return await Promise.race([current.promise, new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason ?? new Error("视频生成已取消"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally {
    signal.removeEventListener("abort", abort);
    if (--current.users === 0) current.controller.abort();
  }
}

function rangeHeader(value: string | undefined, size: number) {
  if (!value) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const first = Number(match[1]);
  const last = Number(match[2]);
  if ((match[1] && !Number.isSafeInteger(first)) || (match[2] && !Number.isSafeInteger(last))) return null;
  const start = match[1] ? first : Math.max(0, size - last);
  const end = match[1] && match[2] ? Math.min(size - 1, last) : size - 1;
  return start >= 0 && start <= end && start < size ? { start, end } : null;
}

function assertInside(root: string, path: string) {
  const part = relative(root, path);
  if (!part || isAbsolute(part) || part === ".." || part.startsWith(`..${sep}`)) throw new Error("视频路径超出工作区");
}

function videoMime(header: Buffer) {
  if (header.length >= 12 && header.toString("ascii", 4, 8) === "ftyp") {
    const brand = header.toString("ascii", 8, 12);
    if (brand === "qt  ") return "video/quicktime";
    if (/^(isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash)$/.test(brand)) return "video/mp4";
  }
  if (header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    if (header.includes(Buffer.from("webm"))) return "video/webm";
    if (header.includes(Buffer.from("matroska"))) return "video/x-matroska";
  }
  if (header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "AVI ") return "video/x-msvideo";
  throw new Error("无法识别本地视频格式，仅支持 MP4、MOV、WebM、MKV、AVI");
}

async function waitForPublicVideo(url: string, size: number, samples: { start: number; bytes: Buffer }[], signal: AbortSignal) {
  const readinessSignal = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
  let lastError: unknown;
  while (!readinessSignal.aborted) {
    try {
      const requestSignal = AbortSignal.any([readinessSignal, AbortSignal.timeout(10000)]);
      const head = await fetch(url, { method: "HEAD", redirect: "error", signal: requestSignal });
      if (head.status !== 200 || head.headers.get("content-type")?.split(";")[0].trim() !== "video/mp4"
        || head.headers.get("content-length") !== String(size)) throw new Error("公网视频响应类型或长度不正确");
      for (const sample of samples) {
        const end = sample.start + sample.bytes.length - 1;
        const response = await fetch(url, {
          headers: { Range: `bytes=${sample.start}-${end}`, "Accept-Encoding": "identity" },
          redirect: "error", signal: requestSignal,
        });
        try {
          if (response.status !== 206 || response.headers.get("content-range") !== `bytes ${sample.start}-${end}/${size}`
            || response.headers.get("content-type")?.split(";")[0].trim() !== "video/mp4"
            || response.headers.get("content-length") !== String(sample.bytes.length) || !response.body) {
            throw new Error("公网视频不支持正确的分段下载");
          }
          const reader = response.body.getReader();
          try {
            let offset = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (offset + value.length > sample.bytes.length
                || !sample.bytes.subarray(offset, offset + value.length).equals(value)) throw new Error("公网视频内容与本地文件不一致");
              offset += value.length;
            }
            if (offset !== sample.bytes.length) throw new Error("公网视频分段下载不完整");
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        } finally { await response.body?.cancel().catch(() => {}); }
      }
      readinessSignal.throwIfAborted();
      return;
    } catch (error) {
      lastError = error;
      if (readinessSignal.aborted) break;
      await timers.setTimeout(2000, undefined, { signal: readinessSignal }).catch(() => {});
    }
  }
  signal.throwIfAborted();
  throw new Error("参考视频临时公网链接在 60 秒内未能通过 MP4 头尾分段读取校验，已停止提交生成。请检查网络或使用稳定的公网 MP4 直链。", { cause: lastError });
}

export function createMediaVideoTunnel(dataDirectory: string) {
  const active = new Set<() => Promise<void>>();
  const createTunnel = async (workspaceDirectory: string, relativePath: string, signal?: AbortSignal, report?: (message: string) => void) => {
    signal?.throwIfAborted();
    if (!relativePath || isAbsolute(relativePath) || relativePath.includes(":")) throw new Error("视频必须使用工作区相对路径");
    const root = await realpath(workspaceDirectory);
    const path = resolve(root, relativePath);
    assertInside(root, path);
    const filePath = await realpath(path);
    assertInside(root, filePath);
    const handle = await open(filePath, "r");
    const controller = new AbortController();
    const sockets = new Set<Socket>();
    const streams = new Set<Readable>();
    const transfers = new Set<Promise<void>>();
    let child: ChildProcess | undefined;
    let stopping: Promise<void> | undefined;
    let lifetime: ReturnType<typeof setTimeout> | undefined;
    let publicReady = false;
    let remoteRequests = 0;
    let completedReads = 0;
    const token = randomBytes(32).toString("hex");
    const server = createServer();
    const onAbort = () => { void stop().catch(error => console.warn("视频隧道关闭失败", error)); };
    const stop = () => {
      if (stopping) return stopping;
      controller.abort(new Error("视频隧道已停止"));
      signal?.removeEventListener("abort", onAbort);
      clearTimeout(lifetime);
      stopping = (async () => {
        for (const stream of streams) stream.destroy();
        for (const socket of sockets) socket.destroy();
        const closing = new Promise<void>(done => { server.close(() => done()); });
        const processClosing = child && child.exitCode === null && child.signalCode === null ? new Promise<void>(done => {
          const process = child!;
          const killTimer = setTimeout(() => process.kill("SIGKILL"), 2000);
          const finish = () => { clearTimeout(killTimer); process.off("close", finish); done(); };
          process.once("close", finish);
          process.kill();
        }) : Promise.resolve();
        await Promise.all([closing, processClosing, ...transfers]);
        await handle.close();
        active.delete(stop);
      })();
      return stopping;
    };
    active.add(stop);
    server.on("connection", socket => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      if (controller.signal.aborted) socket.destroy();
    });
    server.on("error", onAbort);
    server.requestTimeout = 30000;
    server.headersTimeout = 15000;
    server.setTimeout(30000, socket => socket.destroy());
    signal?.addEventListener("abort", onAbort, { once: true });
    lifetime = setTimeout(onAbort, 30 * 60 * 1000);
    try {
      signal?.throwIfAborted();
      const info = await handle.stat();
      if (!info.isFile() || info.size <= 0 || info.size > maxVideoSize) throw new Error("隧道视频须为不超过 100 MB 的普通文件");
      // 打开后再次检查真实路径与文件身份；后续读取始终使用这个句柄，路径替换不会暴露其他文件。
      assertInside(root, await realpath(path));
      const current = await stat(path);
      if (current.dev !== info.dev || current.ino !== info.ino) throw new Error("视频文件在授权期间发生变化");
      const header = Buffer.alloc(Math.min(4096, info.size));
      await handle.read(header, 0, header.length, 0);
      const mime = videoMime(header);
      if (mime !== "video/mp4") throw new Error("本地参考视频须为 MP4，请先转换视频格式后再提交；仅修改文件后缀无效");
      const videoPath = `/${token}/reference.mp4`;
      const executable = await cloudflaredPath(dataDirectory, controller.signal);
      controller.signal.throwIfAborted();
      server.on("request", (request, response) => {
        if (controller.signal.aborted || request.url !== videoPath) return void response.writeHead(404).end();
        if (request.method !== "GET" && request.method !== "HEAD") return void response.writeHead(405, { Allow: "GET, HEAD" }).end();
        const range = rangeHeader(request.headers.range, info.size);
        if (range === null) return void response.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
        const start = range?.start ?? 0;
        const end = range?.end ?? info.size - 1;
        response.writeHead(range ? 206 : 200, {
          "Accept-Ranges": "bytes", "Cache-Control": "no-store", "Content-Type": mime,
          "X-Content-Type-Options": "nosniff", "Content-Length": end - start + 1,
          ...(range ? { "Content-Range": `bytes ${start}-${end}/${info.size}` } : {}),
        });
        if (request.method === "HEAD") return void response.end();
        const remote = publicReady;
        if (remote && remoteRequests++ === 0) report?.("观察到公网 GET 请求（排除本机自检）；尚不能确认请求方身份或视频解析成功");
        const stream = handle.createReadStream({ start, end, autoClose: false });
        streams.add(stream);
        const transfer = pipeline(stream, response).then(() => {
          if (remote && completedReads++ < 4) report?.(`公网响应发送完成：bytes ${start}-${end}/${info.size}${!range ? "（完整文件）" : "（分段）"}；不等于供应商已成功解析`);
        }).catch(() => {
          if (remote && remoteRequests <= 4) report?.("公网视频传输中断，未确认本次读取完成");
          response.destroy();
        }).finally(() => {
          streams.delete(stream);
          transfers.delete(transfer);
        });
        transfers.add(transfer);
      });
      await new Promise<void>((ok, fail) => {
        const cleanup = () => {
          server.off("error", onError);
          server.off("listening", onListen);
          controller.signal.removeEventListener("abort", onStop);
        };
        const onError = (error: Error) => { cleanup(); fail(error); };
        const onListen = () => { cleanup(); ok(); };
        const onStop = () => { cleanup(); fail(new Error("视频隧道已停止")); };
        server.once("error", onError);
        server.once("listening", onListen);
        controller.signal.addEventListener("abort", onStop, { once: true });
        server.listen({ port: 0, host: "127.0.0.1", signal: controller.signal });
        if (controller.signal.aborted) onStop();
      });
      controller.signal.throwIfAborted();
      const port = (server.address() as import("node:net").AddressInfo).port;
      child = spawn(executable, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const tunnelProcess = child;
      tunnelProcess.on("error", onAbort);
      tunnelProcess.once("exit", onAbort);
      const address = await new Promise<string>((ok, fail) => {
        let output = "";
        const timer = setTimeout(() => finish(new Error("Cloudflare Quick Tunnel 启动超时")), 60000);
        const finish = (error?: Error, url?: string) => {
          clearTimeout(timer);
          tunnelProcess.stdout?.off("data", inspect);
          tunnelProcess.stderr?.off("data", inspect);
          tunnelProcess.off("error", onError);
          tunnelProcess.off("exit", onExit);
          controller.signal.removeEventListener("abort", onStop);
          error ? fail(error) : ok(url!);
        };
        const inspect = (chunk: Buffer) => {
          output = (output + chunk.toString()).slice(-16000);
          const url = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com(?=[\s/]|$)/i)?.[0];
          if (url) finish(undefined, url);
        };
        const onError = (error: Error) => finish(error);
        const onExit = () => finish(new Error("cloudflared 提前退出"));
        const onStop = () => finish(new Error("视频隧道已取消或停止"));
        tunnelProcess.stdout?.on("data", inspect);
        tunnelProcess.stderr?.on("data", inspect);
        tunnelProcess.once("error", onError);
        tunnelProcess.once("exit", onExit);
        controller.signal.addEventListener("abort", onStop, { once: true });
        if (controller.signal.aborted) onStop();
      });
      // 不保留日志解析监听器，但继续消费管道，避免子进程因日志背压阻塞。
      tunnelProcess.stdout?.resume();
      tunnelProcess.stderr?.resume();
      controller.signal.throwIfAborted();
      const url = `${address}${videoPath}`;
      const samples = [];
      // ACT: 只读取头尾各 4 KB，验证公网就绪与 Range seek；不能保证供应商网络可达或媒体编码受支持。
      for (const start of [...new Set([0, Math.max(0, info.size - 4096)])]) {
        const bytes = Buffer.alloc(Math.min(4096, info.size - start));
        const read = await handle.read(bytes, 0, bytes.length, start);
        if (read.bytesRead !== bytes.length) throw new Error("参考视频在公网校验前发生变化");
        samples.push({ start, bytes });
      }
      await waitForPublicVideo(url, info.size, samples, controller.signal);
      publicReady = true;
      report?.(`公网自检通过：MP4 ${info.size} 字节，HEAD 和头尾 Range 内容一致；等待非自检远端读取`);
      return { url, stop };
    } catch (error) {
      await stop();
      throw error;
    }
  };
  return Object.assign(createTunnel, { stopAll: () => Promise.all([...active].map(stop => stop())).then(() => undefined) });
}
