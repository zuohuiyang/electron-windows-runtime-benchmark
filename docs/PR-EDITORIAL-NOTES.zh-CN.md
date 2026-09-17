# PR 写作与提交备忘

此文件保存正文之外的编辑事项，不作为 PR 正文。2026-09-18 文档讨论结果已整理，按用户要求推送以便跨机器接续。

## 提交准备

- 保留一个 PR、两个产品 commit，分支 pr/windows-runtime-split。签名按用户安排后做。
- 正文继续用中文讨论；提交前准备英文版本、固定证据链接及最终发布标记。
- 保持已知测试失败、热启动增加、测量范围与归因限制的如实披露。
- QQ 实践来自提交者信息，仍需可引用的公开材料；不扩大现有归因。
- 正式导入库、更多生态工具／架构的验证，以及符号包、内存、实际读取量未全面覆盖。
- 当前正式样本量已完整，无需为文案编辑新增采样。
- 已实测确认 Windows `app.getPath('module')` 从 EXE 路径变为 `main.dll` 路径，正文第 3 节已披露。产品实现尚未调整，回归测试、API 文档和 Release Notes 的对应说明待补。

## 线上材料

| 需要填写的字段 | 当前状态 |
| --- | --- |
| 可公开的产品／场景说明、Electron 版本与改动版本 | 已说明千万用户 C 端产品、线上运行两年多及多个产品采用；具体版本待补 |
| 统计周期、用户／启动次数、对照及实验分组方法 | 待补 |
| 起点与终点的具体采集位置、首帧定义 | 待补 |
| 冷／热启动判定、SSD／HDD 识别方式及分组覆盖 | 待补；不能将未区分磁盘的总体数值复制进各子组 |
| 各组 P50、P90、绝对变化与相对变化 | 用户截图数据已录入第 6.8 节；预读 P50 −184 ms，文件拆分＋进程合并 P50 −369 ms、P90 −2378 ms，分别统计 |
| 网络、视频内容、版本及其他同期改动的影响 | 已明确第二组包含本 PR 之外的进程合并，不将全部收益归因于拆分；其他因素未提供 |
| 可公开的汇总证据或链接 | 正文已有截图数据转录，原截图未随仓库发布 |

## 本地写作参考（提交前移出正文）

- [Electron PR 模板](https://github.com/electron/electron/blob/main/.github/PULL_REQUEST_TEMPLATE.md)：保留 Description、Checklist 和 Release Notes。
- [#51703：Node 启动快照](https://github.com/electron/electron/pull/51703)：摘要先给收益与代价，详细方法与实现分层展示。
- [#51697：构建时 V8 code cache](https://github.com/electron/electron/pull/51697)：技术方案取舍、适用范围与体积代价。
- [#53070：Linux 启动优化](https://github.com/electron/electron/pull/53070)：一个 PR 两个 commit，分别呈现 ready 与内容呈现终点。
- [#51602：渲染进程启动数据与 preload 缓存](https://github.com/electron/electron/pull/51602)：同时说明收益、首次生成成本和行为变化。

本文是中文填充稿。发布前将较长细节放入 GitHub `<details>`，并使用本证据仓库的固定 commit 链接。下一步见 [HANDOFF.zh-CN.md](HANDOFF.zh-CN.md)。
