# 兼容性证据、体积与迁移

## 两个产品提交

产品分支：[pr/windows-runtime-split](https://github.com/zuohuiyang/electron/tree/pr/windows-runtime-split)。

1. `f3e07d7ed81d40246897e0f7b8b6267733324872`：拆分运行时、导出／Fuse／沙箱／快照兼容、五项运行时回归与迁移文档。
2. `4ce68cfbef`：浏览器进程同步预读及其成本说明。

基线保持 `1cf98129e42ca3bff2b9ca13c78b65f10a156718`，此次没有同步新的 Chromium/Electron 依赖或重新构建。旧分支保留。

独立工具修复 `script/lib/util.py`、`script/lib/utils.js`、`script/node-spec-runner.js` 已从产品分支排除，恢复为基线内容。相对旧验证检查点，10 个产品源码、构建及测试文件的 Git blob 完全相同；新增内容仅为迁移文档。详见 [提交审计](../provenance/product-commit-audit.json)。签名按用户安排留到后续，当前两个 commit 均未签名，也未创建 Electron PR。

## 已有实际测试证据

| 范围 | 结果与原始材料 | 边界 |
|---|---|---|
| Windows runtime | [5/5 用例通过](../provenance/validation/runtime-five-cases.log)：改名 EXE 加载原生模块、EXE Fuse 生效、缺少／损坏 DLL、缺少入口 | 本机 Testing 产物，不能替代所有原生模块和架构覆盖 |
| xcache | [3/3 用例通过](../provenance/validation/xcache-split-fix.log)：Node snapshot、script cache、function cache | 本机 Testing 产物 |
| 分发测试 | [7 项记录](../provenance/validation/distribution-smoke.json)，对应[断言源码](../provenance/validation/distribution-smoke.cjs.txt) | 来自已有 Testing 分发；故意的错误场景应返回非零码，不是 7 项都退出 0 |
| Lint | [完整日志](../provenance/validation/lint.log)与[源码哈希清单](../provenance/validation/lint-manifest.json)，退出 0 | 历史工作区还包含现已排除的工具修复；新增迁移文档另用原仓库 markdownlint 检查通过 |

完整套件、Node 诊断和 NAN 的未通过状态仍见 [VALIDATION.zh-CN.md](VALIDATION.zh-CN.md)，此次没有重新运行，也没有把它们改为通过。完整大日志未全部公开。

## 真实 Release 产物的导入／导出

对 benchmark 实际使用的 Release EXE/DLL 重新核验冻结 SHA-256，再用 Microsoft dumpbin 输出导入与导出目录。

- 基线 EXE 3240 个命名导出，拆分 EXE/main.dll 各 3241 个；基线名称均保留，新增 ElectronMain。
- EXE 中 3207 个命名导出转发到同名 `main.dll` 符号。另有 34 个直接导出：32 个 `Cr_z_*`，以及 `GetHandleVerifier` 和 `IsSandboxedProcess`。直接导出来自 EXE 的链接结果，不能把源码生成的转发列表等同于最终 PE 的所有符号都转发。
- 启动器的导入目录没有直接导入 `main.dll`；DLL 通过显式 LoadLibraryExW 加载。
- 命名导出保留不代表 ordinal 稳定、数据对象身份或跨模块分配／释放语义已全面验证。正式导入库分发、更多原生模块和 ARM64 的集成覆盖仍待最终 PR/CI 确认。当前直接导出列表应在评审中说明，不能宣称全部 ABI 场景已证明。

原始输出及可复算结论见 [SIZE-AND-EXPORTS.zh-CN.md](../reports/SIZE-AND-EXPORTS.zh-CN.md) 和 [provenance/pe](../provenance/pe)。

## 体积代价

| 项目 | 基线 | 拆分＋预读 | 变化 |
|---|---:|---:|---:|
| 完整分发解压后 | 358.476 MiB | 361.302 MiB | +2.826 MiB（+0.79%） |
| 完整分发 ZIP | 150.473 MiB | 151.718 MiB | +1.245 MiB（+0.83%） |
| EXE＋主运行时 DLL | 237.327 MiB | 240.153 MiB | +2.826 MiB（+1.19%） |

文件数 74 → 75。新增 DLL 不只是把文件改名；总分发有小幅增加。符号包体积、内存和实际启动读取量尚未测量。

## 分发迁移

产品分支已加入[英文迁移文档](https://github.com/zuohuiyang/electron/blob/pr/windows-runtime-split/docs/tutorial/windows-runtime-distribution.md)：

- 使用完整分发；EXE 与 main.dll 必须来自匹配版本，并位于同一目录。改名 EXE 时保留 main.dll 文件名。
- 将 DLL 加入安装器、白名单、完整性清单、签名和增量更新流程，避免更新过程中混用两版 EXE/DLL。
- Fuse 仍修改 EXE，原生模块仍针对对应 Electron 版本构建；不要改为直接链接 main.dll。
- 保留其他资源与 DLL；符号、崩溃模块映射同时覆盖 EXE 和 main.dll。
- 验证最终安装／更新后的应用，覆盖改名、原生模块、Fuse 和缺失文件错误。

这是分发兼容性变化，需要自定义文件清单的应用迁移；JS API 名称不变不足以宣称“无 breaking change”。具体发布标记仍待维护者确认。

## 热启动增加是否就是预读

预读是主要怀疑原因，有明确代码依据：当前 Chromium 的 PreReadFile 将文件映射为 READ_CODE_IMAGE，调用 PrefetchVirtualMemory，再结束映射；本改动在 LoadLibraryExW 前同步调用这条路径。页面已缓存时，这些映射／预取工作也不会自动消失。

但“新增工作存在”与“实测约 20 ms 全部来自它”是两个结论。当前对照同时改变了 EXE/DLL 边界、显式加载与预读，没有对这些调用逐段计时。此轮只检查源码与已有数据，没有新增构建、A/B 实验或性能采样。

因此 PR 可解释为：冷启动收益伴随热启动固定开销，同步预读是主要怀疑来源，尚未单独量化其占比。若需要决定预读范围、异步化或条件策略，届时再用诊断计时确认；不把一轮完整重跑作为当前整理工作的前置条件。
