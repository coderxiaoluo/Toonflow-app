import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, copyFile, existsSync, mkdir, readdir, readFile, realpath, rm, stat, writeAtomic } from "@toonflow/file";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/** 只使用已安装的 Windows 发行版，不联网、不安装依赖。 */
export default async function prepareFfmpeg(projectDir: string) {
  const explicitDirectory = process.env.TOONFLOW_FFMPEG_DIR?.trim();
  const candidates: string[] = [];
  if (explicitDirectory) candidates.push(resolve(explicitDirectory), resolve(explicitDirectory, "bin"));
  else {
    const executable = Bun.which("ffmpeg.exe");
    if (executable) candidates.push(dirname(await realpath(executable)));
    for (const base of [process.env.LOCALAPPDATA, process.env.ProgramFiles]) {
      if (!base) continue;
      const packages = join(base, "Microsoft/WinGet/Packages");
      const entries = await readdir(packages, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      for (const entry of entries.filter(item => item.isDirectory() && /ffmpeg/i.test(item.name))) {
        const directory = join(packages, entry.name);
        candidates.push(directory, join(directory, "bin"));
        for (const child of await readdir(directory, { withFileTypes: true })) {
          if (child.isDirectory()) candidates.push(join(directory, child.name), join(directory, child.name, "bin"));
        }
      }
    }
  }
  const binaryDirectory = candidates.find(directory => ["ffmpeg.exe", "ffprobe.exe"].every(name => existsSync(join(directory, name))));
  if (!binaryDirectory) {
    throw new Error("Windows 桌面构建缺少同一发行版的 ffmpeg.exe 和 ffprobe.exe。请先安装 FFmpeg，或设置 TOONFLOW_FFMPEG_DIR 为发行版根目录/bin；构建不会自动下载安装。");
  }
  const distributionDirectory = basename(binaryDirectory).toLowerCase() === "bin" ? dirname(binaryDirectory) : binaryDirectory;
  const noticesDirectory = resolve(process.env.TOONFLOW_FFMPEG_NOTICES_DIR?.trim() || distributionDirectory);
  const notices = await readdir(noticesDirectory, { withFileTypes: true }).catch(error => {
    throw new Error(`无法读取 FFmpeg 分发资料目录：${noticesDirectory}。请设置 TOONFLOW_FFMPEG_NOTICES_DIR。`, { cause: error });
  });
  const licenseNames = notices.filter(entry => entry.isFile() && /^(license|copying)([.-]|$)/i.test(entry.name)).map(entry => entry.name);
  const readmeName = notices.find(entry => entry.isFile() && /^readme([.-]|$)/i.test(entry.name))?.name;
  if (!licenseNames.length || !readmeName) {
    throw new Error("FFmpeg 分发资料不完整：需要 LICENSE/COPYING 和 README（对应版本的上游源码与构建信息）。请设置 TOONFLOW_FFMPEG_NOTICES_DIR 指向完整资料目录。");
  }
  const readme = await readFile(join(noticesDirectory, readmeName), "utf8");
  if (!/https?:\/\/\S+/i.test(readme) || !/source|源码/i.test(readme)) {
    throw new Error("FFmpeg README 缺少上游源码信息/链接，请提供与二进制对应的原始分发资料，不得用通用主页替代。");
  }
  const tools = [];
  for (const name of ["ffmpeg", "ffprobe"]) {
    const path = join(binaryDirectory, `${name}.exe`);
    const result = spawnSync(path, ["-version"], { encoding: "utf8", windowsHide: true, timeout: 30000 });
    if (result.error || result.status !== 0) throw new Error(`FFmpeg 构建输入无法执行：${path}`, { cause: result.error ?? result.stderr });
    if (/--enable-nonfree\b/.test(result.stdout)) throw new Error(`不能随包分发启用 --enable-nonfree 的 ${name}，请提供允许再分发的构建。`);
    tools.push({ name, versionAndConfiguration: result.stdout, sha256: createHash("sha256").update(await readFile(path)).digest("hex") });
  }
  const output = resolve(projectDir, "build/desktop/ffmpeg/windows");
  for (const input of [binaryDirectory, noticesDirectory]) {
    const inputFromOutput = relative(output, input);
    const outputFromInput = relative(input, output);
    if ((!isAbsolute(inputFromOutput) && !inputFromOutput.startsWith(".."))
      || (!isAbsolute(outputFromInput) && !outputFromInput.startsWith(".."))) {
      throw new Error("FFmpeg 输入与打包暂存目录不能相互包含，请将二进制及分发资料放在独立目录。");
    }
  }
  // ACT: 只重建本地打包暂存目录，避免旧发行版 DLL 或许可证混入新包。
  await rm(output, { recursive: true, force: true });
  await mkdir(join(output, "notices"), { recursive: true });
  for (const name of ["ffmpeg.exe", "ffprobe.exe", ...(await readdir(binaryDirectory)).filter(name => /\.dll$/i.test(name))]) {
    if (!(await stat(join(binaryDirectory, name))).isFile()) throw new Error(`FFmpeg 构建输入不是文件：${name}`);
    await copyFile(join(binaryDirectory, name), join(output, name));
  }
  if (process.env.TOONFLOW_FFMPEG_NOTICES_DIR?.trim()) {
    await cp(noticesDirectory, join(output, "notices"), { recursive: true });
  } else {
    for (const name of [...licenseNames, readmeName]) await copyFile(join(noticesDirectory, name), join(output, "notices", name));
    for (const name of ["licenses", "sources"]) {
      if (existsSync(join(noticesDirectory, name))) await cp(join(noticesDirectory, name), join(output, "notices", name), { recursive: true });
    }
  }
  await writeAtomic(join(output, "buildInfo.json"), JSON.stringify({
    tools,
    notice: "原始许可证和上游源码/构建信息见 notices。记录这些资料不代表已完成许可证合规审查；分发者仍须确认完整对应源码、构建脚本及所链接依赖的许可与提供义务。",
  }, null, 2));
  console.log(`Windows FFmpeg 构建输入：${binaryDirectory}；分发资料：${noticesDirectory}`);
}
