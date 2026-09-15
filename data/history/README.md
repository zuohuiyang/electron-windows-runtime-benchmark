# Historical experiments, excluded from final results

- `ssd-warm-v4/samples.jsonl`: earlier SSD warm run, 5 warmups and 30 measured launches per variant. Persistent per-variant profiles, stricter frame-count rule, different preparation/account. Its measured visible-video P50 regression was +7.20%. Do not pool with the final 20-per-condition run.
- `interrupted-warm`: 20 warmups plus 13 formal launches before a second interactive desktop caused the controller to stop. The earlier cold completion UI misleadingly invited switching accounts before warm measurement had finished. The replacement batch used fresh profiles and all-new warm samples, with a single final completion display.

Kept for provenance and to retain regressions/interruption evidence, not as additional samples in the final matrix. Earlier exploratory cold attempts and private system-load diagnostics remain on the originating host; this repository contains the complete final matrix and these relevant warm histories, not every local debugging artifact.
