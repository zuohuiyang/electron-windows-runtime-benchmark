const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Electron calls base::Process::Current().CreationTime(): this includes the loader.
const creationEpochMs = process.getCreationTime();
const emit = (event, details = {}) => process.stdout.write(`@@VIDEO_BENCH@@${JSON.stringify({ event, ...details })}\n`);
if (!Number.isFinite(creationEpochMs)) throw Error('Process creation time is unavailable');
if (!process.env.RUNTIME_BENCH_PROFILE) throw Error('Explicit benchmark profile required');
app.setPath('userData', process.env.RUNTIME_BENCH_PROFILE);
let window;
let received = false;
const networkRequests = [];
const stages = [];
const stage = event => stages.push({ event, qpcMs: Number(process.hrtime.bigint()) / 1e6 });
function fail(message) { emit('error', { message }); app.exit(1); }

ipcMain.on('video-error', (_event, details) => fail(JSON.stringify(details)));
ipcMain.handle('video-clock-ping', () => process.hrtime.bigint().toString());
ipcMain.on('video-first-frame', async (event, frame) => {
  if (event.sender !== window.webContents || received) return fail('Unexpected or duplicate first frame');
  received = true;
  const receivedNs = process.hrtime.bigint();
  let timing;
  try { timing = require('./clock.cjs').measure(process.pid, frame, receivedNs, creationEpochMs); }
  catch (error) { return fail(error.stack); }
  const firstFrameMs = timing.firstFrameMs;
  if (!Number.isFinite(firstFrameMs) || firstFrameMs <= 0 || firstFrameMs > 30000 ||
      (!Number.isInteger(frame.presentedFrames) || frame.presentedFrames < 1) || frame.visibility !== 'visible' || frame.paused ||
      frame.width <= 0 || frame.height <= 0 || !window.isVisible() || window.isMinimized()) {
    return fail(`Invalid first frame: ${JSON.stringify(frame)}`);
  }
  for (const item of stages) emit(item.event, { sinceCreationMs: item.qpcMs - timing.creationQpcMs });
  emit('first-video-frame', { ...timing, pid: process.pid, frame, endpoint: 'first-observed-visible-video-callback-v1' });
  // Keep all inspection and output-file work after the timing endpoint.
  setTimeout(async () => {
    try {
      if (process.env.RUNTIME_BENCH_PREVIEW) {
        const screenshot = await window.webContents.capturePage();
        fs.writeFileSync(process.env.RUNTIME_BENCH_PREVIEW, screenshot.toPNG());
      }
      emit('diagnostics', { networkRequests, gpu: app.getGPUFeatureStatus(), metrics: app.getAppMetrics(), versions: process.versions });
      if (networkRequests.length) return fail('Unexpected network request');
      app.quit();
    } catch (error) { fail(error.stack); }
  }, process.env.RUNTIME_BENCH_PREVIEW ? 1000 : 150);
});

app.whenReady().then(async () => {
  stage('app-ready');
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    networkRequests.push({ url: details.url, resourceType: details.resourceType });
    callback({ cancel: true });
  });
  window = new BrowserWindow({ width: 1080, height: 760, show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  stage('window-created');
  window.once('ready-to-show', () => stage('ready-to-show'));
  window.webContents.on('render-process-gone', (_event, details) => fail(JSON.stringify(details)));
  await window.loadFile(path.join(__dirname, 'index.html'));
}).catch(error => fail(error.stack));
app.on('window-all-closed', () => { if (!received) fail('Closed before first frame'); });

