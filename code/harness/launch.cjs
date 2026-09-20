const fs = require('node:fs'), path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const readline = require('node:readline');
const [variant, runtimeArg, profileArg, output] = process.argv.slice(2);
if (!['A', 'C'].includes(variant) || !output || fs.existsSync(output)) throw Error('Require A/C and new output');
if (!runtimeArg || !profileArg) throw Error('Usage: node launch.cjs A|C electron.exe profile-directory new-output.json');
const runtime = path.resolve(runtimeArg);
const env = { ...process.env, RUNTIME_BENCH_PROFILE: path.resolve(profileArg) };
for (const key of Object.keys(env)) {
  if (['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUNTIME_STARTUP_TRACE', 'RUNTIME_BENCH_PREVIEW'].includes(key.toUpperCase())) delete env[key];
}
fs.mkdirSync(env.RUNTIME_BENCH_PROFILE, { recursive: true });
const anchor = spawnSync(path.join(__dirname, 'clock-anchor.exe'), [], { windowsHide: true, encoding: 'utf8' });
if (anchor.status !== 0) throw Error('Prelaunch native clock anchor failed');
env.RUNTIME_BENCH_CLOCK_ANCHOR = anchor.stdout.trim();
const parentSpawnEpochMs = Date.now();
const child = spawn(runtime, [path.join(__dirname, 'app')], { env, windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
const events = [];
let stderr = '', error = null, timedOut = false;
child.stderr.on('data', data => stderr += data);
child.on('error', failure => error = failure.message);
readline.createInterface({ input: child.stdout }).on('line', line => {
  if (!line.startsWith('@@VIDEO_BENCH@@')) return;
  try { const event = JSON.parse(line.slice('@@VIDEO_BENCH@@'.length)); events.push(event); if (event.event === 'error') error = event.message; }
  catch (failure) { error = failure.message; }
});
const timeout = setTimeout(() => {
  timedOut = true;
  if (child.pid) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
}, 30000);
child.once('close', code => {
  clearTimeout(timeout);
  const frames = events.filter(event => event.event === 'first-video-frame');
  const diagnostics = events.find(event => event.event === 'diagnostics');
  const frame = frames[0];
  if (/Failed to grant sandbox access|Encountered error while migrating network context/i.test(stderr)) error = error || 'Sandbox profile permission failure';
  const valid = Boolean(code === 0 && !error && !timedOut && frames.length === 1 && diagnostics &&
    diagnostics.networkRequests.length === 0 && frame.pid === child.pid && frame.creationEpochMs >= parentSpawnEpochMs - 2 &&
    frame.ipcAndClockDeltaMs >= -2 && frame.ipcAndClockDeltaMs < 500);
  const row = { variant, pid: child.pid, parentSpawnEpochMs, timestamp: new Date().toISOString(), valid, code, error, timedOut, events, stderr };
  fs.writeFileSync(output, JSON.stringify(row, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ variant, valid, firstFrameMs: frame?.firstFrameMs }));
  if (!valid) process.exitCode = 1;
});


