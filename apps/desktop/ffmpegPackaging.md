# Windows 内置 FFmpeg 构建输入

Windows 桌面 build/dev/package 使用本机已安装的 FFmpeg，不会下载安装。
查找顺序：`TOONFLOW_FFMPEG_DIR`（指定后不回退）、系统 PATH 中 ffmpeg 的真实目录、用户/机器 WinGet Packages 中的 FFmpeg 目录。
同目录必须有 `ffmpeg.exe`、`ffprobe.exe`，相邻 DLL 一并复制。

可在 PowerShell 显式指定输入，再执行现有命令：

```powershell
$env:TOONFLOW_FFMPEG_DIR = "C:/path/to/ffmpeg"
# 发行版未在根目录附带分发资料时必须指定；该目录会完整复制，勿放无关文件。
$env:TOONFLOW_FFMPEG_NOTICES_DIR = "C:/path/to/ffmpegNotices"
bun run package:desktop
```

未指定 notices 目录时，从发行版根目录复制原始 LICENSE/COPYING、README，以及存在的 licenses/sources 目录。
README 必须包含与该二进制对应的源码信息/链接；程序实际输出的版本、配置与二进制 SHA-256 存入 buildInfo.json。
输出为 `build/desktop/ffmpeg/windows`，随包进入 `Resources/app/ffmpeg`。
自动模式依次选下载版、内置版、系统 PATH；system/download 模式仍只使用其指定来源，不修改 PATH。

## 分发边界

文件存在性和版本检查不是法律合规结论。必须人工确认原始资料对应实际二进制，包括链接依赖的许可证、完整对应源码及构建/安装脚本的提供义务。
只附 FFmpeg 主仓库链接不当然满足 GPL/LGPL 的完整对应源码要求；若需要，准备完整资料目录并通过 TOONFLOW_FFMPEG_NOTICES_DIR 随包携带。启用 --enable-nonfree 的输入拒绝打包。
本机 Gyan 发行版原始 README 提供源码提交、构建配置和依赖版本，LICENSE 为 GPLv3；这些事实本身不证明全部分发义务已经满足。

## CI 阻塞

`.github/workflows/release.yml` 的 Windows 作业复用 `debug.yml`；当前工作流未显式准备 FFmpeg 和对应分发资料，不能保证 hosted runner 提供完整输入。
未新增自动下载或安装步骤，也未静默构建不含 FFmpeg 的包。首次运行 Windows CI 前，维护者必须在运行器准备允许分发的 Windows x64 发行版和完整资料，并向构建进程设置上述变量；否则构建会在耗时步骤之前给出缺失输入错误。
macOS/Android 构建不受此输入要求影响。完整 Windows 打包和产物验收由主代理执行。
