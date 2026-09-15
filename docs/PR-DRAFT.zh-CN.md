# Windows 运行时拆分与预读

## Description of Change

### 1. 改动摘要

将 Windows 版 Electron 的大体积 EXE 拆分为小型启动 EXE 和独立的 `main.dll`，并在加载 DLL 前进行预读，使 Windows 能够提前批量读取相关页面，减少后续加载和执行中因缺页而产生的读盘等待，从而改善启动性能。

### 2. 收益摘要

本机 benchmark 以 APP READY 和用于模拟复杂 APP 启动的本地视频呈现回调为两个终点，冷启动 P50 在 SSD 上分别减少 88 ms（−26.5%）和 357 ms（−32.1%），在 HDD 上分别减少 5019 ms（−65.7%）和 13176 ms（−77.0%）。

但是热启动耗时略微劣化：APP READY 和视频呈现回调 P50 在 SSD 上分别增加 19 ms（+33.3%）和 16 ms（+8.1%），在 HDD 上分别增加 20 ms（+33.9%）和 15 ms（+7.3%）；不过，热启动本身耗时就很短，基线 APP READY 的 P50 约为 58 ms，视频呈现回调约为 203–204 ms，耗时的绝对增量也很小。

我们一个拥有上千万用户的 C 端产品在线上采用运行时拆分与预读后也观察到启动收益，线上量化统计尚未公开。

### 3. 兼容性、代价与已知限制

- **分发兼容性**：新增与 EXE 同目录、匹配版本的 `main.dll`，自定义打包、签名和更新流程需要包含该文件。
- **路径 API 行为变化**：Windows 上 `app.getPath('module')` 由 EXE 路径变为 `main.dll` 路径；需要启动 EXE 路径的代码应使用 `app.getPath('exe')` 或 `process.execPath`。
- **体积代价**：完整分发解压后增加 2.8 MiB（+0.8%），ZIP 增加 1.2 MiB（+0.8%）。
- **验证范围**：当前性能数据来自 Windows x64，改名 EXE 加载原生模块的用例已通过；正式导入库、更广泛 ABI 场景及其他架构尚未全面验证，详细状态见第 5 节。

### 4. 技术方案与权衡

#### 4.1 技术原理

启动器与运行时分离后，启动性能可能受到两类机制影响：一是运行时页面的读取方式，二是杀毒软件在进程创建、文件访问与模块加载路径上的检查策略。前者有明确的 API 行为依据；后者取决于具体安全产品及其配置。当前 benchmark 测量两者与其他加载开销共同作用后的启动结果，尚未分离各机制的贡献。

##### 4.1.1 预读：提前批量读取运行时页面

大体积 EXE 或 DLL 被映射到进程地址空间，并不代表其所有页面已经驻留在物理内存中。启动执行访问尚未驻留的页面时，需要通过缺页处理取得数据；需要从磁盘读取时，分散且受执行顺序约束的访问可能形成多次等待。预读让程序在正式使用这些页面之前告诉系统即将访问的地址范围，使系统在条件允许时采用较大、并发的 I/O 请求，减少后续访问中的读盘等待。[PrefetchVirtualMemory 文档](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-prefetchvirtualmemory)。

本实现先运行较小的启动 EXE，在显式加载主要运行时之前调用 Chromium 的 PreReadFile。其 Windows 路径以 READ_CODE_IMAGE 建立映像映射，将映射范围交给 PrefetchVirtualMemory，再执行 LoadLibraryExW 加载 main.dll。使用映像映射符合后续代码页面的使用方式，避免仅按普通数据文件读取造成额外的数据／映像映射。这一调用顺序依赖运行时已经拆分为可显式加载的 DLL；模块边界使启动器能够在主要运行时初始化前安排读取工作。[Chromium 实现](https://chromium.googlesource.com/chromium/src/+/5d637f3b235dae9d40ce8252cb88ff156a70f044/base/files/file_util_win.cc)。

预读的价值取决于减少的后续读盘等待是否大于自身成本。HDD 对离散读取更敏感，因此批量读取可能带来更大的收益；热缓存下仍会执行映射和预取调用，也可能读取本次启动并不需要的页面。当前 API 提供的是受内存条件约束的预取提示，预取页面不会因此直接加入进程工作集。本实现同步等待该调用返回，其成本包含在进程创建到终点的测量中；本机 HDD 冷启动收益较大、热启动增加约 20 ms 的 READY 前耗时与上述机制相容；各部分开销尚未通过独立计时区分。

##### 4.1.2 杀软策略：文件与模块边界对启动检查的影响

杀毒软件的实时保护会监控文件访问及程序行为，相关检查可能增加文件读取、解析或进程启动路径上的等待。不同产品对进程主映像、加载的 DLL、扫描结果缓存和信任判断采用的策略可能不同，因此相同代码放在大 EXE 中，或分布在小 EXE 与主 DLL 中，可能表现出不同的启动成本。Microsoft Defender 的公开文档确认了实时访问保护，并提供按文件、进程、扫描次数和耗时分析性能的工具；EXE 与 DLL 的实际扫描成本取决于安全产品及其配置。[实时保护](https://learn.microsoft.com/en-us/defender-endpoint/configure-real-time-protection-microsoft-defender-antivirus)、[扫描性能分析](https://learn.microsoft.com/en-us/defender-endpoint/tune-performance-defender-antivirus)。

如果杀软在创建进程时对主 EXE 执行较重的同步检查，而对后续 DLL 加载采用不同的检查时机或能够复用已有结果，那么把主 EXE 从约 237.3 MiB 缩小为 3.0 MiB，可能减少进入启动器之前的等待。Electron 会创建多个进程，这种差异也可能影响后续子进程启动。这是依赖具体策略的机制推断；文件大小、扫描次数与扫描耗时之间的关系需由安全产品的记录确定。

主 DLL 仍可能在预读、映像映射或加载时被检查；如果相同扫描工作只是移到了 DLL 上，整体耗时未必减少。扫描缓存是否命中、文件是否变化、签名与信誉判断等还可能改变冷／热启动表现。因而，本 PR 的设计不依赖调整杀软设置；实际收益需在目标安全环境中评估。

本次计时从原生进程创建时间开始，进程创建之前的检查不在该计时范围内。原始数据没有记录 EXE/DLL 的杀软扫描事件，扫描等待与磁盘缺页等待的贡献尚未区分。量化杀软影响需要将扫描记录与进程创建、DLL 加载时间线关联分析；Microsoft Defender 提供对应的性能记录与报告接口。[性能分析接口](https://learn.microsoft.com/en-us/defender-endpoint/performance-analyzer-reference)。

#### 4.2 设计依据与已有实践

“启动器与主要运行时分离，并在加载运行时前安排文件预读”已有产品实践。Windows Chrome 的 Chromium 实现使用 `chrome.exe` 启动器加载独立的主 DLL；`MainDllLoader` 的加载路径包含 `base::PreReadFile`，同步路径在 `LoadLibraryExW` 之前执行预读。所引用的 Chromium 版本还包含按渠道和实验分组选择异步预读的逻辑，具体预读方式会随版本和配置变化。[Chromium 加载器源码](https://chromium.googlesource.com/chromium/src/+/5d637f3b235dae9d40ce8252cb88ff156a70f044/chrome/app/main_dll_loader_win.cc)、[EXE 启动入口](https://chromium.googlesource.com/chromium/src/+/5d637f3b235dae9d40ce8252cb88ff156a70f044/chrome/app/chrome_exe_main_win.cc)。

我们一个拥有上千万用户的 C 端产品采用了运行时拆分与预读，并在线上观察到启动收益。本改动将这一实践整理为 Electron 的通用实现，包含原生模块符号、Fuse、沙箱及分发等兼容处理。

据提交团队了解，**QQ PC 客户端**也采用了类似思路；这项信息来自产品实践观察，尚无可引用的公开实现资料。本文的实现说明和量化结果分别以所链接的源码与本地 benchmark 为依据。

#### 4.3 启动流程与模块边界

```text
Windows 创建进程
  → electron.exe 启动器
  → 定位同目录 main.dll，初始化 SandboxInterfaceInfo
  → 满足条件时预读 main.dll
  → LoadLibraryExW 加载 main.dll
  → GetProcAddress 查找 ElectronMain
  → 传入启动参数、沙箱接口与 EXE 的 Fuse 配置
  → Electron 运行时初始化 → APP READY → 页面与视频呈现
```

拆分提供了运行时加载之前的执行位置。启动器通过显式调用加载 `main.dll`，其导入目录中没有对该 DLL 的直接依赖，预读因此可以先于这次加载执行。实际 Release 产物的导入目录见[PE 证据](../reports/SIZE-AND-EXPORTS.zh-CN.md)。

#### 4.4 导入库、导出转发与原生模块

这里区分三个问题：启动器自身的 DLL 依赖、原生模块构建时使用的导入库，以及运行时从 EXE 查找导出符号的行为。

实际 Release 导出检查：基线 3240 个命名导出均保留，拆分版新增 ElectronMain；3207 个导出转发，34 个仍由 EXE 直接提供。直接导出包括 Cr_z_*、GetHandleVerifier、IsSandboxedProcess；本项检查覆盖命名导出，未验证 ordinal 稳定性或全部 ABI 场景。见[原始 PE 证据](../reports/SIZE-AND-EXPORTS.zh-CN.md)。

当前 `generate-runtime-exports.py` 读取运行时 PE 的命名导出，生成 EXE 的转发导出，将原符号转发到 `main.dll`，并保留既有导出定义中的名称约定。这样可以把主要实现移动到 DLL，同时保留原生模块通过 EXE 解析所需符号的路径，沿用其现有链接方式。

自动生成转发列表省去了大量符号的手工同步，代价是增加构建生成步骤与 PE 导出解析逻辑。已有测试覆盖改名 EXE 加载原生模块；函数和数据符号的完整 ABI、跨模块生命周期及正式原生模块构建链路仍有未覆盖场景。

#### 4.5 预读策略与失败路径

当前启动器调用 `base::PreReadFile(runtime_path, is_executable=true, sequential=false)`，随后正常加载 DLL。仅在 `--type` 的值为空且环境中不存在 `ELECTRON_RUN_AS_NODE` 时预读；即使相关 Fuse 禁用了 RunAsNode，环境变量存在时也保守跳过预读。

这避免每个带进程类型的子进程重复显式预读。预读失败不阻断正常加载；实际 DLL 加载或入口查找失败则记录错误并返回对应 Windows 错误。运行时通过 EXE 目录定位，并使用 `LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS`；保持运行时加载直至进程退出，覆盖原生模块析构阶段。

源码检查确认 PreReadFile 使用 READ_CODE_IMAGE 映射及 PrefetchVirtualMemory；热缓存下仍有额外工作，因此预读是约 20 ms 热启动增加的主要怀疑原因，尚未独立计时确认占比。

当前采用同步预读，加载流程简单，代价是热缓存条件下仍会增加工作。预读范围、触发条件和执行方式是后续优化的可调整点。

#### 4.6 Fuse、沙箱、快照和分发

Fuse 配置由启动器传入运行时，避免拆分后错误读取另一份配置；沙箱接口在启动器初始化后传入 `ElectronMain`。xcache 读取 Node 快照的位置随运行时移动到新模块。Windows 分发清单包含 `main.dll`，符号生成目标同时覆盖 EXE 与 DLL。

源代码入口：[启动器](https://github.com/zuohuiyang/electron/blob/4ce68cfbef/shell/app/electron_loader_win.cc)、[运行时入口](https://github.com/zuohuiyang/electron/blob/4ce68cfbef/shell/app/electron_main_win.cc)、[导出生成器](https://github.com/zuohuiyang/electron/blob/4ce68cfbef/script/generate-runtime-exports.py)。链接对应整理后的产品提交；被测构建的 HEAD、工作区补丁与产品源码映射见第 6.2 节。

#### 4.7 后续扩展：固定启动入口与版本化运行时目录

运行时拆分也为后续的版本化安装布局提供基础：应用可以将启动 EXE 保持在固定路径，把主运行时 DLL 及其配套文件放入按版本号区分的目录，再由启动器选择要加载的版本。这样，更新运行时版本就不必同时改变应用 EXE 的路径。

对于目前将 EXE 一起放入版本目录的安装方案，每次升级都可能需要更新快捷方式目标和按程序路径配置的防火墙规则。固定 EXE 路径可以减少这类由路径变化引起的维护工作：快捷方式持续指向同一启动入口，基于该可执行文件路径的规则也无需仅因版本目录变化而重写。这个预期收益针对 Windows 快捷方式的目标路径和防火墙程序规则的路径匹配，其他属性和策略仍按安装方案处理。[Windows Shell 链接](https://learn.microsoft.com/zh-cn/windows/win32/shell/links)、[Windows 防火墙规则](https://learn.microsoft.com/zh-cn/windows/security/operating-system-security/network-security/windows-firewall/rules)。

本 PR 完成的是启动器与运行时的边界拆分，当前实现仍从 EXE 同目录加载 `main.dll`，尚未实现上述目录布局。后续需要进一步处理版本选择、DLL 及资源定位、导出转发的模块解析，以及 EXE 与运行时版本匹配和更新／回滚流程。固定入口与版本目录属于后续扩展方向。

### 5. 正确性与兼容性验证

已有验证结果如下。产品分支的 10 个源码、构建和测试文件与已验证检查点内容一致，新增迁移文档通过 Markdown 检查。

| 验证项 | 结果 | 证据与范围 |
| --- | --- | --- |
| 两版构建、发布产物 | 已构建并用于测量 | HEAD、补丁及[产品文件等价审计](../provenance/product-commit-audit.json)已记录 |
| Windows runtime 回归 | 五项定向通过 | [改名 EXE、Fuse 和加载错误路径](../provenance/validation/runtime-five-cases.log) |
| xcache | 三项回归通过 | [Node snapshot、script cache、function cache](../provenance/validation/xcache-split-fix.log) |
| 分发包检查 | 七项通过 | [分发测试结果](../provenance/validation/distribution-smoke.json)；故意构造的错误场景返回预期非零码 |
| Lint | 完整运行退出 0，有文档警告；新增迁移文档检查通过 | [完整日志](../provenance/validation/lint.log)及[源码哈希](../provenance/validation/lint-manifest.json) |
| Electron 完整套件 | 一轮 4,154 项中 4,096 通过、58 失败；后续失败复验部分恢复 | 全套尚未通过，完整日志未全部公开 |
| Node 全范围诊断 | 两版各 5,412 项；拆分＋预读版本 220 失败、基线 221 失败，220 项共同失败 | 属诊断配置结果，与官方默认验收配置不同 |
| NAN | 两版相同链接错误，未通过 | 已有基线对照 |
| 官方 PR CI、其他目标架构 | 尚未验证 | 当前本地证据以 Windows x64 为主 |

验证概况和原始材料索引见 [VALIDATION.zh-CN.md](VALIDATION.zh-CN.md) 与[兼容性说明](COMPATIBILITY.zh-CN.md)。

### 6. Benchmark 详细数据与复现方法

#### 6.1 指标和冷热定义

所有耗时均从 **Windows 原生进程创建时间**开始，包含启动器与预读开销。

| 维度 | 本文定义 |
| --- | --- |
| APP READY | 进程创建 → 主进程 `app.whenReady().then(...)` 回调开始记录的时间 |
| 视频回调（业务讨论中的“首帧”） | 进程创建 → 首次收到可见视频呈现回调的入口时间；不是物理屏幕扫描输出，也不保证回调对应视频第一帧 |
| 冷启动 | 本文特指实体机独立系统重启、登录并等待环境就绪后，首次启动被测 Electron；保留 Windows 默认缓存／预取行为，缓存是否全部清空未单独测量 |
| 热启动 | 同一系统会话中，在预热后反复创建新 Electron 进程；不是复用同一 Electron 进程 |
| SSD / HDD | Electron 运行时及其分发文件所在磁盘；系统、网页、视频和配置目录均在 SSD |

因此完整矩阵是 **2 种存储 × 2 种冷热条件 × 2 个终点 = 8 个指标组合**，每个组合比较基线与拆分＋预读。每次启动可同时取得两个终点，不需要为两项终点各做一轮独立采样。

#### 6.2 测试机器与构建

| 项目 | 配置／来源 |
| --- | --- |
| 机器 | 同一台 Windows 实体机 |
| CPU | AMD Ryzen 9 7950X，16 核 / 32 逻辑处理器 |
| 内存 | 系统报告 33,442,582,528 字节，约 31.1 GiB 可见物理内存 |
| 系统 | Windows 11 专业版，10.0.26200，Build 26200 |
| GPU | AMD Radeon(TM) Graphics；环境快照驱动版本 32.0.21030.2001 |
| SSD | Samsung SSD 990 PRO 1TB，NVMe |
| HDD | ST4000VX000-2AG166，4 TB，SATA |
| 图形路径 | 保留默认配置；样本中 GPU 合成／视频解码功能显示 enabled，未采集逐帧硬件解码记录 |
| 测试应用 | 本地 HTML、图标和 1280×720 MP4；无网络请求 |
| 发布配置 | `release.gn`，`target_cpu="x64"`；两版使用一致的构建参数与依赖条件 |
| 基线源码标识 | 冻结清单 HEAD：`1cf98129e42ca3bff2b9ca13c78b65f10a156718` |
| 拆分＋预读源码标识 | 冻结清单 HEAD：`4806bc3ba3d849387c3f7a636f203d71e6e9b540`，完整被测源码为该 HEAD 加构建时工作区补丁 |
| 版本报告 | 样本报告 Electron `43.0.0-nightly.20260502`；最终复现以源码、补丁与产物哈希为准 |

环境快照来自 [host-environment.json](../provenance/host-environment.json)，采集于 2026-09-14。最终冷／热批次在该同一主机完成，批次之间没有重新采集完整硬件清单。

两版构建参数文件 SHA-256 均为 `8A518AC7891AF70789D0EFBDE96A31F22506575C546BB9EFEE6D83FCB2A7F235`，有效参数哈希均为 `F8B2B19BEACBC7AA2563FEC9853D19ED83F053B2290D2F7F5892D1BAFECFCA54`。完整构建时工作区补丁、参数和文件级产物哈希分别见 [基线清单](../provenance/builds/A/manifest.json) 与 [拆分＋预读清单](../provenance/builds/C/manifest.json)，对应目录包含 working-tree.patch。HEAD 加补丁才是被测源码；对应[提交审计](../provenance/product-commit-audit.json)验证了产品源码等价，工具修复排除，文档新增。

#### 6.3 冷启动：P50 / P90

每行基线与拆分＋预读各 n=20，单位 ms。变化 = 拆分＋预读 − 基线；相对变化 = 变化 / 基线 × 100%。负值更快，正值更慢。

| 存储 | 条件 | 终点 | 基线 P50 | 拆分＋预读 P50 | P50 变化 | 基线 P90 | 拆分＋预读 P90 | P90 变化 |
|---|---|---|---:|---:|---:|---:|---:|---:|
| SSD | 冷启动 | APP READY | 330 | 242 | −88 ms（−26.5%） | 391 | 298 | −93 ms（−23.7%） |
| SSD | 冷启动 | 视频呈现回调 | 1112 | 756 | −357 ms（−32.1%） | 1186 | 845 | −341 ms（−28.8%） |
| HDD | 冷启动 | APP READY | 7642 | 2623 | −5019 ms（−65.7%） | 7924 | 2697 | −5226 ms（−66.0%） |
| HDD | 冷启动 | 视频呈现回调 | 17109 | 3933 | −13176 ms（−77.0%） | 17316 | 4150 | −13166 ms（−76.0%） |

80 个样本来自 80 个不同系统启动时间，均通过既定校验；每存储 20 个配对，10 个 AC、10 个 CA。前 76 次使用 4 分钟 CPU 等待上限，环境暂停后最后 4 次使用 20 分钟上限和额外诊断，CPU≤10% 连续三次的门槛未变。所有有效样本均保留，启动前的环境暂停不计入启动耗时样本。

#### 6.4 热启动：P50 / P90

每行每版本 n=20。先完成每存储／版本 5 次热身，再执行 80 次正式启动；同一次系统启动、独立 seed 克隆、与冷启动相同的 callback-v1 计时程序。

| 存储 | 条件 | 终点 | 基线 P50 | 拆分＋预读 P50 | P50 变化 | 基线 P90 | 拆分＋预读 P90 | P90 变化 |
|---|---|---|---:|---:|---:|---:|---:|---:|
| SSD | 热启动 | APP READY | 58 | 77 | +19 ms（+33.3%） | 60 | 80 | +20 ms（+33.7%） |
| SSD | 热启动 | 视频呈现回调 | 203 | 219 | +16 ms（+8.1%） | 216 | 227 | +11 ms（+5.1%） |
| HDD | 热启动 | APP READY | 58 | 78 | +20 ms（+33.9%） | 69 | 85 | +16 ms（+22.4%） |
| HDD | 热启动 | 视频呈现回调 | 204 | 219 | +15 ms（+7.3%） | 213 | 226 | +13 ms（+6.3%） |

两个存储的 APP READY 配对结果均为 20/20 次更慢。视频回调 SSD 19/20、HDD 18/20 对更慢。额外耗时主要集中在 READY 前，尚未进行分段归因。

旧 SSD 热启动每版本 30 次，视频 P50 回退 +7.2%；其 profile 与严格第一帧规则不同，作为历史记录保留。后续被账户切换打断的 13 次正式热启动也单独保存；最终批次使用重新准备的独立样本，与历史批次分开统计。

#### 6.5 统计与计时方法

P50、P90 均从原始值重新计算，采用排序后的线性插值，零基索引 `i=(n−1)×p`，在相邻值间插值。耗时按毫秒取整，百分比和体积保留一位小数；绝对变化和百分比均使用未舍入值计算，因此显示值相减可能有末位舍入差异。最终矩阵全部从原始 sample/context 事件复算；旧热测报告不参与本表。分组分位数之比不是配对变化的分位数，两者不混用。

原生辅助程序使用 `GetProcessTimes` 读取目标进程创建时间，以 `GetSystemTimePreciseAsFileTime` 和 `QueryPerformanceCounter` 建立 FILETIME/QPC 对应。渲染进程在视频呈现回调入口保存时间，随后执行 20 次 IPC 往返以建立渲染时钟与主进程 QPC 的映射。时钟映射不确定度与前后锚点漂移分别限制在 2 ms 以内；这两项阈值约束时钟映射，不衡量物理屏幕显示误差。

统一回调协议同时校验窗口／页面可见、窗口未最小化、视频未暂停、720p 尺寸、帧计数正整数、无网络请求、时钟一致性及退出状态。启动前不读取目标运行时做哈希；完整性准备在初始重启前完成，正式样本结束后再核验，以免测量前的完整文件读取直接改变条件。

#### 6.6 复现流程

**复算已有数据（任意平台，不启动 Electron）：**

```sh
git clone https://github.com/zuohuiyang/electron-windows-runtime-benchmark.git
cd electron-windows-runtime-benchmark
node scripts/analyze.cjs
node --test scripts/analyze.test.cjs
```

Node.js 18 或更新版本，无额外依赖。复算程序逐字节核对原始文件哈希，校验最终 180 次启动（含热身）的有效性、80 次冷启动独立 boot、热启动同一 boot、配对顺序及各组数量，重新生成 [summary.json](../reports/summary.json) 和 [P50/P90 表](../reports/RESULTS.zh-CN.md)，并核对原执行完成报告。

重新采集的环境、工具编译、固定媒体、seed 克隆、权限预检、空闲规则和停止规则见 [METHODOLOGY.zh-CN.md](METHODOLOGY.zh-CN.md)。原执行控制器以 .txt 归档，复用时需要适配本机路径和运行环境；单次测量入口为 harness/launch.cjs。

#### 6.7 证据索引

| 材料 | 仓库入口 |
|---|---|
| 当前全部冷启动原始 sample/context/result | [data/cold](../data/cold) |
| 当前全部热启动与热身 sample/context、批次完成状态 | [data/warm](../data/warm) |
| 执行完成时的原统计 | [recorded-summary.json](../data/recorded-summary.json) |
| 计时辅助程序、页面、图标与视频回调代码 | [harness](../harness) |
| 原执行控制器 | [archive/controllers](../archive/controllers) |
| 原始文件哈希与构建参数／补丁 | [provenance](../provenance) |
| 历史热启动退化和中断批次 | [data/history](../data/history) |

证据仓库包含完整正式样本、热身记录和复算代码。运行时二进制与原 profile 未分发；复算使用归档数据，重新采集时从固定上游来源准备媒体，并生成适用于测试账户的 profile。

## Checklist

- [ ] 已构建并验证最终提交版本。
- [ ] PR 描述、收益、限制及证据链接已填写完整。
- [ ] 提交者已实际审阅并理解最终代码与说明。
- [ ] `npm test` 通过。
- [ ] 新增／修改的回归测试与最终代码对应。
- [ ] 必要的分发、兼容性与迁移文档已更新。
- [ ] Release Notes 面向应用开发者，准确描述最终影响。

## Release Notes

改进了 Windows 应用在部分冷启动场景下的启动速度，将运行时移至独立的 `main.dll` 并在浏览器进程启动时预读。自定义分发流程需包含该 DLL。
