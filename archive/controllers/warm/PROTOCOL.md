# Warm retry, 2026-09-15

Only new warm measurements are executed. Cold80/80 stays frozen and is read for the final combined report; the cold runner and its misleading intermediate completion notification are never invoked.

Same protocol as the interrupted warm batch: existing frozen baseline and split+preread, SSD/HDD, ordinary autotest exclusive desktop;20 warmups(5percondition),80 formal(20percondition), alternating pairs10AC/10CA per disk. Every launch uses a NEW pristine clone of the corresponding original seed. Same callback-v1 harness and native creation→APP READY/video callback clocks and checks. The interrupted13 formal samples and older v4warm are retained separately, never pooled.

One initial normal restart establishes a sole autotest session. No subsequent reboots. Inputs verified before warmups and after all formal launches. CPU<=10% for3readings2s apart,20min maximum; system-load diagnostics on busy observations. Failure stops; interrupted batches cannot resume across sessions.

A separate progress window reads only small checkpoint files every5seconds and displays warmups/20 and warm/80. It is the same observer for both variants. No Electron IPC, runtime reads or screenshots are used for progress. Cold completion is explicitly not overall completion. Only warm80 + final validation yields COMPLETE and the final report. It may be closed without altering sampling.

Expected15–30min after initial restart, longer if CPU idle waits. Runtime task cap4h. Keep the autotest desktop active until COMPLETE; switching accounts or locking stops validation. Root STOP cancels next step; initial restart watches STOP too. No forced shutdown, pagefile, autologon or product changes.

Sources: original coldroot C:\ElectronBench\host-callback-20x4-20260914; interruptedwarmroot C:\ElectronBench\host-unified-completion-20260915. New results only in this directory. Final SUMMARY.json has160 formal samples, eight metric combinations, P50/P90 and signed ms/percent differences. Cold methods retain the4min→20min idle-policy amendment.
