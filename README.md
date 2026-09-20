# Electron Windows Startup Benchmark

English | [简体中文](README.zh-CN.md)

This repository contains benchmark code, raw measurements, and results collected on a local test machine.

The code and documentation were developed and organized with assistance from GPT-6 Astra.

The video fixture is included; no video download is required.

## Run the benchmark

Use Windows x64 with Node.js 18+ and C++ build tools. Configure automatic login for the test account, save your work, and close other applications. From the repository directory, run the following in a **non-administrator PowerShell**, replacing the build and disk paths:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\code\run.ps1 `
  -ElectronPath "D:\build\changed" `
  -BaselinePath "D:\build\baseline" `
  -DiskSSD "C:\ElectronBench" `
  -DiskHDD "E:\ElectronBench"
```

By default, the comparison collects 20 samples per condition: **160 measured launches, 20 warmup launches, and 80 reboots**, resuming automatically after login. Each launch records APP READY and the first visible video presentation callback, with P50/P90 summaries and version comparisons. Omit `-BaselinePath` to test a single build.

New results are saved to `%LOCALAPPDATA%\ElectronBench\runs\<run-directory>`: `results/` contains raw records; `RESULTS.md` and `summary.json` contain summaries. The report opens when the run completes. New runs do not overwrite the archived data in this repository. To stop sampling, create an empty `STOP` file in the run directory.

See the [usage guide (Chinese)](doc/RUNNING.zh-CN.md) for parameters, helper preparation, and detailed instructions.

## Archived test data

- [data/data/](data/data): raw cold- and warm-start measurements from the test machine.
- [data/reports/RESULTS.zh-CN.md](data/reports/RESULTS.zh-CN.md): P50/P90 summaries and comparisons.
- [data/provenance/](data/provenance): machine environment, tested builds, and file hashes.
- [Methodology (Chinese)](doc/METHODOLOGY.zh-CN.md): sampling, timing, and statistical definitions.

Recompute the archived results: `node code/scripts/analyze.cjs`.
