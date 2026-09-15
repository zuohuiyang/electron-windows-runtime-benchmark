# Electron Windows runtime benchmark

Evidence and measurement source for the proposed Windows runtime split + preread change. **No Electron PR has been opened yet.** The draft is currently written in Chinese.

**Results:** on this physical Windows host, cold-start visible-video callback P50 decreased by **32.06% on SSD** and **77.01% on HDD**. Warm-start P50 increased by **8.06% / 7.30%** respectively. Both the benefit and regression are retained. This is one machine and one local-video workload, not a general performance guarantee.

## 从另一台机器继续

```sh
git clone https://github.com/zuohuiyang/electron-windows-runtime-benchmark.git
cd electron-windows-runtime-benchmark
node scripts/analyze.cjs
node --test scripts/analyze.test.cjs
```

需要 Node.js 18 或更新版本，无 npm 依赖。上述命令在任何平台复算归档数据，不启动 Electron，不安装任务，不重启。`package.json` 的 `private` 仅防止误发 npm，GitHub 仓库公开。

先读 [接续说明](docs/HANDOFF.zh-CN.md)，再编辑 [PR 中文草稿](docs/PR-DRAFT.zh-CN.md)。本仓库中的草稿是后续协作的主版本。

## 材料入口

| 内容 | 入口 |
|---|---|
| 最终 P50 / P90 表 | [RESULTS.zh-CN.md](reports/RESULTS.zh-CN.md) |
| 方法、样本量、限制、重新测量 | [METHODOLOGY.zh-CN.md](docs/METHODOLOGY.zh-CN.md) |
| 计时程序与本地 HTML / SVG 图标 / 视频回调 | [harness](harness) |
| 80 次冷启动、80 次热启动、20 次热身原始记录 | [data](data) |
| 构建参数、源码补丁、运行时文件哈希 | [provenance/builds](provenance/builds) |
| 兼容性、迁移、体积和真实导入／导出 | [COMPATIBILITY.zh-CN.md](docs/COMPATIBILITY.zh-CN.md) |
| 本机硬件与系统 | [host-environment.json](provenance/host-environment.json) |
| 原始执行控制器（只供审查） | [archive/controllers](archive/controllers) |
| 历史热启动退化与中断批次 | [history](data/history) |
| 导出文件逐字节哈希 | [SOURCE-FILES.json](provenance/SOURCE-FILES.json) |

样本中的 `A` = 基线，`C` = 拆分＋预读；原始记录的盘符 `C` = NVMe SSD，`E` = SATA HDD。原始路径仅作出处标识，复算不会访问它们。

冷启动的 80 次记录来自不同的系统重启；新的热启动 100 次（含热身）来自同一会话。所有正式条件每版本 n=20；两项终点来自同一次启动。历史批次从最终统计中排除，保留原因与数据。

运行时、浏览器配置目录、登录凭据和自动登录工具不随仓库分发。视频按固定 Chromium 版本自行准备，见 [MEDIA.md](harness/MEDIA.md)；媒体本身不在此仓库。归档控制器带本机路径，扩展名 `.txt`，不是跨机器的一键安装器。

整理后的两个产品 commit 在 [pr/windows-runtime-split](https://github.com/zuohuiyang/electron/tree/pr/windows-runtime-split)，签名暂缓；旧分支保留。被测源码必须按构建清单的 **HEAD + 工作区补丁** 还原，不能用该分支的最新 HEAD 代替。
