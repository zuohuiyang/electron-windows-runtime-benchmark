# Reproducible media input

This experiment reuses Chromium's `media/test/data/bear-1280x720.mp4` as `app/local-video.mp4`.

- Chromium checkout: `5d637f3b235dae9d40ce8252cb88ff156a70f044`.
- SHA-256: `BCB75D3DB0A1A5056F4CD5C770CECCDB4CAE920F21ABB8139B29CD9AD39E3857`.
- 1280×720 H.264 video with AAC audio; playback is muted. Duration approximately 2.763 seconds; first observed video PTS 0.033367 seconds.
- Source documentation: https://chromium.googlesource.com/chromium/src/+/5d637f3b235dae9d40ce8252cb88ff156a70f044/media/test/data/README.md
- Source fixture: https://chromium.googlesource.com/chromium/src/+/5d637f3b235dae9d40ce8252cb88ff156a70f044/media/test/data/bear-1280x720.mp4

Copy that exact fixture from an existing Chromium checkout and verify the hash during setup, before any measured reboot. No network is used by the measured page. The local package also retains the earlier unused cat-spin fixture for identical app input provenance; it is not loaded by index.html/video.js.

The Chromium root LICENSE is BSD-style, but this audit has not independently established a media-specific grant for this particular video. The public source package therefore must omit both MP4 files and document the upstream fixture setup rather than claim a new redistribution license. Do not silently substitute another video in a frozen run. Any media change requires a new manifest and separate experiment.
