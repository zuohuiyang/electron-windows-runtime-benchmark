const { spawnSync } = require('node:child_process');
const path = require('node:path');
const toNs = (ticks, frequency) => BigInt(ticks) * 1000000000n / BigInt(frequency);
const decode = anchor => {
  const lo = toNs(anchor.qpcBefore, anchor.frequency), hi = toNs(anchor.qpcAfter, anchor.frequency);
  return { lo, hi, utc: BigInt(anchor.utcFileTime100ns) * 100n, creation: BigInt(anchor.creationFileTime100ns) * 100n };
};
exports.measure = (pid, frame, receivedNs, electronCreationEpochMs) => {
  const before = process.hrtime.bigint();
  const result = spawnSync(path.join(__dirname, '..', 'clock-anchor.exe'), [String(pid)], { windowsHide: true, encoding: 'utf8' });
  const after = process.hrtime.bigint();
  if (result.status !== 0) throw Error(`Native clock anchor failed: ${result.error || result.stderr}`);
  const native = JSON.parse(result.stdout), anchor = decode(native);
  if (native.pid !== pid || anchor.lo < before - 1000n || anchor.hi > after + 1000n) throw Error('Native QPC and Node hrtime are not on the same time axis');
  const prior = JSON.parse(process.env.RUNTIME_BENCH_CLOCK_ANCHOR || 'null');
  if (!prior || prior.frequency !== native.frequency) throw Error('Prelaunch clock anchor absent or incompatible');
  const pre = decode(prior);
  const offsetBefore = pre.utc - (pre.lo + pre.hi) / 2n;
  const offsetAfter = anchor.utc - (anchor.lo + anchor.hi) / 2n;
  const clockDriftMs = Number(offsetAfter - offsetBefore) / 1e6;
  if (Math.abs(clockDriftMs) > 2) throw Error(`UTC/QPC clock changed during startup: ${clockDriftMs}ms`);
  const creationEpochMs = Number(anchor.creation - 11644473600000000000n) / 1e6;
  if (Math.abs(creationEpochMs - electronCreationEpochMs) > .01) throw Error('Native and Electron process creation times disagree');
  const creationLoNs = anchor.lo - (anchor.utc - anchor.creation);
  const creationHiNs = anchor.hi - (anchor.utc - anchor.creation);
  const creationMs = Number((creationLoNs + creationHiNs) / 2n) / 1e6;
  // Each renderer timestamp can be quantized to 0.1ms. Intersect all IPC bounds.
  const offsets = frame.clockSamples.map(sample => ({ lo: Number(BigInt(sample.mainNs)) / 1e6 - sample.after - .1,
    hi: Number(BigInt(sample.mainNs)) / 1e6 - sample.before + .1 }));
  const lo = Math.max(...offsets.map(value => value.lo));
  const hi = Math.min(...offsets.map(value => value.hi));
  const uncertaintyMs = (hi - lo) / 2 + Number(creationHiNs - creationLoNs) / 2e6;
  if (frame.clockSamples.length !== 20 || lo > hi || !Number.isFinite(uncertaintyMs) || uncertaintyMs > 2) throw Error('Renderer/QPC clock calibration inconsistent or uncertainty exceeds 2ms');
  const rendererOffsetMs = (lo + hi) / 2;
  const firstFrameMs = frame.callbackNow + rendererOffsetMs - creationMs;
  return { firstFrameMs,
    firstSubmittedMs: frame.presentationTime + rendererOffsetMs - creationMs,
    firstExpectedDisplayMs: frame.expectedDisplayTime + rendererOffsetMs - creationMs,
    firstFrameBoundsMs: [frame.callbackNow + lo - Number(creationHiNs) / 1e6, frame.callbackNow + hi - Number(creationLoNs) / 1e6],
    ipcAndClockDeltaMs: Number(receivedNs) / 1e6 - (frame.callbackNow + rendererOffsetMs),
    creationQpcMs: creationMs, creationEpochMs,
    clock: { native, prelaunch: prior, clockDriftMs, rendererOffsetBoundsMs: [lo, hi], uncertaintyMs,
      helperBracketNs: [before.toString(), after.toString()] }
  };
};
