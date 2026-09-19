# Windows EXE 拆分与 DLL 预读

## Description of Change

### 1. 改动摘要

将 Windows 版 Electron 的大体积 EXE 拆分为小型启动 EXE 和独立的 `main.dll`，在加载 DLL 前预读，减少加载和执行时因缺页产生的读盘等待，改善启动性能。

### 2. 收益摘要

本机 benchmark 测量从进程创建到 APP READY、视频呈现回调的耗时，用本地视频页面模拟复杂 APP 的启动场景。两个终点的冷启动 P50 在 SSD 上分别减少 88 ms（−26.5%）和 357 ms（−32.1%），在 HDD 上分别减少 5019 ms（−65.7%）和 13176 ms（−77.0%）。但热启动略有变慢：两个终点的 P50 在 SSD 上分别增加 19 ms（+33.3%）和 16 ms（+8.1%），在 HDD 上分别增加 20 ms（+33.9%）和 15 ms（+7.3%）。热启动的绝对增量较小，基线耗时本身也较短：APP READY 的 P50 约为 58 ms，视频呈现回调约为 203–204 ms。

我们在一款拥有上千万用户的 C 端产品中应用了本方案。2024 年 8 月的线上实验中，启动时长 P50 从 6006 ms 降至 5603 ms，减少 403 ms（−6.7%，统计未区分冷、热启动）。

### 3. 兼容性影响与体积变化

- **分发兼容性**：需要在 EXE 同目录放置版本匹配的 `main.dll`，自定义打包、签名和更新流程也要包含该文件。
- **路径 API 行为变化**：Windows 上 `app.getPath('module')` 由 EXE 路径变为 `main.dll` 路径；需要启动 EXE 路径的代码应使用 `app.getPath('exe')` 或 `process.execPath`。
- **体积代价**：完整分发解压后增加 2.8 MiB（+0.8%），ZIP 增加 1.2 MiB（+0.8%）。

### 4. 技术方案与权衡

#### 4.1 技术原理

这两项改动针对不同的启动等待：预读减少缺页带来的读盘等待，EXE 拆分则可能减少部分杀软检查造成的阻塞。

##### 4.1.1 预读：减少缺页带来的读盘等待

DLL 映射到进程地址空间后，访问尚未驻留内存的页面会触发缺页。如果这些页面需要从磁盘读取，程序就可能多次等待分散的 I/O。本方案先启动小型 EXE，在加载 `main.dll` 前调用 Chromium 的 `PreReadFile`，通过 `PrefetchVirtualMemory` 批量预读 DLL 页面，减少后续读盘等待。

HDD 对分散读盘更敏感，预读可能带来更大收益。热启动时页面已有缓存，预读本身的开销则可能让启动略微变慢。

##### 4.1.2 杀软策略：EXE 与 DLL 的检查差异

根据我过去开发杀软的经验，部分杀软对 EXE 启动的检查比对 DLL 加载更严格。长时间阻塞 DLL 加载可能让程序无响应，影响用户体验，因此这些杀软会对 DLL 采用较轻的检查策略，缩短阻塞时间。将 Electron 主体代码从 EXE 移入 DLL，可能减少这部分启动等待，具体效果取决于所用杀软及其配置。

#### 4.2 设计依据与已有实践

Windows Chrome 已采用类似做法：由 `chrome.exe` 启动器加载独立的主 DLL，`MainDllLoader` 在调用 `LoadLibraryExW` 前通过 `base::PreReadFile` 预读。

这套方案已在上述 C 端产品中运行两年多，也被其他多个产品采用。我们在线上观察到了启动收益，并在这些产品中验证了方案的兼容性和稳定性。本 PR 将这套实现整理后引入 Electron。

据我们观察，QQ PC 客户端也采用了类似方案。它是中国另一款拥有上千万用户、基于 Electron 的 C 端客户端。

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

导出表兼容是这次拆分的重点。Electron 主体代码移入 `main.dll` 后，已有 Node addon 仍可能从 EXE 查找 Node 函数。如果 EXE 不再提供这些导出，插件就会加载或调用失败。

##### 4.4.1 背景：插件从 EXE 查找函数

Windows 上，典型的 node-gyp 插件通过 `node.lib` 链接所需的 Node 函数，并在导入信息中记录对 Node 宿主的依赖。为 Electron 构建插件时，延迟加载和 `win_delay_load_hook` 会将这一引用转向当前 EXE。node-gyp 10.2.0 中的 `load_exe_hook` 逻辑如下：

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

`GetModuleHandle(NULL)` 返回当前进程的 EXE 句柄，后续便从 EXE 的导出表查找函数。这样，即使 EXE 改名，插件也能找到它。

##### 4.4.2 曾尝试的方案：改写插件的延迟导入表

我们最初尝试在 Node 插件加载期间 hook `NtMapViewOfSection`：等 `.node` 文件映射到内存、但尚未解析相关延迟导入时，将其中的 `node.exe` 改为 `main.dll`，让插件从 DLL 查找函数。

```text
Node 开始加载 addon → 安装 NtMapViewOfSection hook → LoadLibrary
  → addon 映射完成 → 将延迟导入中的 node.exe 改为 main.dll
  → 后续解析相关函数时从 main.dll 获取地址
```

起初我们觉得这个方案很简洁，也在线上用了一段时间。后来另一款产品接入时，发现 napi-rs 插件无法正常工作：这类插件直接从 EXE 查找函数，改写延迟导入表对它们不起作用。

以 napi-rs 2.16.17 的 Windows 实现为例，`napi-sys` 用 `libloading::os::windows::Library::this()` 取得宿主 EXE，再通过 `host.get()` 按名称查找 Node-API 函数。底层 libloading 0.8 系列调用的是 `GetModuleHandleExW(0, NULL, ...)` 和 `GetProcAddress`，并不经过 `node.exe` 的延迟导入表。

##### 4.4.3 最终方案：EXE 导出表转发

最终我们选择保留 EXE 原有的导出名称，通过 Windows PE 的导出转发机制，将移入 DLL 的函数转发到 `main.dll`。延迟加载钩子和上述 napi-rs 实现都仍从 EXE 查找函数，由系统完成转发，插件无需为此次拆分修改导入表。

```text
addon 延迟加载钩子 ──┐
                    ├→ EXE 导出表 → 转发到 main.dll 中的实现
napi-rs 动态查找 ────┘
```

`generate-runtime-exports.py` 从 `main.dll` 的 PE 命名导出自动生成转发列表，避免手工维护大量符号。

#### 4.5 Fuse、沙箱、快照和分发

启动器将 EXE 的 Fuse 配置传入 `main.dll`，避免读到另一份配置。沙箱接口也由启动器初始化，再传入 `ElectronMain`。xcache 改为从 `main.dll` 读取 Node 快照；Windows 分发清单加入 `main.dll`，符号生成目标包含 EXE 和 DLL。

#### 4.6 后续扩展：固定启动入口与按版本组织的 DLL 目录

拆分后，可以进一步让启动 EXE 保持固定路径，将 `main.dll` 及其配套文件放入版本号目录，由启动器选择加载。升级时 EXE 路径不变，就不必因版本目录变化而反复修改快捷方式和按程序路径配置的防火墙规则。

本 PR 仍从 EXE 同目录加载 `main.dll`，尚未实现上述布局。

### 5. 正确性与兼容性验证

产品分支的 10 个源码、构建和测试文件与已验证检查点一致，新增迁移文档已通过 Markdown 检查。已有测试结果如下。

| 验证项 | 结果 | 证据与范围 |
| --- | --- | --- |
| 两版构建、发布产物 | 已构建并用于测量 | HEAD、补丁及[产品文件等价审计](../benchmark/provenance/product-commit-audit.json)已记录 |
| Windows EXE/DLL 拆分回归 | 五项定向通过 | 改名 EXE、Fuse 和加载错误路径 |
| xcache | 三项回归通过 | Node snapshot、script cache、function cache |
| 分发包检查 | 七项通过 | 故意构造的错误场景返回预期非零码 |
| Lint | 完整运行退出 0，有文档警告；新增迁移文档检查通过 | 历史工作区包含后续排除的工具修复 |
| Electron 完整套件 | 一轮 4,154 项中 4,096 通过、58 失败；后续失败复验部分恢复 | 全套尚未通过，完整日志未全部公开 |
| Node 全范围诊断 | 两版各 5,412 项；拆分＋预读版本 220 失败、基线 221 失败，220 项共同失败 | 属诊断配置结果，与官方默认验收配置不同 |
| NAN | 两版相同链接错误，未通过 | 已有基线对照 |
| 官方 PR CI、其他目标架构 | 尚未验证 | 当前本地证据以 Windows x64 为主 |

本 benchmark 仓库不保存上述产品兼容性测试的日志。

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

共比较 **2 种存储 × 2 种冷热条件 × 2 个终点 = 8 个指标组合**，每组均包含基线和拆分＋预读版本。两个终点的数据来自同一次启动。

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

环境快照 [host-environment.json](../benchmark/provenance/host-environment.json) 采集于 2026-09-14。最终冷／热批次均在这台机器上完成，批次之间未重新采集完整硬件清单。

两版构建参数文件的 SHA-256 均为 `8A518AC7891AF70789D0EFBDE96A31F22506575C546BB9EFEE6D83FCB2A7F235`，有效参数哈希均为 `F8B2B19BEACBC7AA2563FEC9853D19ED83F053B2290D2F7F5892D1BAFECFCA54`。构建时的工作区补丁、参数和各产物哈希见 [基线清单](../benchmark/provenance/builds/A/manifest.json) 与 [拆分＋预读清单](../benchmark/provenance/builds/C/manifest.json)，补丁保存在对应目录的 working-tree.patch 中。复现被测源码时需要同时使用 HEAD 和补丁。[提交审计](../benchmark/provenance/product-commit-audit.json)已核对整理后的产品源码与被测版本内容一致，并记录了排除的工具修复和新增文档。

#### 6.3 冷启动：P50 / P90

每行基线与拆分＋预读各 n=20，单位 ms。变化 = 拆分＋预读 − 基线；相对变化 = 变化 / 基线 × 100%。负值更快，正值更慢。

| 存储 | 条件 | 终点 | 基线 P50 | 拆分＋预读 P50 | P50 变化 | 基线 P90 | 拆分＋预读 P90 | P90 变化 |
|---|---|---|---:|---:|---:|---:|---:|---:|
| SSD | 冷启动 | APP READY | 330 | 242 | −88 ms（−26.5%） | 391 | 298 | −93 ms（−23.7%） |
| SSD | 冷启动 | 视频呈现回调 | 1112 | 756 | −357 ms（−32.1%） | 1186 | 845 | −341 ms（−28.8%） |
| HDD | 冷启动 | APP READY | 7642 | 2623 | −5019 ms（−65.7%） | 7924 | 2697 | −5226 ms（−66.0%） |
| HDD | 冷启动 | 视频呈现回调 | 17109 | 3933 | −13176 ms（−77.0%） | 17316 | 4150 | −13166 ms（−76.0%） |

80 个样本分别来自 80 次系统启动，均通过既定校验。每种存储有 20 个配对，其中 10 个按 AC 顺序、10 个按 CA 顺序运行。前 76 次的 CPU 空闲等待上限为 4 分钟；因环境条件暂停后，最后 4 次将上限改为 20 分钟，并增加诊断记录。开始测试的条件始终是 CPU≤10% 连续三次。所有有效样本均保留，启动前等待环境就绪的时间不计入启动耗时。

#### 6.4 热启动：P50 / P90

每行每版本 n=20。每种存储、每个版本先热身 5 次，再执行共 80 次正式启动。测试在同一次系统启动中完成，每次使用独立的 seed 克隆，计时程序与冷启动相同，均为 callback-v1。

| 存储 | 条件 | 终点 | 基线 P50 | 拆分＋预读 P50 | P50 变化 | 基线 P90 | 拆分＋预读 P90 | P90 变化 |
|---|---|---|---:|---:|---:|---:|---:|---:|
| SSD | 热启动 | APP READY | 58 | 77 | +19 ms（+33.3%） | 60 | 80 | +20 ms（+33.7%） |
| SSD | 热启动 | 视频呈现回调 | 203 | 219 | +16 ms（+8.1%） | 216 | 227 | +11 ms（+5.1%） |
| HDD | 热启动 | APP READY | 58 | 78 | +20 ms（+33.9%） | 69 | 85 | +16 ms（+22.4%） |
| HDD | 热启动 | 视频呈现回调 | 204 | 219 | +15 ms（+7.3%） | 213 | 226 | +13 ms（+6.3%） |

两种存储上，拆分＋预读版本的 APP READY 在 20/20 个配对中都更慢；视频回调在 SSD 上有 19/20 对更慢，HDD 上有 18/20 对更慢。增加的耗时主要出现在 READY 前，尚未分段测量各部分开销。

旧 SSD 热启动每版本测了 30 次，视频 P50 增加 7.2%。该批次的 profile 和严格第一帧规则与本轮不同，未纳入最终统计。后来被账户切换打断的 13 次正式热启动也未计入。最终批次重新准备了独立样本，与这些历史批次分开统计。

#### 6.5 统计与计时方法

P50、P90 根据原始值排序后做线性插值：零基索引为 `i=(n−1)×p`，在相邻值间插值。耗时按毫秒取整，百分比和体积保留一位小数。绝对变化和百分比用未舍入值计算，因此表中显示值相减可能有末位差异。结果均从原始 sample/context 事件复算，未使用旧热测报告。表中的相对变化按两组各自的分位数计算，不是逐对计算变化后再取分位数。

原生辅助程序通过 `GetProcessTimes` 读取目标进程的创建时间，用 `GetSystemTimePreciseAsFileTime` 和 `QueryPerformanceCounter` 对齐 FILETIME 与 QPC。渲染进程在视频呈现回调入口记录时间，再通过 20 次 IPC 往返，将渲染时钟映射到主进程 QPC。时钟映射不确定度和前后锚点漂移各限制在 2 ms 以内；这一限制不代表物理屏幕的显示误差。

每次测试都检查窗口和页面是否可见、窗口是否最小化、视频是否暂停，以及 720p 尺寸、正整数帧计数、无网络请求、时钟一致性和退出状态。文件完整性检查在初始重启前完成，正式采样结束后再次核验；不在每次启动前读取被测 Electron 二进制文件计算哈希，以免预先读入文件、改变缓存状态。

#### 6.6 复现流程

**复算已有数据（任意平台，不启动 Electron）：**

```sh
git clone https://github.com/zuohuiyang/electron-windows-runtime-benchmark.git
cd electron-windows-runtime-benchmark
node tests/scripts/analyze.cjs
node --test tests/scripts/analyze.test.cjs
```

需要 Node.js 18 或更新版本，无额外依赖。复算程序核对原始文件哈希，并检查全部 180 次启动（含热身）的有效性、配对顺序和各组数量，还会确认 80 次冷启动来自独立系统启动、热启动来自同一次系统启动。随后重新生成 [summary.json](../benchmark/reports/summary.json) 和 [P50/P90 表](../benchmark/reports/RESULTS.zh-CN.md)，与原执行完成报告核对。

重新采集数据时，按 [METHODOLOGY.zh-CN.md](METHODOLOGY.zh-CN.md) 准备环境、编译工具、固定媒体和 seed 克隆，并执行权限预检、空闲等待及停止规则。单次测量入口是 tests/harness/launch.cjs。本仓库不包含批量采样控制器，新机器需要按方法说明准备采样流程。

#### 6.7 证据索引

| 材料 | 仓库入口 |
|---|---|
| 当前全部冷启动原始 sample/context/result | [benchmark/data/cold](../benchmark/data/cold) |
| 当前全部热启动与热身 sample/context、批次完成状态 | [benchmark/data/warm](../benchmark/data/warm) |
| 执行完成时的原统计 | [recorded-summary.json](../benchmark/data/recorded-summary.json) |
| 计时辅助程序、页面、图标与视频回调代码 | [测试代码](../tests/harness) |
| 原始文件哈希与构建参数／补丁 | [构建与环境信息](../benchmark/provenance) |

仓库包含全部正式样本、热身记录和复算代码，不包含被测 Electron 二进制文件及原 profile。复算直接使用归档数据；重新采集时，需要从固定上游来源准备媒体，并为测试账户生成 profile。

## Checklist

- [ ] 已构建并验证最终提交版本。
- [ ] PR 描述、收益、限制及证据链接已填写完整。
- [ ] 提交者已实际审阅并理解最终代码与说明。
- [ ] `npm test` 通过。
- [ ] 新增／修改的回归测试与最终代码对应。
- [ ] 必要的分发、兼容性与迁移文档已更新。
- [ ] Release Notes 面向应用开发者，准确描述最终影响。

## Release Notes

将 Electron 主体代码移至独立的 `main.dll`，在浏览器进程启动时预读，改善部分 Windows 冷启动场景的启动速度。自定义分发流程需包含该 DLL。
