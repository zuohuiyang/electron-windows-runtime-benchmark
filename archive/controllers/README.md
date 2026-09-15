# Executed controller source

These are byte-for-byte snapshots of the scripts that produced the final physical-host data. Executable script names have `.txt` appended to prevent accidental execution. Original-byte hashes are in `provenance/SOURCE-FILES.json`.

- `cold/run-at-logon.ps1.txt`: samples 001–076, original idle timeout.
- `cold/run-at-logon-v2.ps1.txt` and `system-load.ps1.txt`: resumed samples 077–080, unchanged CPU threshold, longer wait and diagnostics.
- `cold/pilot.cjs.txt`: original cold protocol / validation / statistics driver.
- `warm`: complete fresh warm retry controller, progress window and batch integrity/report logic.

They refer to the original machine's paths, account and binaries. They are audit sources, not a portable task installer. Do not rename and execute them on another machine without adapting and preflighting a new experiment. Credentials, autologon configuration, task installers and restart launch helpers are intentionally excluded. Use `scripts/analyze.cjs` for portable offline analysis.
