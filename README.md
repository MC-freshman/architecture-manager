# Architecture Manager

这是架构 3.4.0 的独立本地管理台，源码与发行包位于 `E:\\ai\\architecture-manager`，便携版也复制在 `E:\\ai` 根目录。每个人使用自己的工作区和自己的 GitHub 远端，不连接中心服务，也不会共享运行数据。

## 新手使用

1. 双击 `Architecture-Manager-0.1.0-portable-x64.exe`，或运行安装版 `Architecture-Manager-0.1.0-setup-x64.exe`。
2. 点击“选择工作区”，选择自己的 `E:\\ai` 架构目录。
3. 先查看平台、三仓资源、文档和软件状态；按钮会先生成计划。
4. 对文档或 `current.json` 指针，检查计划内容后点击“确认并执行”。管理台会重新读取哈希并验证结果。
5. Git 提交、推送、备份和回滚会显示目标与风险，需用户逐次确认；GitHub 登录由本机 Git Credential Manager 处理，管理台不保存密码或令牌。

## 图形界面管理入口

- **平台接入与排除**：平台面会显示平台目录绝对路径、工作区相对路径和 `bridge` 标记文件。点击“添加平台目录”选择工作区内的平台文件夹，管理台会检查目录和标记文件；“排除视图”只隐藏本机管理视图，不删除平台目录。所有改变都先出计划，再点“确认并执行”。
- **手动接入向导**：在“手动接入向导”中选择 `platform`、`tool`、`agent` 或 `software`，读取已有目标文件后生成带 SHA-256 基线的接入计划。平台可以编辑已有 bridge/config，三仓资源可以切换已发布 `current` 指针或编辑 registry；计划必须经过“确认并执行”，随后自动回读验证，外部改动会阻止覆盖。DSH 也沿用这条已有 bridge/config 路径；特殊软件能力不由管理台代为验证。
- **Agent 与 Skill**：面板默认列出两个 registry 的全部条目。点“查看全部”可阅读 agent 的 manifest/prompt 或 skill catalog 原文；添加、启用、停用、移除都只改 registry 计划，已发布版本目录不会被覆盖或删除。
- **更新计划和文档**：文档面列出 `versions/` 下全部 Markdown，可按文件名或类型筛选。实施表会显示复选框完成率和 P 项数量；打开文档后编辑仍要经过基线哈希、计划预览和确认。`架构基本原则.md` 需要额外确认。
- **软件位置和启动**：软件面显示 recipe 声明的绝对本体路径、工作区相对配方路径、入口和 MCP 端点。“打开位置”在确认后打开系统文件管理器；“启动计划”仍遵守 connector/provider 和 GUI 人工步骤，不能把尚未冻结的 MCP 或桌面软件伪装成已启动。

新手只需要选择一次 `E:\\ai` 工作区；之后所有清单由扫描结果生成。看到“缺 bridge”“本体未发现”或“待核验”时，先按面板给出的路径处理，再重新扫描。

## 两种 Windows 发行包

- `E:\\ai\\Architecture-Manager-0.1.0-portable-x64.exe`：解压或直接运行，不写系统安装项，适合先试用。
- `Architecture-Manager-0.1.0-setup-x64.exe`：普通用户安装版，可选择安装目录。

如果打开后只看到空白窗口，请使用本次修复后的 `E:\\ai` 根目录便携版。该版本的 Electron 沙箱预加载脚本已改为兼容格式，启动后应直接显示“架构管理台”和“选择工作区”。

发行包的 SHA-256 记录在 `E:\ai\codex\runtime\maintenance\20260926-manager-ui-smoke\` 的 P6 回读中。当前管理台仍只对用户明确确认的计划执行写入；软件启动、外网访问、提权和凭据引用也都保留人工确认边界。

## 开发和验证

### 源码模块边界（0.1.1）

源码按依赖方向分层：`renderer/` 只负责界面，`app/api.mjs` 是 IPC 使用的应用层门面，领域扫描与计划模块负责业务规则，`transactions.mjs` 只暴露稳定事务 API；事务公共内核位于 `transactions/kernel.mjs`，无副作用的哈希与路径校验位于 `core/`。`core/` 和事务内核不依赖 Electron 或 renderer。后续模块替换先在门面与边界测试中验证，避免改动一处扩散到所有 IPC 注册。

```text
npm install
npm test
npm run build:ui
npm start
npm run package:win
```

命令行扫描器仍然是只读的：

```text
node src/cli.mjs E:\\ai
```

所有工作区写入必须经过 3.4.0 的 `plan → apply → verify` 事务边界。审计事件只保留路径、哈希、操作者和状态，不保存文档正文、凭据或软件本体。
