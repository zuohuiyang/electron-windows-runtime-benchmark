# Electron 启动测量结果 / Startup benchmark results

计时起点：父进程 spawn() 前的高精度时间 / Origin: parent QPC immediately before spawn().

采样顺序 / Sampling order: ColdFirst

Electron: C:\electron\runtime-split-validation\warm-release-20260925\async-reuse-background-20260925\async-background-dist\electron.exe

账户 / User: mtianyang_pc\autotest

每种条件 / Samples per condition: 20; 热身（不计入） / Excluded warmups: 5. 单位 / Unit: ms.

| 磁盘 / Disk | 版本 / Variant | 条件 / Condition | 终点 / Endpoint | 样本数 / N | P50 | P90 |
|---|---|---|---|---:|---:|---:|
| SSD (C:\) | A | 热启动 / Warm | APP READY | 20 | 63 | 68 |
| SSD (C:\) | A | 热启动 / Warm | 视频呈现回调 / Visible video callback | 20 | 220 | 233 |
| SSD (C:\) | A | 冷启动 / Cold | APP READY | 20 | 469 | 486 |
| SSD (C:\) | A | 冷启动 / Cold | 视频呈现回调 / Visible video callback | 20 | 830 | 853 |
| SSD (C:\) | C | 热启动 / Warm | APP READY | 20 | 67 | 94 |
| SSD (C:\) | C | 热启动 / Warm | 视频呈现回调 / Visible video callback | 20 | 223 | 240 |
| SSD (C:\) | C | 冷启动 / Cold | APP READY | 20 | 225 | 238 |
| SSD (C:\) | C | 冷启动 / Cold | 视频呈现回调 / Visible video callback | 20 | 582 | 608 |
| HDD (E:\) | A | 热启动 / Warm | APP READY | 20 | 64 | 78 |
| HDD (E:\) | A | 热启动 / Warm | 视频呈现回调 / Visible video callback | 20 | 221 | 230 |
| HDD (E:\) | A | 冷启动 / Cold | APP READY | 20 | 3430 | 3525 |
| HDD (E:\) | A | 冷启动 / Cold | 视频呈现回调 / Visible video callback | 20 | 8098 | 8412 |
| HDD (E:\) | C | 热启动 / Warm | APP READY | 20 | 66 | 94 |
| HDD (E:\) | C | 热启动 / Warm | 视频呈现回调 / Visible video callback | 20 | 217 | 254 |
| HDD (E:\) | C | 冷启动 / Cold | APP READY | 20 | 2099 | 2247 |
| HDD (E:\) | C | 冷启动 / Cold | 视频呈现回调 / Visible video callback | 20 | 7633 | 8055 |

## 改动版 − 基线 / Changed − baseline

| 磁盘 / Disk | 条件 / Condition | 终点 / Endpoint | Δ P50 | Δ P90 |
|---|---|---|---:|---:|
| SSD (C:\) | warm | appReadyMs | 4 ms (5.6%) | 26 ms (38.0%) |
| SSD (C:\) | warm | firstVideoCallbackMs | 3 ms (1.5%) | 6 ms (2.7%) |
| SSD (C:\) | cold | appReadyMs | -244 ms (-52.1%) | -248 ms (-51.1%) |
| SSD (C:\) | cold | firstVideoCallbackMs | -249 ms (-29.9%) | -245 ms (-28.8%) |
| HDD (E:\) | warm | appReadyMs | 2 ms (3.3%) | 17 ms (21.6%) |
| HDD (E:\) | warm | firstVideoCallbackMs | -4 ms (-1.6%) | 23 ms (10.0%) |
| HDD (E:\) | cold | appReadyMs | -1330 ms (-38.8%) | -1278 ms (-36.3%) |
| HDD (E:\) | cold | firstVideoCallbackMs | -465 ms (-5.7%) | -357 ms (-4.2%) |

冷启动为重启后的首次被测 Electron 启动，保留 Windows 默认缓存。

Cold means the first target Electron launch after reboot, with default Windows caching.

视频终点为首次收到可见视频呈现回调，不保证是解码第一帧或物理屏幕输出。结果仅代表本次机器和配置。

The video endpoint is the first observed visible video callback, not necessarily decoded frame one or physical scanout. Results apply to this machine and configuration.
