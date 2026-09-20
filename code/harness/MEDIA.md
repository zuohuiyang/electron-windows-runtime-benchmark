# 复现所需的视频素材

本实验使用 Chromium 的 `media/test/data/bear-1280x720.mp4`，在本目录下保存为 `app/local-video.mp4`。

- 素材来源的固定 Chromium 源码版本：`8e2a2b41b398770e21040625a2748c6533c23933`。
- SHA-256：`BCB75D3DB0A1A5056F4CD5C770CECCDB4CAE920F21ABB8139B29CD9AD39E3857`。
- 视频为 1280×720 H.264，音频为 AAC，测试时静音播放。时长约 2.763 秒，首次观测到的视频呈现时间戳（PTS）为 0.033367 秒。
- [上游素材说明](https://chromium.googlesource.com/chromium/src/+/8e2a2b41b398770e21040625a2748c6533c23933/media/test/data/README.md)
- [上游视频文件](https://chromium.googlesource.com/chromium/src/+/8e2a2b41b398770e21040625a2748c6533c23933/media/test/data/bear-1280x720.mp4)

仓库已附带 `app/local-video.mp4`，脚本直接使用该文件并校验上述 SHA-256，不联网下载。它与历史测试使用的视频逐字节一致。Electron 的完整源码工作区也包含此文件，位置为 Chromium 的 `src/media/test/data/bear-1280x720.mp4`；单独的 Electron 分发包不包含测试素材。

素材保持上游原文件不变，随附 Chromium 的[许可声明](CHROMIUM-LICENSE)。测试数据目录的额外 COPYING 声明仅列出另外两个 H.264 文件，未列出本素材。已冻结实验不要更换视频；更换素材应作为新的实验记录。
