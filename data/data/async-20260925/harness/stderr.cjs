// This AMD HDR capability probe can fail on the host driver without affecting
// playback. Preserve the raw log, but do not reject an otherwise valid run.
const benignGpuProbe = /^\[\d+:\d{4}\/\d{6}\.\d+:ERROR:ui\\gl\\direct_composition_support\.cc:\d+\] AMD VideoProcessorGetOutputExtension failed: .+$/;

exports.unexpected = stderr => stderr.split(/\r?\n/)
  .filter(line => line && !benignGpuProbe.test(line))
  .join('\n');
