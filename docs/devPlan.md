# Toonflow 开发实施计划

依据 `docs/refactorPlan.md`，在现有技术栈上实施。不更换 Vue、Vite、Pinia、Element Plus、Vue Flow、Bun、Express、Zod。本期新增的只有公司部署所缺的会话、数据库、对象存储和任务队列。

| 项 | 约定 |
| --- | --- |
| 周期 | 16 周，与重构方案一致 |
| 人员 | 1 名前端，1～2 名后端；后端兼 worker 和部署 |
| 做法 | 画布组件不重写。先把「本机目录」换成「项目 ID」，文件接口形状保持不变，再把磁盘实现换成数据库和对象存储 |
| 完成标准 | 用户登录后选已发布模型，在服务器上的项目里完成保存画布和一次生成 |

---

## 1. 现有栈怎么用

| 层 | 继续使用 | 本期新增 | 不引入 |
| --- | --- | --- | --- |
| 前端 | Vue 3、Vite、Vue Router、Pinia、Element Plus、Vue Flow、Axios、Sass | 登录页、项目列表改接口、管理页 | 不换 React，不换画布库 |
| 后端 | Bun、Express 5、Zod、`validateFields`、一接口一文件、`bun run routes` | 会话中间件、PostgreSQL、项目权限 | 不换 Nest，不拆微服务 |
| 中间件 | `cors`、`languageRequest`、`express.json`、统一错误处理 | 读 Cookie 的会话、登录校验、按项目鉴权 | 不加服务网格 |
| 数据 | `@toonflow/file` 仍用于临时文件和导入 | PostgreSQL、Redis、S3 兼容对象存储 | 不把成片放进数据库 |
| 模型 | 现有提供方适配（DeepSeek、火山方舟等） | 路由表上的密钥引用、任务表、worker 进程 | 不让用户再写 `customProviders` |

数据库访问用 `postgres`（postgres.js）加 SQL 迁移文件，不引入 ORM。密码哈希用 Bun 自带的 `Bun.password`（Argon2id）。Redis 用 `ioredis`，只放会话、编辑锁、限流和队列通知。对象存储用 `@aws-sdk/client-s3`，开发环境对 MinIO，生产对公司对象存储。

`settings.json` 只保留与用户无关的进程配置（监听、数据目录、存储连接可以从环境变量读取）。用户、项目、画布、额度不再写入这份文件。

---

## 2. 代码落点

现有调用链：

```text
首页 / 画布
  → Pinia workspace（project.directory 是本机路径，并持久化在浏览器）
  → useWorkspaceFiles()
  → /api/workspaces/files/*（请求里带 directory）
  → @toonflow/file 读写该目录

设置页
  → settings.customProviders（含 apiKey）
  → PUT /api/settings/save
  → settings.json
  → utils/ai、utils/media 按密钥调用上游
```

目标调用链：

```text
登录
  → Cookie 会话
  → /api/projects
  → Pinia 只保存当前 projectId

画布
  → useWorkspaceFiles() 改为带 projectId
  → /api/projects/:projectId/files/*
  → 鉴权后读 PostgreSQL 画布，或对象存储素材

生成
  → 只提交 modelRouteId
  → 写 generation_task，冻结额度
  → worker 用服务端密钥调上游
  → 结果写入对象存储，再写回画布节点
```

| 现有位置 | 改动 |
| --- | --- |
| `apps/web/src/stores/workspace.ts` | `directory` 改为 `id`。项目列表改从接口读，不再用 `toonflow.projectList` 持久化本机路径 |
| `apps/web/src/lib/workspaceFiles.ts` | 方法名保留：`list`、`read`、`write`、`readJson`、`writeJson`。内部把目录参数换成当前 `projectId`，并带上登录 Cookie |
| `apps/web/src/pages/home/index.vue` | 去掉「选择工作目录」作为主路径。未登录进登录页，已登录显示服务器上的项目 |
| `apps/web/src/pages/workspace/panels/canvas/*` | 不改 Vue Flow 交互。保存仍写 `{ toonflowCanvas, nodes, edges, viewport }`，另外带 `revision` |
| `apps/web/src/stores/settings.ts` | 用户侧删除 `customProviders` 的密钥编辑。模型列表改读 `/api/models` |
| `apps/server/src/app.ts` | 在 `languageRequest` 之后、业务路由之前挂会话中间件 |
| `apps/server/src/routes/workspaces/**` | 停止接受客户端传入的绝对路径。由项目路由替代；旧路由在公司部署中关闭 |
| `apps/server/src/utils/ai/index.ts` | `listAiModels()` 改为读已启用的 `model_route`，不读用户设置里的密钥 |
| `apps/server/src/routes/ai/generate.ts` | 改为创建任务，不在请求里使用用户提供的密钥 |
| `apps/server/src/router.ts` | 只通过 `bun run routes` 生成，不手改 |

新增目录仍遵守一接口一文件：

```text
apps/server/src/routes/auth/login.ts
apps/server/src/routes/auth/logout.ts
apps/server/src/routes/auth/me.ts
apps/server/src/routes/projects/list.ts
apps/server/src/routes/projects/create.ts
apps/server/src/routes/projects/files/*
apps/server/src/routes/models/list.ts
apps/server/src/routes/tasks/create.ts
apps/server/src/routes/admin/*
apps/server/src/utils/db/
apps/server/src/utils/session/
apps/server/src/utils/storage/
apps/server/src/worker.ts
```

桌面端、手机端、MCP、官方渠道账号本期不改行为，公司部署的启动配置里关掉对公网的入口。

---

## 3. 分阶段任务

### 第 0 周：冻结和本地依赖

只做环境，不改画布。

- 定本期上游清单：至少一条语言模型、一条图片、一条视频。没定的上游不进第一期适配。
- 定额度单位：语言模型按 token，图片按张，视频按秒。价格系数先用手工配置。
- 开发机用 Docker 只跑 PostgreSQL 和 Redis。应用仍是 `bun run dev`。
- 增加 SQL 迁移目录和 `bun run migrate`。启动服务不自动改表。
- 环境变量：`DATABASE_URL`、`REDIS_URL`、`S3_ENDPOINT`、`S3_BUCKET`、密钥引用。不写进仓库。

完成标准：空库能完成迁移；现有本地画布功能不受影响。

### 第 1～3 周：登录、组织和项目壳

后端：

- 表：`user`、`session`、`organization`、`membership`、`project`、`project_member`。字段以重构方案第 7 节为准。
- 接口：登录、退出、当前用户、创建用户（仅管理员）、项目列表、创建项目、项目成员。
- 会话中间件读取 Cookie，把 `req` 上的用户放进后续处理。登录、健康检查以外的 `/api` 没有会话就返回 401。
- 种子账号由命令创建，不在界面公开注册。
- 项目 ID 用不可枚举的随机 ID，不用自增整数。

前端：

- Element Plus 登录页。
- 路由守卫：无会话去登录页。
- 首页项目卡片改读接口。创建项目不再调用本机选目录。
- Pinia 的当前项目只留 `id`、`name`。删掉浏览器里旧的 `toonflow.projectList` 持久化键，避免把本机路径再带回来。

此阶段画布可以先打不开。不要并行改 `canvasHost.vue`。

完成标准：两个账号互相看不到对方项目；停用用户后下一次请求即 401。

### 第 4～5 周：项目文件仍落在服务器磁盘

这一阶段是过渡，用来保住现有画布代码。

- 新接口 `/api/projects/:projectId/files/*` 复用现在 `routes/workspaces/files` 里的校验和 `@toonflow/file` 写法。
- 根目录由服务端算：`data/projects/{organizationId}/{projectId}`。请求里不再出现 `directory`。
- 打开项目时校验成员角色。查看角色的写接口直接 403。
- `useWorkspaceFiles` 改为读取 Pinia 里的 `projectId`。`canvasHost.vue`、`canvasFiles.ts` 的调用方式保持 `readJson` / `writeJson`。

完成标准：登录后新建项目，摆放现有节点，刷新后画布还在。文件只出现在该项目目录下，不能通过改参数读到别的目录。

### 第 6～8 周：画布进库，素材进对象存储

后端把文件接口的实现换掉，前端方法签名不再改。

- `writeJson` 写到 `.json` 且内容含 `toonflowCanvas` 时，改为更新 `canvas.document`，并 `revision = revision + 1`。条件是 `where id = ? and revision = 客户端版本`。更新行数为 0 则返回 409。
- 每次成功保存追加 `canvas_revision`，保留策略按重构方案：最近 50 版，更早的每天留一版，90 天。
- 图片、视频、音频上传改为对象存储。`asset` 表记对象键、类型、大小、哈希。节点里原来的相对路径改为 `asset.id`。
- 读取素材签发 10 分钟签名地址。签发前再查项目角色。
- 编辑锁放 Redis，键为画布 ID，值是用户 ID，60 秒过期，前端 20 秒续期。保存时锁和版本号一起检查。
- 旧的项目磁盘目录保留到导入工具完成后再删。删除动作不在这个阶段做。

前端只处理两件事：保存请求带上当前 `revision`，收到 409 时提示刷新。不改节点外观和连线。

完成标准：两个编辑者先后保存，后保存的人看到冲突而不是覆盖。素材预览不走应用机磁盘。

### 第 9～12 周：模型中转、额度和 worker

- 表：`model_route`、`quota_account`、`quota_ledger`、`generation_task`。
- 管理页（Element Plus，挂在现有设置或单独的管理路由）：启用路由、填写密钥引用名、设置组织和个人额度。密钥值只来自环境变量或服务器密钥文件。
- `GET /api/models` 返回当前用户可用的模型名称、类型、能力。响应里没有地址和密钥。
- 生成按钮不再读 `customProviders`。请求体改为 `modelRouteId` 加节点上的提示词和引用素材。
- `routes/ai/generate.ts` 和媒体生成入口改为：鉴权、检查并发上限、冻结额度、插入任务、把任务 ID 推进 Redis。接口立刻返回任务 ID。
- 新增 `apps/server/src/worker.ts`，同一套 Bun 代码，单独进程启动。它取任务、按 `secret_ref` 取密钥、调用现有提供方、把结果写入对象存储、回写节点、结算或解冻额度。
- 状态只允许：排队、运行、成功、失败、已取消。前端用现有轮询或短间隔查询任务，第一期不上 WebSocket。
- 并发默认：文本 2、图片 2、视频 1。视频超时 20 分钟，不自动重试。
- 用户设置里的自定义供应商入口从界面和保存接口去掉。服务端忽略客户端传来的 `apiKey`。

完成标准：普通用户不配置密钥，能完成一次文本或图片生成；失败且上游未计费时额度恢复；任务记录能查到人和模型。

### 第 13～16 周：审计、导入、部署

- `audit_log` 记录登录失败、角色变更、路由变更、额度调整、项目归档。只追加。
- 导入工具：读取一份本地项目文件夹，识别 `toonflowCanvas` JSON 和被引用的图片视频，写入一个新的服务器项目。缺文件写进导入报告，不把半成品标成成功。对话记录、本机插件、个人设置不导入。
- 公司启动配置关闭：MCP 公网、本机选目录、设备配对、任意插件安装、官方渠道登录。
- 按重构方案第 9.2 节部署：Nginx、应用进程、worker 进程、托管 PostgreSQL、Redis、对象存储。
- 备份恢复演练一次：恢复后抽查一个项目的画布和一段视频。
- 发布用现有 `bun run build:server`。回滚保留上一版构建目录。数据库只做向前兼容的加表、加列。

完成标准：按检查清单逐项通过后，才让全员从本机目录切到网页。

---

## 4. 中间件顺序

`createApp` 里保持这条顺序：

```text
开发日志 morgan
→ cors
→ languageRequest
→ 会话（读 Cookie，查 Redis）
→ json / raw / urlencoded（维持现有大小限制）
→ 登录校验（白名单：登录）
→ 业务路由（路由内再做 Zod、项目角色、额度、版本号）
→ 统一错误处理
```

项目角色不放进全局中间件。全局层只回答「是谁」。路由层回答「能不能动这个项目」，因为多数接口都带项目 ID，放在路由里更直接。

`validateFields` 继续只校验、不把解析结果写回 `req.body`。需要的字段在路由里用校验通过后的原始值，或在路由内自己解析一次。不改这个现有行为。

---

## 5. 两条关键流程

保存画布：

```text
Vue Flow 当前图
  → writeJson(画布文件, { toonflowCanvas, nodes, edges, viewport }, revision)
  → 会话有效
  → 角色是所有者或编辑
  → 持有该画布锁
  → update canvas where revision = 传入值
  → 成功则 revision + 1，并写 canvas_revision
  → 失败则 409，前端提示刷新
```

生成：

```text
节点点击生成，只带 modelRouteId
  → 角色允许生成
  → 并发和月额度未超限
  → 冻结额度，插入 generation_task
  → 通知 worker
  → worker 调上游，结果进对象存储
  → 节点上的 asset.id 更新进画布（同样走版本号）
  → 结算或解冻
```

画布回写如果碰上版本冲突，任务结果仍保留在 `asset`，任务标为成功但附带「未能写入画布」，由用户刷新后再试写回。不能为了写回而覆盖别人的新版本，也不能把已经产生的上游费用记成未发生。

---

## 6. 人员分工

| 时间 | 后端 | 前端 |
| --- | --- | --- |
| 第 0 周 | 迁移脚本、本地 PostgreSQL 和 Redis | 不改功能，确认登录页和首页入口位置 |
| 第 1～3 周 | 用户、会话、项目、成员 | 登录页、路由守卫、项目列表 |
| 第 4～5 周 | 项目文件接口，目录由服务端计算 | `workspace.ts`、`workspaceFiles.ts` 换 projectId |
| 第 6～8 周 | 画布版本、对象存储、编辑锁 | 保存带 revision，处理 409 和签名预览 |
| 第 9～12 周 | 路由、额度、任务、worker | 模型选择改为接口数据，生成改看任务状态 |
| 第 13～16 周 | 审计、导入、部署、备份演练 | 管理页、导入结果展示、去掉密钥设置 |

第 4～5 周和第 6～8 周都动保存链路，不要两个人同时改 `useWorkspaceFiles`。第 6 周之前前端只认「文件接口」，不关心后面是磁盘还是数据库。

---

## 7. 开发时的约束

- 新路由文件放进 `apps/server/src/routes` 后执行 `bun run routes`，再做类型检查。
- 公司部署的验证用临时库和临时桶，不连线上对象存储做删除试验。
- 不新增测试框架和测试文件。每个阶段用上述完成标准手工走一遍主路径：登录、越权、保存冲突、生成失败。
- 不改节点包里的交互。节点如果把路径写死，只在保存和打开画布的边界做 `asset.id` 转换。
- 官方仓库的画布格式保持 `toonflowCanvas`。存储层变化集中在 `workspaceFiles` 和项目文件路由，减少以后合并上游时的冲突面。

---

## 8. 做的过程中遇到这些情况就停

| 情况 | 处理 |
| --- | --- |
| 想在第 4 周顺便做实时协同 | 停。锁和版本号够用，协同会推翻保存方案 |
| 想让用户继续填自己的 Key 作为过渡 | 停。两套密钥来源会把额度绕开 |
| 画布 JSON 超过 2 MB 或节点超过 500 | 拒绝保存并提示拆画布，不先做分页文档 |
| worker 还没好就让视频生成走接口进程 | 图片和文本可以暂时同步返回，视频必须等 worker。同步视频会拖死 Express |
| 第二台应用机要先上 | 先把编辑锁和会话放进 Redis，并确认项目文件不再用进程内锁。否则不要加第二台 |
