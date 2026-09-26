# Electron Windows 启动 benchmark

[English](README.md) | 简体中文

本仓库提供 benchmark 代码，并保存本机测试的原始数据和统计结果。

本仓库的代码与文档由 GPT-6 Astra 辅助开发和整理。

## 运行 benchmark

准备 Windows x64、Node.js 18+ 和 C++ 构建工具，配置测试账户自动登录。保存工作并关闭其他应用后，在仓库目录使用**非管理员 PowerShell**执行，将路径替换为自己的产物与磁盘目录：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\code\run.ps1 `
  -ElectronPath "D:\build\changed" `
  -BaselinePath "D:\build\baseline" `
  -DiskSSD "C:\ElectronBench" `
  -DiskHDD "E:\ElectronBench"
```

默认先冷启动、后热启动，每种条件采样 20 次，共 **160 次正式启动、20 次热身、80 次重启**，自动登录后续跑。每次同时记录 APP READY 和视频呈现回调，输出 P50/P90 及版本对比。只测一个产物时，省略 `-BaselinePath`。

脚本先将两个版本完整复制到指定 SSD/HDD 上的新目录，后续只运行部署副本。新实验从父进程调用 `spawn()` 前的高精度时间起算，包含创建进程的同步开销；报告明确标记计时起点。仓库已归档的数据仍按原来的进程创建时间起算，不与新口径混合。

新结果保存在 `%LOCALAPPDATA%\ElectronBench\runs\<本次实验目录>`：`results/` 是原始记录，`RESULTS.md` 和 `summary.json` 是汇总。完成后自动打开报告；新结果不会自动覆盖仓库中的已有数据。在本次输出目录创建 `STOP` 空文件可停止采样。

参数、辅助程序准备及详细操作见[运行说明](doc/RUNNING.zh-CN.md)。

## 已有测试数据

- 最新异步预读批次：[中文报告](data/reports/async-20260925.zh-CN.md)、[英文报告](data/reports/async-20260925.en-US.md)、[原始数据与采样脚本](data/data/async-20260925)、[构建记录](data/provenance/async-20260925)。
- [data/data/final-20260922/](data/data/final-20260922)：本机冷热启动原始记录。
- [data/reports/RESULTS.zh-CN.md](data/reports/RESULTS.zh-CN.md)：P50/P90 汇总及对比。
- [data/provenance/](data/provenance)：机器环境、被测构建和文件哈希。
- [测试方法](doc/METHODOLOGY.zh-CN.md)：采样、计时与统计口径。

核验并复算最新异步批次：`node code/scripts/analyze-run.cjs`。复算此前同步预读批次：`node code/scripts/analyze.cjs`。
