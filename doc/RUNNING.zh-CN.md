# 指定产物与磁盘运行完整冷热测试

在 Windows x64 上，用当前测试账户的**非管理员 PowerShell** 执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\run.ps1 -ElectronPath "D:\build\electron" -DiskSSD "C:\ElectronBench" -DiskHDD "E:\ElectronBench"
```

脚本将完整产物复制到两块不同的物理磁盘，每盘完成 **5 次热身、20 次热启动和 20 次冷启动**，共 90 次启动，其中 80 次为正式样本。每次同时记录 APP READY 和视频呈现回调，因此最终得到 **8 组统计**。冷启动阶段共重启 40 次。脚本会设置当前用户登录后自动续跑；运行提示和报告同时提供中文、英文。

请提前保存工作、关闭其他应用，并为当前测试账户配置自动登录。磁盘参数可以是盘符根目录或该磁盘上可写的目录；脚本为每次实验新建唯一部署目录，不覆盖原产物或旧实验。输入目录默认包含 electron.exe，也可以直接传入 EXE 路径。两块分区若位于同一物理磁盘，会拒绝运行。`-DiskSSD` 指定 SSD 上的目录，`-DiskHDD` 指定 HDD 上的目录。报告使用对应的 SSD/HDD 标签，并记录磁盘路径、物理磁盘编号与型号；介质类型由使用者按实际硬件指定。

若要完整对比基线和改动版，再提供基线产物：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\run.ps1 -ElectronPath "D:\build\changed" -BaselinePath "D:\build\baseline" -DiskSSD "C:\ElectronBench" -DiskHDD "E:\ElectronBench"
```

这会自动部署四个路径，完成 **160 次正式启动＋20 次热身**，输出 **16 组终点统计**，以及每个磁盘、冷热条件和终点的 **8 组 P50/P90 差值及百分比**。A 表示基线，C 表示改动版；只提供一个产物时，A 仅为测量标识。两个版本不需要分别手动运行。

每轮对所有路径各采一次，下一轮反转顺序；20 轮中各有 10 轮正序和逆序。全部热身先完成，然后采热启动；冷启动阶段每个样本独立重启。报告按磁盘、版本、冷热条件和终点分组，不混合计算分位数。

## 环境要求

- Windows x64、Node.js 18 或更新版本。编译辅助程序需要 Visual Studio C++ x64 构建工具；也可通过 `-ClockHelperPath` 提供由本仓库源码编译的辅助程序。
- 完整且可启动的 Electron 分发目录，所用版本支持本仓库测量页面的 API。
- 当前账户已登录可见且未锁定的桌面，其他用户的桌面会话、被测程序及运行中的 VMware 虚拟机均已关闭。
- 首次准备需要联网下载固定版本视频；已有素材时校验 SHA-256 后使用。正式测量不访问网络。

自动登录由使用者配置。脚本不保存密码，也不修改自动登录、分页文件或机器级自启动设置。登录续跑使用当前用户的 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 中的 `ElectronBenchmark` 项，按当前用户权限运行；每次核对用户 SID，并拒绝管理员终端。

## 准备和采样流程

1. 在新输出目录复制测量程序，编译原生计时辅助程序，准备视频并校验哈希。
2. 记录机器环境及被测路径，实际启动 Electron 初始化配置，再检查复制后的配置能否正常启动。每个部署路径单独预检，每次正式测量使用该路径初始配置的独立副本。
3. 保存所有部署目录、测量程序和控制器的文件哈希。设置登录续跑，先在同一次系统启动中完成热身和热启动采样。
4. 每个冷启动样本之前重启一次，登录后自动续跑。开机至少等待 120 秒，并要求连续三次总 CPU 不超过 10%，采样间隔 2 秒。冷启动前不读取 Electron 文件做哈希，文件校验在启动测量后执行。
5. 全部完成后生成 JSON 和 Markdown 报告，移除登录启动项并打开结果。

重启使用 `shutdown /r /t 0`，不强制关闭其他应用。若 Windows 阻止重启，脚本停止，不会循环强制重试。

CPU 在 20 分钟内未达到要求时，会保存占用进程、服务、磁盘及内存诊断。采样失败、输入变化或中断时停止并移除自动启动项，保留已采集数据，不覆盖失败样本，不自动补测。失败实验需要排除原因后在新目录重新开始。

这里的冷启动指重启后首次启动被测 Electron，保留 Windows 默认缓存和预取。热启动是在同一启动会话内预热后创建新进程。测量时保持测试账户独占桌面，避免手动启动被测程序或运行其他负载。

## 数量、输出与控制

```powershell
# 自定义样本数；每种冷热条件各 10 次，热身 3 次
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\run.ps1 -ElectronPath "D:\electron\electron.exe" -Count 10 -Warmups 3

# 仅准备，每个部署路径执行两次启动预检；不安装登录启动项、不正式采样、不重启
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\run.ps1 -ElectronPath "D:\electron\electron.exe" -PrepareOnly
```

默认输出位于 `%LOCALAPPDATA%\ElectronBench\runs\<时间和唯一标识>`，开始时会显示实际路径。也可使用 `-OutputDirectory` 指定新目录；应将配置、页面和日志放在 SSD 上，保持它们的存储位置一致。输出不能位于 Electron 分发目录内。

在输出目录执行以下命令：

```powershell
# 开始已经 PrepareOnly 准备好的实验
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\runner\control.ps1 -Action Start

# 查询状态
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\runner\control.ps1 -Action Status

# 停止并移除登录启动项；正在进行的单次测量结束后停止
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\runner\control.ps1 -Action Stop

# 采样完成后，从该实验的原始记录重新生成报告
node .\runner\data.cjs report .
```

也可以在输出目录创建名为 `STOP` 的空文件。脚本在等待及每次采样后检查它。输出中 `state.json` 记录进度，`results/` 保存原始事件、环境和校验记录，`logs/` 保存执行日志，`RESULTS.md` 和 `summary.json` 保存最终 P50/P90。失败信息保存在 `ATTENTION.txt`。

## 与仓库已有数据的关系

新采集文件保存在独立输出目录，不修改 `benchmark/data/`。使用输出目录里的 `runner/data.cjs report` 复算新实验；历史数据专用的 `tests/scripts/analyze.cjs` 仍仅分析原归档。新实验独立初始化配置、冻结构建和顺序，不与历史样本合并。

省略两个磁盘参数时，仍支持在传入的原始 EXE 路径上测单路径的冷热数据。部署副本和原始记录在完成或停止后均保留，供检查与复算。

## 在虚拟机中验证流程

使用 `-WorkflowOnly` 可允许两个目标目录位于同一物理磁盘，并允许高 CPU 负载（保留实际负载记录）；报告和 JSON 会明确标记为流程验证，不能作为 SSD/HDD 性能对比。建议用 `-Count 1 -Warmups 1` 验证部署、热启动、逐次重启、自动登录续跑和汇总。

虚拟机未安装 C++ 工具链时，可在 Windows x64 构建环境中先运行 `tests/harness/build-clock-anchor.cmd`，再用 `-ClockHelperPath "C:\tools\clock-anchor.exe"` 提供辅助程序。它应由本仓库源码编译，脚本会检查能否启动并将其哈希纳入输入快照。
