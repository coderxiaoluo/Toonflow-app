# Toonflow

AI 短剧、漫剧与视频创作平台。本仓库 fork 自 [HBAI-Ltd/Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app)，在官方版本基础上做了本地修改，主要用于个人开发与使用。

- 官方上游：<https://github.com/HBAI-Ltd/Toonflow-app>
- 本仓库：<https://github.com/coderxiaoluo/Toonflow-app>

## 一、下载

### 直接使用桌面客户端

从官方发布页下载对应平台的安装包：

| 平台 | 下载地址 |
| --- | --- |
| Windows | [Release](https://github.com/HBAI-Ltd/Toonflow-app/releases) |
| macOS | [Release](https://github.com/HBAI-Ltd/Toonflow-app/releases) |
| Android ARM64 | [APK](https://github.com/HBAI-Ltd/Toonflow-app/releases/latest) |

Windows 安装器会自动检测并安装 WebView2；如果打开闪退，请到 [WebView2 下载页](https://developer.microsoft.com/microsoft-edge/webview2/) 手动安装运行时。

本仓库没有发布安装包，需要自己构建，见下文「构建安装包」。

### 下载源码

```powershell
git clone https://github.com/coderxiaoluo/Toonflow-app.git
cd Toonflow-app
```

## 二、如何启动

### 环境要求

- Git
- [Bun](https://bun.sh/) `1.4.3`（版本由根目录 `package.json` 的 `packageManager` 指定）

### 开发环境

```powershell
bun install

# 首次启动、或修改过插件后，先构建节点与工具并同步到 data/
bun run dev:plugins

# 同时启动 Web 与业务 Server
bun run dev
```

打开 <http://localhost:5173>。独立 Server 默认监听 `3000`，Web 开发服务会自动代理 API 请求。

### 桌面端开发

```powershell
bun run dev:desktop
```

会同步开发插件、构建 Web 并启动桌面应用。

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `bun run dev` | 同时启动 Web 与 Server |
| `bun run dev:web` | 只启动 Web 开发服务 |
| `bun run dev:server` | 只启动业务 Server |
| `bun run dev:plugins` | 构建节点和工具，同步到开发数据目录 |
| `bun run dev:desktop` | 启动桌面端开发 |
| `bun run build` | 构建工具、Web、Server、MCP 等 |
| `bun run build:server` | 构建独立部署所需的服务端产物 |
| `bun run package:desktop` | 生成当前平台的安装包（Windows NSIS / macOS DMG） |
| `bun run typecheck` | 各工作区类型检查 |

改动 `apps/server/src/routes` 下的接口文件后，在 `apps/server` 执行 `bun run routes` 重新生成路由。

## 三、Git 工作流

本地修改代码、拉取官方更新并同步到自己的仓库：

```powershell
# 1) 平时改代码后，传到自己仓库
git switch test
git add .
git commit -m "你的改动说明"
git push

# 2) 官方发新版后，拉下来合并再推
git switch master
git pull                                    # 拉官方
git switch test
git merge master                            # 合并到开发分支
git push                                    # 推到 fork
git switch master && git push fork master   # fork 的 master 也更新
```

远程说明：

| 远程 | 仓库 | 用途 |
| --- | --- | --- |
| `origin` | HBAI-Ltd/Toonflow-app | 官方上游，只拉取 |
| `fork` | coderxiaoluo/Toonflow-app | 自己的仓库，推送目标 |

## 许可证

[MIT](./LICENSE)
