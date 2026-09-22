# Windows EXE 拆分与 DLL 预读

## Description of Change

### 1. 改动摘要

将 Windows 版 Electron 的大体积 EXE 拆分为小型启动 EXE 和独立的 `main.dll`，在加载 DLL 前预读，减少加载和执行时因缺页产生的读盘等待，改善启动性能。

### 2. 收益摘要

本机 benchmark 以先冷后热的顺序，测量进程创建到 APP READY、视频呈现回调的耗时，用本地视频页面模拟复杂 APP 启动。冷启动两个终点的 P50 在 SSD 上分别减少 162 ms（−40.0%）和 171 ms（−22.4%），在 HDD 上分别减少 630 ms（−18.9%）和 2584 ms（−36.9%）；HDD APP READY 的 P90 增加 897 ms（+26.5%）。热启动两个终点的 P50 在 SSD 上分别增加 20 ms（+33.7%）和 11 ms（+5.1%），在 HDD 上分别增加 20 ms（+34.8%）和 8 ms（+3.9%）；热启动本身较短，基线 APP READY 约 59–60 ms，视频回调约 217–218 ms。

我们在一款拥有上千万用户的 C 端产品中应用了本方案。2024 年 8 月的线上实验中，启动时长 P50 从 6006 ms 降至 5603 ms，减少 403 ms（−6.7%，统计未区分冷、热启动）。

### 3. 兼容性影响与体积变化

- **分发兼容性**：需要在 EXE 同目录放置的 `main.dll`，自定义打包、签名和更新流程也要包含该文件。
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

这套方案已在我们的产品中运行两年多，也被其他多个产品采用。我们在线上观察到了启动收益，并在这些产品中验证了方案的兼容性和稳定性。本 PR 将这套实现整理后引入 Electron。

据我们观察，QQ PC 客户端也采用了类似方案。它是中国另一款拥有上千万用户、基于 Electron 的客户端。

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

我们最初尝试在 Node 插件加载期间 hook `NtMapViewOfSection` 等 `.node` 文件映射到内存、但尚未解析相关延迟导入时，将其中的 `node.exe` 改为 `main.dll`，让插件从 DLL 查找函数。

```text
Node 开始加载 addon → 安装 NtMapViewOfSection hook → LoadLibrary
  → addon 映射完成 → 将延迟导入中的 node.exe 改为 main.dll
  → 后续解析相关函数时从 main.dll 获取地址
```

起初我们觉得这个方案很优雅，也在线上用了一段时间。后来另一款产品接入时，发现 napi-rs 插件无法正常工作：这类插件直接从 EXE 查找函数，改写延迟导入表对它们不起作用。

以 napi-rs 2.16.17 的 Windows 实现为例，`napi-sys` 用 `libloading::os::windows::Library::this()` 取得宿主 EXE，再通过 `host.get()` 按名称查找 Node-API 函数。底层 libloading 0.8 系列调用的是 `GetModuleHandleExW(0, NULL, ...)` 和 `GetProcAddress`，并不经过 `node.exe` 的延迟导入表。

##### 4.4.3 最终方案：EXE 导出表转发

最终我们选择保留 EXE 原有的导出名称，通过 Windows PE 的导出转发机制，将移入 DLL 的函数转发到 `main.dll`。延迟加载钩子和上述 napi-rs 实现都仍从 EXE 查找函数，由系统完成转发，插件无需为此次拆分修改导入表。

```text
addon 延迟加载钩子 ──┐
                    ├→ EXE 导出表 → 转发到 main.dll 中的实现
napi-rs 动态查找 ────┘
```

`generate-runtime-exports.py` 从 `main.dll` 导出表自动生成转发列表，避免手工维护大量符号。

#### 4.5 Fuse、沙箱、快照和分发

启动器将 EXE 的 Fuse 配置传入 `main.dll`，避免读到另一份配置。沙箱接口也由启动器初始化，再传入 `ElectronMain`。xcache 改为从 `main.dll` 读取 Node 快照；Windows 分发清单加入 `main.dll`，符号生成目标包含 EXE 和 DLL。

#### 4.6 后续扩展：固定启动入口与按版本组织的 DLL 目录

本次 EXE 拆分也为后续功能打下基础，例如让启动入口保持固定，同时按版本管理 DLL 及其配套文件。

为避免更新时覆盖正在使用的文件，许多软件会将不同版本安装到独立目录。但如果启动 EXE 也随版本更换路径，升级时就需要修改桌面快捷方式和按程序路径配置的 Windows 防火墙规则。这些操作还可能触发杀软检查，因误拦截而失败。

拆分后，可以让启动 EXE 保持固定路径，只将 `main.dll` 及其配套文件放入版本号目录，由启动器选择加载。这样既能按版本隔离文件，也能避免因 EXE 路径变化而反复修改快捷方式和防火墙规则。

本 PR 仍从 EXE 同目录加载 `main.dll`，尚未实现上述布局。

### 5. 正确性与兼容性验证

产品分支的 10 个源码、构建和测试文件与已验证检查点一致，新增迁移文档已通过 Markdown 检查。已有测试结果如下。

| 验证项 | 结果 | 证据与范围 |
| --- | --- | --- |
| 两版构建、发布产物 | 已构建并用于测量 | HEAD 与构建补丁已记录 |
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
复现代码和原始数据见 [electron-windows-runtime-benchmark](https://github.com/zuohuiyang/electron-windows-runtime-benchmark)。

#### 6.1 指标和冷热定义

所有耗时均从 **Windows 原生进程创建时间**开始，包含启动器与预读开销。

| 维度 | 本文定义 |
| --- | --- |
| APP READY | 进程创建 → 主进程 `app.whenReady().then(...)` 回调开始记录的时间 |
| 视频回调（业务讨论中的“首帧”） | 进程创建 → 首次收到可见视频呈现回调的入口时间；不是物理屏幕扫描输出，也不保证回调对应视频第一帧 |
| 冷启动 | 本文特指实体机独立系统重启、登录并等待环境就绪后，首次启动被测 Electron；保留 Windows 默认缓存／预取行为，缓存是否全部清空未单独测量 |
| 热启动 | 系统启动后，在预热后反复创建新 Electron 进程；不是复用同一 Electron 进程 |
| SSD / HDD | Electron EXE、DLL 及其配套分发文件所在磁盘；系统、网页、视频和配置目录均在 SSD |

共比较 **2 种存储 × 2 种冷热条件 × 2 个终点 = 8 个指标组合**，每组均包含基线和拆分＋预读版本。两个终点的数据来自同一次启动。

#### 6.2 BENCHMARK 所在的机器配置

| 项目 | 配置／来源 |
| --- | --- |
| CPU | AMD Ryzen 9 7950X，16 核 / 32 逻辑处理器 |
| 内存 | 32 GiB |
| 系统 | Windows 11 专业版，10.0.26200，Build 26200 |
| GPU | AMD Radeon(TM) Graphics；环境快照驱动版本 32.0.21030.2001 |
| SSD | Samsung SSD 990 PRO 1TB，NVMe |
| HDD | ST4000VX000-2AG166，4 TB，SATA |

本节采用最终批次 `20260922-005203-daabfc`：每个随机部署路径先执行一次启动预检，再完成 80 次独立重启的冷启动，最后在同一次开机中执行 20 次热身和 80 次热启动。测量由普通账户登录启动项续跑；每次启动前检查控制器 CPU、I/O、内存优先级为 Normal / 2 / 5。系统预取保持默认设置，同一批次部署路径固定。复现时使用 `-Order ColdFirst -Count 20 -Warmups 5`，具体命令见仓库 README。

#### 6.3 冷启动：P50 / P90

每行基线与拆分＋预读各 n=20，单位 ms。下文冷、热启动表格的差值和百分比均按原始数据计算，再将毫秒数取整、百分比保留一位小数。

| 存储 | 条件 | 终点 | 基线 P50 | 拆分＋预读 P50 | P50 变化 | 基线 P90 | 拆分＋预读 P90 | P90 变化 |
|---|---|---|---:|---:|---:|---:|---:|---:|
| SSD | 冷启动 | APP READY | 405 | 243 | −162 ms（−40.0%） | 422 | 251 | −170 ms（−40.4%） |
| SSD | 冷启动 | 视频呈现回调 | 760 | 590 | −171 ms（−22.4%） | 789 | 597 | −192 ms（−24.4%） |
| HDD | 冷启动 | APP READY | 3332 | 2702 | −630 ms（−18.9%） | 3386 | 4283 | +897 ms（+26.5%） |
| HDD | 冷启动 | 视频呈现回调 | 7004 | 4420 | −2584 ms（−36.9%） | 7739 | 5781 | −1958 ms（−25.3%） |

80 个样本分别来自 80 次系统启动，均通过既定校验。A 表示基线版本，C 表示拆分＋预读版本。每种存储有 20 个配对，其中 10 个先运行基线版本、再运行拆分＋预读版本（AC），另 10 个按相反顺序运行（CA）。

SSD 两个终点在 20/20 轮中均快于同轮基线；HDD 视频回调有 18/20 轮更快。HDD 改动版 APP READY 前 9 轮约 4.1–4.4 秒，第 10 轮起约 2.6–2.7 秒，P50 改善但 P90 劣化，原因尚未单独确认。此前先热后冷的另一批测试曾出现 SSD 冷启动劣化；本批结果仅代表所述测试条件，不表示所有运行历史下均有相同收益。

#### 6.4 热启动：P50 / P90

每行每版本 n=20，单位 ms。每种存储、每个版本先热身 5 次，再执行共 80 次正式启动。

| 存储 | 条件 | 终点 | 基线 P50 | 拆分＋预读 P50 | P50 变化 | 基线 P90 | 拆分＋预读 P90 | P90 变化 |
|---|---|---|---:|---:|---:|---:|---:|---:|
| SSD | 热启动 | APP READY | 60 | 80 | +20 ms（+33.7%） | 73 | 85 | +11 ms（+15.4%） |
| SSD | 热启动 | 视频呈现回调 | 218 | 229 | +11 ms（+5.1%） | 221 | 241 | +20 ms（+9.1%） |
| HDD | 热启动 | APP READY | 59 | 79 | +20 ms（+34.8%） | 61 | 81 | +20 ms（+32.3%） |
| HDD | 热启动 | 视频呈现回调 | 217 | 225 | +8 ms（+3.9%） | 226 | 241 | +15 ms（+6.6%） |

热启动 APP READY 的 P50 在两种存储上均增加约 20 ms，视频回调分别增加约 11 ms 和 8 ms。

## Checklist

- [ ] 已构建并验证最终提交版本。
- [ ] PR 描述、收益、限制及证据链接已填写完整。
- [ ] 提交者已实际审阅并理解最终代码与说明。
- [ ] `npm test` 通过。
- [ ] 新增／修改的回归测试与最终代码对应。
- [ ] 必要的分发、兼容性与迁移文档已更新。
- [ ] Release Notes 面向应用开发者，准确描述最终影响。

## Release Notes

将 Electron 主体代码移至独立的 `main.dll`，在进程启动时预读，改善 Windows下的冷启动速度。
