# Architecture Manager

这是架构 3.4.0 的独立本地管理台，源码与发行包位于 `E:\\ai\\architecture-manager`，便携版也复制在 `E:\\ai` 根目录。每个人使用自己的工作区和自己的 GitHub 远端，不连接中心服务，也不会共享运行数据。

## 新手使用

1. 双击 `Architecture-Manager-0.1.0-portable-x64.exe`，或运行安装版 `Architecture-Manager-0.1.0-setup-x64.exe`。
2. 点击“选择工作区”，选择自己的 `E:\\ai` 架构目录。
3. 先查看平台、三仓资源、文档和软件状态；按钮会先生成计划。
4. 对文档或 `current.json` 指针，检查计划内容后点击“确认并执行”。管理台会重新读取哈希并验证结果。
5. Git 提交、推送、备份和回滚会显示目标与风险，需用户逐次确认；GitHub 登录由本机 Git Credential Manager 处理，管理台不保存密码或令牌。

## 两种 Windows 发行包

- `E:\\ai\\Architecture-Manager-0.1.0-portable-x64.exe`：解压或直接运行，不写系统安装项，适合先试用。
- `Architecture-Manager-0.1.0-setup-x64.exe`：普通用户安装版，可选择安装目录。

如果打开后只看到空白窗口，请使用本次修复后的 `E:\\ai` 根目录便携版。该版本的 Electron 沙箱预加载脚本已改为兼容格式，启动后应直接显示“架构管理台”和“选择工作区”。

发行包的 SHA-256 记录在 P8 证据目录中。当前管理台仍只对用户明确确认的计划执行写入；软件启动、外网访问、提权和凭据引用也都保留人工确认边界。

## 开发和验证

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

所有工作区写入必须经过 3.4.0 P7 的 `plan → apply → verify` 事务边界。审计事件只保留路径、哈希、操作者和状态，不保存文档正文、凭据或软件本体。
