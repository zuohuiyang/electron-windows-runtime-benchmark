# Electron Windows EXE 拆分与 DLL 预读基准测试

本仓库保存 Electron Windows EXE 拆分与 DLL 预读方案的测量代码、原始数据和复现说明。

**测试结果：**在本台 Windows 实体机上，冷启动视频呈现回调耗时的 P50 在 SSD 和 HDD 上分别减少 **32.06%** 和 **77.01%**；热启动则分别增加 **8.06%** 和 **7.30%**。数据同时保留了冷启动收益和热启动退化。这些结果来自一台机器上的本地视频测试，不能保证其他应用或设备也有相同表现。

## 目录结构

```text
tests/       测试代码：计时程序、本地测试页面、复算脚本和校验测试
benchmark/   本机环境和数据：原始样本、构建信息、哈希清单和统计结果
doc/         文档：测试方法与复现说明
README.md    仓库说明与运行入口
```

## 从另一台机器继续

```sh
git clone https://github.com/zuohuiyang/electron-windows-runtime-benchmark.git
cd electron-windows-runtime-benchmark
node tests/scripts/analyze.cjs
node --test tests/scripts/analyze.test.cjs
```

需要 Node.js 18 或更新版本，无 npm 依赖。上述命令在任何平台复算归档数据，不启动 Electron，不安装任务，不重启。`tests/package.json` 的 `private` 仅防止误发 npm，GitHub 仓库公开。

测试方法与复现步骤见 [方法说明](doc/METHODOLOGY.zh-CN.md)。

## 材料入口

| 内容 | 入口 |
|---|---|
| 最终 P50 / P90 表 | [RESULTS.zh-CN.md](benchmark/reports/RESULTS.zh-CN.md) |
| 方法、样本量、限制、重新测量 | [METHODOLOGY.zh-CN.md](doc/METHODOLOGY.zh-CN.md) |
| 计时程序与本地 HTML / SVG 图标 / 视频回调 | [tests/harness](tests/harness) |
| 80 次冷启动、80 次热启动、20 次热身原始记录 | [benchmark/data](benchmark/data) |
| 构建参数、源码补丁、运行时文件哈希 | [benchmark/provenance/builds](benchmark/provenance/builds) |
| 本机硬件与系统 | [host-environment.json](benchmark/provenance/host-environment.json) |
| 导出文件逐字节哈希 | [SOURCE-FILES.json](benchmark/provenance/SOURCE-FILES.json) |

样本中的 `A` = 基线，`C` = 拆分＋预读；原始记录的盘符 `C` = NVMe SSD，`E` = SATA HDD。原始路径仅作出处标识，复算不会访问它们。

冷启动的 80 次记录来自不同的系统重启；新的热启动 100 次（含热身）来自同一会话。所有正式条件每版本 n=20；两项终点来自同一次启动。仓库仅保留最终批次；此前使用不同方法或中断的批次不参与统计。

运行时、浏览器配置目录、登录凭据和自动登录工具不随仓库分发。视频按固定 Chromium 版本自行准备，见 [MEDIA.md](tests/harness/MEDIA.md)；媒体本身不在此仓库。仓库提供单次测量入口，不包含批量采样控制器或跨机器自动安装器。

被测源码须按构建清单的 **HEAD + 工作区补丁** 还原。

## 材料与许可说明

Electron / Chromium 的构建补丁、引用源码和媒体素材沿用各自的上游许可。新编写的基准测试代码尚未选定独立许可证，公开访问不等于授予使用许可。

原始测量记录保留原始字节，其中的本机路径和账户名称仅用于追溯来源。两份 `effective-args.txt` 的工具链 PATH 已脱敏；哈希清单记录原始与公开文件的哈希，以及媒体说明的翻译记录。哈希用于校验归档内容，不能独立证明测量时的物理条件。

复算会生成 `benchmark/reports/summary.json`，该文件不纳入版本控制；可直接阅读的统计表保留在 `benchmark/reports/RESULTS.zh-CN.md`。
