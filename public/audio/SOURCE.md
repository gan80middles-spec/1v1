# 项目原创音效

hit、wall、reflect、ultimate、ko 均由本项目的 src/render/audio.ts 根据固定正弦频率、扫频、包络生成，无第三方录音。

项目生成的这五份 WAV 以 CC0-1.0 提供。说明：https://creativecommons.org/publicdomain/zero/1.0/ 。48 kHz、双声道、PCM16；成片按固定增益与事件位置混音，资产原始字节和生成参数见 content/audio-assets.json。

构建之后运行 node scripts/create-audio-assets.mjs --check 检查已保存波形；更改波形时同时更新音频版本与该清单。仅在有意更新资产时使用不带 --check 的生成命令。
