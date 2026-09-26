const video = document.querySelector('#video');
const fail = message => window.videoBench.error({ message, mediaError: video.error?.code });
video.addEventListener('error', () => fail('Video decoding/loading failed'), { once: true });
window.addEventListener('error', event => fail(event.message));
window.addEventListener('unhandledrejection', event => fail(String(event.reason)));
if (typeof video.requestVideoFrameCallback !== 'function') {
  fail('requestVideoFrameCallback is required');
} else {
  // Register before assigning src: do not accidentally time the second frame.
  video.requestVideoFrameCallback(async (now, metadata) => {
    const callbackEntryNow = performance.now();
    const quality = video.getVideoPlaybackQuality();
    const frame = {
      timeOrigin: performance.timeOrigin, callbackNow: callbackEntryNow, callbackTimestamp: now,
      presentationTime: metadata.presentationTime, expectedDisplayTime: metadata.expectedDisplayTime,
      mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames,
      processingDuration: metadata.processingDuration,
      width: metadata.width, height: metadata.height,
      duration: video.duration, videoWidth: video.videoWidth, videoHeight: video.videoHeight,
      readyState: video.readyState, paused: video.paused, visibility: document.visibilityState,
      source: video.currentSrc, playbackQuality: {
        totalVideoFrames: quality.totalVideoFrames, droppedVideoFrames: quality.droppedVideoFrames,
        creationTime: quality.creationTime
      }
    };
    try {
      // Calibrate only after the recorded first-frame endpoint.
      const clockSamples = [];
      for (let i = 0; i < 20; i++) {
        const before = performance.now();
        const mainNs = await window.videoBench.clockPing();
        const after = performance.now();
        clockSamples.push({ before, mainNs, after });
      }
      window.videoBench.firstFrame({ ...frame, clockSamples });
    } catch (error) { fail(error.message); }
  });
  video.muted = true;
  video.src = 'local-video.mp4';
  video.play().catch(error => fail(error.message));
}
