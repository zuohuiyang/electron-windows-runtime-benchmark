# 复现所需的视频素材

本实验使用 Chromium 的 `media/test/data/bear-1280x720.mp4`，在本目录下保存为 `app/local-video.mp4`。

- Chromium 源码版本：`5d637f3b235dae9d40ce8252cb88ff156a70f044`。
- SHA-256：`BCB75D3DB0A1A5056F4CD5C770CECCDB4CAE920F21ABB8139B29CD9AD39E3857`。
- 视频为 1280×720 H.264，音频为 AAC，测试时静音播放。时长约 2.763 秒，首次观测到的视频呈现时间戳（PTS）为 0.033367 秒。
- [上游素材说明](https://chromium.googlesource.com/chromium/src/+/5d637f3b235dae9d40ce8252cb88ff156a70f044/media/test/data/README.md)
- [上游视频文件](https://chromium.googlesource.com/chromium/src/+/5d637f3b235dae9d40ce8252cb88ff156a70f044/media/test/data/bear-1280x720.mp4)

请从上述版本的 Chromium 源码目录复制指定视频，并在准备阶段、任何正式测量所需的重启之前核对哈希。被测页面不访问网络。原机器的本地测试包还保留了早期未使用的 cat-spin 视频，以维持已冻结输入的一致性；`index.html` 和 `video.js` 不会加载它。

Chromium 根目录的 LICENSE 采用 BSD 风格许可，但本次整理未独立确认这一视频素材的具体授权。因此公开仓库不包含上述两个 MP4 文件，仅提供上游来源和准备方法，不对视频另行声明分发许可。已冻结的实验不能直接换用其他视频；更换素材时应生成新的清单，并作为独立实验记录。
