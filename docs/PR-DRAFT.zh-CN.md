# Windows EXE 拆分与 DLL 预读

## Description of Change

### 1. 改动摘要

将 Windows 版 Electron 的大体积 EXE 拆分为小型启动 EXE 和独立的 `main.dll`，并在加载 DLL 前进行预读，减少后续加载和执行中因缺页而产生的读盘等待，从而改善启动性能。

### 2. 收益摘要

本机 benchmark 以 APP READY 和用于模拟复杂 APP 启动的本地视频呈现回调为两个终点，冷启动 P50 在 SSD 上分别减少 88 ms（−26.5%）和 357 ms（−32.1%），在 HDD 上分别减少 5019 ms（−65.7%）和 13176 ms（−77.0%）。但是热启动耗时略微劣化：APP READY 和视频呈现回调 P50 在 SSD 上分别增加 19 ms（+33.3%）和 16 ms（+8.1%），在 HDD 上分别增加 20 ms（+33.9%）和 15 ms（+7.3%）；不过，热启动本身耗时就很短，基线 APP READY 的 P50 约为 58 ms，视频呈现回调约为 203–204 ms，耗时的绝对增量也很小。

我们一个拥有上千万用户的 C 端产品在线上的预读优化中，首刷时长 P50 从 6006 ms 降至 5822 ms，减少 184 ms（−3.1%，未区分冷、热启动）；另一项“文件拆分＋进程合并”优化的首刷 P50 减少 369 ms（−6.8%）、P90 减少 2378 ms（−15.0%），其中进程合并不属于本 PR，两项结果分别统计，不相加。

### 3. 兼容性影响与体积变化

- **分发兼容性**：新增与 EXE 同目录、匹配版本的 `main.dll`，自定义打包、签名和更新流程需要包含该文件。
- **路径 API 行为变化**：Windows 上 `app.getPath('module')` 由 EXE 路径变为 `main.dll` 路径；需要启动 EXE 路径的代码应使用 `app.getPath('exe')` 或 `process.execPath`。
- **体积代价**：完整分发解压后增加 2.8 MiB（+0.8%），ZIP 增加 1.2 MiB（+0.8%）。

### 4. 技术方案与权衡

#### 4.1 技术原理

EXE 拆分与 DLL 预读从两个方面改善启动速度：预读减少缺页带来的读盘等待，拆分则可能降低部分杀软检查造成的阻塞。

##### 4.1.1 预读：减少缺页带来的读盘等待

DLL 映射到进程地址空间后，尚未驻留内存的页面在执行时触发需要读盘的缺页，造成分散的 I/O 等待。本方案先启动小型 EXE，在加载 `main.dll` 前调用 Chromium 的 `PreReadFile`，通过 `PrefetchVirtualMemory` 提前批量预读 DLL 页面，减少后续加载和执行中的读盘等待。

HDD 对分散读盘更敏感，因此预读可能带来更大收益；热启动时页面已有缓存，预读自身的开销则可能导致轻微劣化。

##### 4.1.2 杀软策略：EXE 与 DLL 的检查差异

根据我个人过往的杀软开发经验，部分杀软对 EXE 启动的检查比对 DLL 加载更严格。由于长时间阻塞 DLL 加载可能导致程序无响应、影响用户体验，这些杀软通常会对 DLL 采用较轻的检查策略，并缩短阻塞时间。因此，将 Electron 主体代码从 EXE 移入 DLL，可能减少安全检查带来的启动等待，实际效果取决于所用杀软及其配置。

#### 4.2 设计依据与已有实践

“将主体代码从启动 EXE 移入独立 DLL，并在加载 DLL 前安排文件预读”已有产品实践。Windows Chrome 的 Chromium 实现使用 `chrome.exe` 启动器加载独立的主 DLL；`MainDllLoader` 的加载路径包含 `base::PreReadFile`，在 `LoadLibraryExW` 之前执行预读。

我们一个拥有上千万用户的 C 端产品采用了 EXE 拆分与 DLL 预读，并在线上观察到启动收益。该方案已在线上运行两年多，并被其他多个产品采用，其兼容性和稳定性已在这些产品的线上运行中得到验证。本改动将这一实践整理为 Electron 的通用实现。

另外，据我们观察，中国另一款拥有上千万用户、基于 Electron 的 C 端客户端——QQ PC 客户端也采用了类似方案。

#### 4.3 启动流程
```
Windows 创建进程
  → electron.exe 启动器
  → 定位同目录 main.dll，初始化 SandboxInterfaceInfo
  → 主进程预读 main.dll
  → LoadLibraryExW 加载 main.dll
  → GetProcAddress 查找 ElectronMain
  → 传入启动参数、沙箱接口与 EXE 的 Fuse 配置
  → Electron 初始化 → APP READY
```
#### 4.4 导出表兼容

**导出表兼容是本方案的一个重点。** Electron 主体代码移入 `main.dll` 后，已有 Node addon 仍可能从 EXE 查找 Node 提供的函数；如果 EXE 不再导出这些函数，插件就会加载或调用失败。

##### 4.4.1 背景：插件从 EXE 查找函数

Node addon 需要调用 Node 提供的函数。Windows 上，典型的 node-gyp 插件通过 `node.lib` 链接，在导入信息中记录对 Node 宿主的依赖。在 Electron 中，插件构建使用延迟加载和 `win_delay_load_hook`，将对 Node 宿主的引用转向当前 EXE。以下是 `load_exe_hook` 的典型实现（node-gyp 10.2.0）：

```cpp
static FARPROC WINAPI load_exe_hook(unsigned int event, DelayLoadInfo* info) {
  if (event != dliNotePreLoadLibrary)
    return NULL;
  if (_stricmp(info->szDll, HOST_BINARY) != 0)
    return NULL;
  return (FARPROC)GetModuleHandle(NULL);
}

decltype(__pfnDliNotifyHook2) __pfnDliNotifyHook2 = load_exe_hook;
```

`GetModuleHandle(NULL)` 返回当前进程的 EXE 句柄，后续函数解析因此查询 EXE 的导出表，也使插件不必依赖 EXE 的固定文件名。

##### 4.4.2 曾尝试的方案：改写插件的延迟导入表

我们曾在 Node 插件加载期间 hook `NtMapViewOfSection`，在 `.node` 文件映射到内存后、相关延迟导入解析前，将延迟导入描述中的 `node.exe` 改为 `main.dll`，使这类插件转向 DLL 查找函数。流程如下：

```text
Node 开始加载 addon → 安装 NtMapViewOfSection hook → LoadLibrary
  → addon 映射完成 → 将延迟导入中的 node.exe 改为 main.dll
  → 后续解析相关函数时从 main.dll 获取地址
```

这个方案看似比较优雅，我们也在线上使用了一段时间，但后来另一款产品接入这一方案时，发现它无法兼容 napi-rs 插件：改写延迟导入表只能覆盖依赖该机制的插件，无法兼容直接从 EXE 查找函数的方式。以 napi-rs 2.16.17 的 Windows 实现为例，`napi-sys` 通过 `libloading::os::windows::Library::this()` 取得宿主 EXE，再用 `host.get()` 按名称查找 Node-API 函数。其 libloading 0.8 系列的对应 Windows 路径使用 `GetModuleHandleExW(0, NULL, ...)` 和 `GetProcAddress`，不经过上述 `node.exe` 延迟导入表。因此，即使改写了延迟导入表，这类插件仍会直接查询 EXE 的导出表。

##### 4.4.3 最终方案：EXE 导出表转发

本方案在 EXE 中保留原有导出名称，通过 Windows PE 的导出转发机制，将移入 DLL 的函数指向 `main.dll` 中的实现。这样，无论插件通过延迟加载钩子取得 EXE 句柄，还是像上述 napi-rs 实现一样直接查找 EXE 导出，都可以沿用原来的函数查找方式，无需为此次拆分改写插件的导入表。

```text
addon 延迟加载钩子 ──┐
                    ├→ EXE 导出表 → 转发到 main.dll 中的实现
napi-rs 动态查找 ────┘
```

`generate-runtime-exports.py` 从 `main.dll` 的 PE 命名导出自动生成转发列表，避免手工维护大量符号。

#### 4.5 Fuse、沙箱、快照和分发

Fuse 配置由启动器传入 `main.dll`，避免拆分后错误读取另一份配置；沙箱接口在启动器初始化后传入 `ElectronMain`。xcache 改为从 `main.dll` 读取 Node 快照。Windows 分发清单包含 `main.dll`，符号生成目标同时覆盖 EXE 与 DLL。

#### 4.6 后续扩展：固定启动入口与按版本组织的 DLL 目录

EXE 拆分为按版本组织安装目录提供了基础：启动 EXE 保持固定路径，`main.dll` 及其配套文件放入版本号目录，由启动器选择加载。这样升级时无需改变 EXE 路径，也可避免因路径变化而反复修改快捷方式和按程序路径配置的防火墙规则。

本 PR 仍从 EXE 同目录加载 `main.dll`，尚未实现上述布局。

### 5. 正确性与兼容性验证

已有验证结果如下。产品分支的 10 个源码、构建和测试文件与已验证检查点内容一致，新增迁移文档通过 Markdown 检查。

| 验证项 | 结果 | 证据与范围 |
| --- | --- | --- |
| 两版构建、发布产物 | 已构建并用于测量 | HEAD、补丁及[产品文件等价审计](../provenance/product-commit-audit.json)已记录 |
| Windows EXE/DLL 拆分回归 | 五项定向通过 | [改名 EXE、Fuse 和加载错误路径](../provenance/validation/runtime-five-cases.log) |
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
| SSD / HDD | Electron EXE、DLL 及其配套分发文件所在磁盘；系统、网页、视频和配置目录均在 SSD |

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

统一回调协议同时校验窗口／页面可见、窗口未最小化、视频未暂停、720p 尺寸、帧计数正整数、无网络请求、时钟一致性及退出状态。启动前不读取被测 Electron 二进制文件做哈希；完整性准备在初始重启前完成，正式样本结束后再核验，以免测量前的完整文件读取直接改变条件。

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

证据仓库包含完整正式样本、热身记录和复算代码。被测 Electron 二进制文件与原 profile 未分发；复算使用归档数据，重新采集时从固定上游来源准备媒体，并生成适用于测试账户的 profile。

#### 6.8 线上收益详细数据

我们一个拥有上千万用户的 C 端产品在线上分别实施了预读优化和“文件拆分＋进程合并”优化。两项统计对应不同的改动范围，分别展示。

**预读优化。** 首刷时长总体数据不区分冷、热启动，冷启首刷另行统计。

| 线上指标 | 改动前 | 改动后 | 变化 |
| --- | ---: | ---: | ---: |
| 首刷时长 P50（不区分冷、热启动） | 6006 ms | 5822 ms | −184 ms（−3.1%） |
| 冷启首刷时长 P50 | 7461 ms | 7384 ms | −77 ms（−1.0%） |
| 主窗口打开耗时 | 1493 ms | 1367 ms | −126 ms（−8.5%） |
| 推荐页 LCP P50 | 未提供 | 未提供 | −0.7% |

冷启首刷时长 P50 按机型分组，低端机、中端机、高端机分别减少 5.1%、2.3%、1.1%。

**文件拆分＋进程合并。** 这项优化还将原有两个进程合并为一个进程，线上首刷收益如下：

| 线上指标 | 变化 |
| --- | ---: |
| 首刷时长 P50 | −369 ms（−6.8%） |
| 首刷时长 P90 | −2378 ms（−15.0%） |

进程合并不属于本 PR；这组数据反映文件拆分与进程合并的共同效果，不能单独归因于 EXE 拆分，也不与预读收益相加。本 PR 的“EXE 拆分＋DLL 预读”整体效果由前述本机 benchmark 对照测量。

以上数据来自团队提供的线上统计截图；相对变化沿用原统计结果并保留一位小数，预读组绝对变化由图中毫秒值相减得到。主窗口打开耗时未标注分位数。线上“首刷”及冷启动的统计口径独立于本地 benchmark，不与本地视频呈现回调数据合并统计。

## Checklist

- [ ] 已构建并验证最终提交版本。
- [ ] PR 描述、收益、限制及证据链接已填写完整。
- [ ] 提交者已实际审阅并理解最终代码与说明。
- [ ] `npm test` 通过。
- [ ] 新增／修改的回归测试与最终代码对应。
- [ ] 必要的分发、兼容性与迁移文档已更新。
- [ ] Release Notes 面向应用开发者，准确描述最终影响。

## Release Notes

改进了 Windows 应用在部分冷启动场景下的启动速度，将 Electron 主体代码移至独立的 `main.dll` 并在浏览器进程启动时预读。自定义分发流程需包含该 DLL。
