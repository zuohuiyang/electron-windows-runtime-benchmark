# 跨机器接续：2026-09-15

## 当前目标与状态

目标：取得并解释运行时拆分＋预读的启动收益，准备 Electron PR。计划一个 PR、两个产品 commit（拆分与兼容改造；预读）；与改动无关的产品失败不修复。正式 PR 尚未创建。

最终实体机矩阵已经完成并复核，不要因为切换机器重跑现有批次。每个存储、冷热、版本各 20 次正式启动，共 160 次，另 20 次热身。冷启动视频 P50 收益 SSD 32.06%、HDD 77.01%；热启动视频 P50 退化 SSD 8.06%、HDD 7.30%。两种存储热启动的 APP READY 都增加约 19–20 ms，均 20/20 对更慢。具体原因尚未证明。

本仓库负责证据、benchmark 源码、PR 写作；Electron 源码留在原 fork。原机器测量已结束，计划任务处于 COMPLETE，不需再次启动。不要运行 archive 中控制器去恢复终态。

## 接续顺序

1. 克隆本仓库，运行 README 的复算及测试命令。阅读最终数据、方法和中文 PR 草稿。
2. 下一项技术工作是定位 **APP READY 前约 20 ms 的热启动额外开销**。可以在独立诊断分支对加载器入口、预读、LoadLibraryExW、ElectronMain 和 ready 分段计时；诊断产物、样本与当前正式 benchmark 分开。现有证据不足以区分拆分与预读各自的贡献。
3. 据定位结果讨论是否改变同步预读的范围、条件或执行方式。不要先改终点或通过选择样本消除退化。产品代码变化后，按影响决定新的验证与采样，不复用旧结果宣称新代码收益。
4. 填写可公开的抖音 PC 线上统计；QQ 的具体实现仍缺公开出处。完成分发、导出／导入库、改名 EXE、兼容性与体积代价说明。
5. 整理最终两个 commit，绑定精确源码与验证记录，翻译 PR 文案，再向 Electron 提交 PR。官方 CI 与本地失败需如实列出。

## 产品源码定位

```sh
git clone --branch feat/windows-runtime-split https://github.com/zuohuiyang/electron.git
```

以上只获取 Electron 源码和历史，不是完整 Chromium 构建环境。需要构建时，遵循该 Electron 版本仓库中的官方 Windows 构建文档和依赖同步流程。

- 已核对远端检查点：`bd4d45660daf451364a645cf6c8053732e1a7bf2`。
- 基线被测 HEAD：`1cf98129e42ca3bff2b9ca13c78b65f10a156718`，再加 `provenance/builds/A/working-tree.patch`。
- 拆分＋预读被测 HEAD：`4806bc3ba3d849387c3f7a636f203d71e6e9b540`，再加 `provenance/builds/C/working-tree.patch`。
- 后续 `c654f4582c` 是运行时入口／快照兼容修复，`bd4d45660d` 是测试工具修复检查点。最终两 commit 尚未整理，不可把整个检查点直接作为两个产品 commit 提交。
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
