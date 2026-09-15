# 跨机器接续：2026-09-16

## 2026-09-16 文档讨论与路径 API 检查

当前以 [PR-DRAFT.zh-CN.md](PR-DRAFT.zh-CN.md) 为中文 PR 正文，写作待办移至 [PR-EDITORIAL-NOTES.zh-CN.md](PR-EDITORIAL-NOTES.zh-CN.md)。摘要已精简；耗时用整数毫秒，百分比保留一位小数；线上产品统一称为“我们一个拥有上千万用户的 C 端产品”。用户已决定本轮不单独量化热启动额外开销，不将该定位作为提交前置条件。

现有 Windows x64 基线与拆分产物的主进程实测确认：`app.getPath('module')` 从 `electron.exe` 变为 `main.dll`；`app.getPath('exe')` 和 `process.execPath` 仍指向启动 EXE，资源目录关系以及所测应用的 `app.getAppPath()`、`__dirname`、`__filename` 不变。两次启动均正常退出、stderr 为空。这是 Chromium 模块从 EXE 移入 DLL 后的可见行为变化，已补入正文兼容性段落，不能宣称所有 JS API 行为不变。原机器探针及结果在 `C:/electron/runtime-split-validation/path-api-review-20260916`，该本地目录未随仓库发布。

下一步先讨论这一 API 行为的兼容性处理，并补齐对应回归测试、API 文档和 Release Notes，再继续英文文案与提交准备。当前产品实现未因这一发现修改；未重新构建或采集性能样本。正式 Electron PR 尚未提交，两个产品 commit 的签名仍按用户要求暂缓。

## 当前目标与状态

目标：取得并解释运行时拆分＋预读的启动收益，准备 Electron PR。计划一个 PR、两个产品 commit（拆分与兼容改造；预读）；与改动无关的产品失败不修复。正式 PR 尚未创建。

最终实体机矩阵已经完成并复核，不要因为切换机器重跑现有批次。每个存储、冷热、版本各 20 次正式启动，共 160 次，另 20 次热身。冷启动视频 P50 收益 SSD 32.06%、HDD 77.01%；热启动视频 P50 退化 SSD 8.06%、HDD 7.30%。两种存储热启动的 APP READY 都增加约 19–20 ms，均 20/20 对更慢。具体原因尚未证明。

本仓库负责证据、benchmark 源码、PR 写作；Electron 源码留在原 fork。原机器测量已结束，计划任务处于 COMPLETE，不需再次启动。不要运行 archive 中控制器去恢复终态。

## 2026-09-15 提交整理更新

两个产品 commit 已整理并推送到 `pr/windows-runtime-split`，排除了三项独立测试工具文件修复。原 10 个产品源码／测试／构建文件内容不变，新增迁移文档。签名按用户要求暂不做。已有兼容测试日志、实际 Release 导入／导出与体积对比已经补齐，见 [COMPATIBILITY.zh-CN.md](COMPATIBILITY.zh-CN.md)。预读是热启动开销主要怀疑原因，本轮未新增诊断采样；后续是否逐段计时再按需要决定。

## 接续顺序

1. 克隆本仓库，运行 README 的复算及测试命令。阅读最终数据、方法和中文 PR 草稿。
2. 讨论 `app.getPath('module')` 的兼容性处理，补齐相关回归测试、API 文档与 Release Notes。
3. 保留热启动额外耗时及归因边界的披露，本轮不要求新增分段计时。若后续改变产品代码，按影响决定新的验证与采样，不复用旧结果宣称新代码收益。
4. 填写可公开的千万用户 C 端产品线上统计；QQ 的具体实现仍缺公开出处。检查分发、导出／导入库、改名 EXE、兼容性与体积代价说明。
5. 两个产品 commit 已整理；后续完成签名、剩余验证状态与英文 PR 文案，再向 Electron 提交 PR。官方 CI 与本地失败需如实列出。

## 产品源码定位

```sh
git clone --branch pr/windows-runtime-split https://github.com/zuohuiyang/electron.git
```

以上只获取 Electron 源码和历史，不是完整 Chromium 构建环境。需要构建时，遵循该 Electron 版本仓库中的官方 Windows 构建文档和依赖同步流程。

- 已核对远端检查点：`bd4d45660daf451364a645cf6c8053732e1a7bf2`。
- 基线被测 HEAD：`1cf98129e42ca3bff2b9ca13c78b65f10a156718`，再加 `provenance/builds/A/working-tree.patch`。
- 拆分＋预读被测 HEAD：`4806bc3ba3d849387c3f7a636f203d71e6e9b540`，再加 `provenance/builds/C/working-tree.patch`。
- 后续 `c654f4582c` 是运行时入口／快照兼容修复，`bd4d45660d` 是测试工具修复检查点。该检查点已被整理后的两个产品 commit 取代；不要把旧工具修复重新带入产品 PR。
- 导出时，两版 `args.gn`、有效参数及构建时补丁的字节哈希已与原冻结清单匹配。公开前仅将 effective-args.txt 中继承的工具链 PATH 字符串脱敏为 `<REDACTED_MACHINE_PATH>`，避免暴露日常账户目录和软件清单；特性参数不变，原哈希与导出哈希均记录在 SOURCE-FILES.json。运行时 EXE/DLL、符号和 dist.zip 不包含在这个小型证据仓库中；可按清单在原机器定位，或在另一台机器重新构建并作为新产物记录。

## 保留的约束

- 性能对照为两组：基线与拆分＋预读整体，不恢复三组正式构建；机制诊断可以另行设计。
- APP READY 和视频回调均以原生进程创建为起点。视频终点是首次收到可见视频呈现回调，允许 presentedFrames 大于 1。
- 不调整分页、自启动、自动登录或其他系统设置。换机器采样需重新准备本机配置与真实启动预检，不能复用原主机账户配置。
- 只重跑与改动相关且有必要的测试；不把共享失败标为通过。
- 不隐去热启动退化，不混合历史与当前样本，不因收益调整样本量。

## 原机器本地位置（定位产物用）

最终冷启动：`C:/ElectronBench/host-callback-20x4-20260914`；最终热启动：`C:/ElectronBench/host-warm-retry-20260915`；完整验证工作目录：`C:/electron/runtime-split-validation`；产品源码：`C:/electron/src/electron`。

这些目录不随 Git 迁移。仓库已有复算所需的全部原始输入；重新执行测试需要运行时、媒体与为新账户生成的配置目录。
