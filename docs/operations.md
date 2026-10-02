# 本地制作、内容修改与故障恢复

## 安装与启动

在项目根目录运行，使用项目锁定的 Node 24.21.0 / npm 11.19.0：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-node.ps1
. .\scripts\use-node.ps1
npm.cmd ci
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-export.ps1
npm.cmd run build
npm.cmd run studio
```

制作工作台为 `http://127.0.0.1:5177/production.html`；回放为 `/replay.html`。竞技场调试另运行 `npm.cmd run dev`，以 Vite 打印的地址为准。首次安装需要网络；Node 和 FFmpeg 放在 `.tools`，Chromium 放在 `.cache/ms-playwright`。字体和音效随源码提供。安装脚本核对锁定版本与 hash，拒绝用其他 FFmpeg 构建替代。

## 生成下一批视频

复制 `production.final.json` 为新配置，修改 `id`、`output`、根 seed、对阵、数量与 Top K。新 output 必须使用新目录；推荐放在 `artifacts/`。四角色支持 standard/rubber/iron/mirror。比赛硬上限 3600 tick；正式规格选择 vertical-1080，vertical-720 用于预览。导演默认 off。

```powershell
npm.cmd run produce -- --config production.final.json --resume
npm.cmd run verify -- --config production.final.json --resume
```

也可以对同一配置分别执行 `batch`、`rank`、`render`、`verify`。首次运行自动创建任务；已有任务使用 `--resume`。并发数可以调整；seed、对阵、比赛参数和嵌入内容不能改变后继续旧批次。缺候选返回实际数量及 shortfall，不补无效比赛。正式批次筛选同一对阵最多两条，并限制胜者/终结技能占比；完整排名和理由在 rankings.json。

工作台可显示任务、评分分项、入选原因和视频进度；取消后再恢复沿用原任务清单。回放页面可导入包含 manifest.json 的文件夹，切换模板并导出。已保存兼容轨道可独立播放；输入日志重建要求其 engineBuild 被当前宿主明确支持。

## 输出与保留

每个批次包含 batch.json、rankings.json、matches、exports 和 failures。基础比赛保存内容、输入、事件、导演记录、hash 和分析；入选比赛另外保存轨道与真正完整检查点。manifest 最后提交，各 role 按压缩后文件字节进行 SHA-256 校验。

每条视频保存 render-job.json、frame-index.json、audio-plan.json、audio.wav、encoding.json、verification.json、export-performance.json、四张 samples 图片及 video.mp4。仅在编码、ffprobe、完整解码和源文件验证通过后标记 complete。keepFrames=false 在验证后清理该任务编号 PNG；保留帧索引、音频和成片，清理中断可恢复。

artifacts/dist/.tools/.cache 不提交 Git。备份成片时同时备份其批次、选中比赛包和导出目录，单独保存 MP4 会失去重新制作和版本溯源信息。Git 提交源码、冻结清单、资产、小型报告和 evidence；远程源码仓库不含本机大型视频。

## 内容修改

正式内容入口为 `content/fighter-phase3b.json`。characters 的 stats.maxHp 是血量；每个角色 slots 指向 abilities；技能包含 startup/active/recovery、cooldown、energyCost、timeline 等已定义字段。能量获得的规则还包含 sim 的战斗结算，调整大招充能要先定位对应来源，不能只改视频显示值。

按本次约定，招式、血量和大招充能平衡放在 Phase 5 后进行。本阶段正式配置保持原值。未来调整使用新内容版本和新 hash；规则时序或能量结算变化增加 rules/build 版本，AI 变化增加 aiVersion。保留旧内容与旧构建，冻结 seed 清单不被替换；修改后重跑受影响的场景、200 配置/800 基线、导演对照和生产验收。

独立模拟支持 `simulate --content FILE` 验证新内容；正式批量入口目前编译冻结的 Phase 3B 内容。若要把平衡实验投入正式批量，需一起实现并记录新的构建/内容选择，而非在旧目录里改 JSON 后覆盖旧比赛。已有回放播放其嵌入内容，不使用新文件重算。

## 故障定位与恢复

先读 batch.json 对应任务状态与 failures 列表，再读 diagnosticPath。保留原 matchId、seed、配置和版本。模拟失败只重试原配置一次，再次失败止于两次；修好错误后建立明确的后续诊断，不能更换 seed 隐藏失败。

| 现象/错误 | 处理 |
|---|---|
| 任务锁仍有活进程 | 等当前任务结束或在工作台取消；不要并行覆盖同一批次 |
| 进程异常结束后的旧锁 | `--resume` 核对 PID/token 后恢复；损坏锁拒绝并报告，先检查记录 |
| TOOLCHAIN_HASH_MISMATCH / CHROMIUM_VERSION_MISMATCH | 按锁定安装脚本准备工具；检查字体、音效、编码器版本 |
| INSUFFICIENT_EXPORT_DISK_SPACE | 根据 disk-budget.json 提供足够空间，再恢复 |
| gzip/schema/文件 hash/输入 worldHash 错误 | 保存损坏文件用于诊断；从原备份恢复匹配文件，不能更新 hash 让错误通过 |
| 截图中断或 PNG 损坏 | 同配置 `--resume`；从第一张缺失/坏帧重建，复用此前有效帧 |
| 编码中断 | 有效 PNG 保留；部分 candidate.mp4 不当成成片，重新编码 |
| 验证中断 | 对 candidate/hash/编码记录重新验证；有效编码可复用，通过后改名 |
| 已完成视频或音频/索引被改动 | verify 明确失败；恢复匹配备份后再验证 |

CLI 成功为 0，生产任务失败/取消为 2，参数或宿主异常为 1。工作台任务错误显示在失败记录中。独立 simulate 的参数/invalid 退出约定见 README。完整恢复演练命令为 `npm.cmd run test:phase5-recovery`，会在新目录注入真实失败，不修改正式成片。

## 验证与观看

```powershell
npm.cmd run verify:phase5
npm.cmd run review:selection
# http://127.0.0.1:5178/，30场/15对隐藏分数组别
npm.cmd run review:final-style
# http://127.0.0.1:5179/，40场等信息预算角色风格
npm.cmd run review:pacing
# http://127.0.0.1:5176/，20对off/pace
```

下载观感表后保留观看者、样本范围、偏好和备注。private-key.json 不由观看服务器提供；在完成判断前不要读取分组钥匙。自动浏览器测试导出的表带 AUTOMATED 标记，不是人工评级。项目负责人的阶段反馈已记录为“感觉挺好的”，并保留未看完全片的范围限制。

自动工程通过与内容评审完成分别记录。仍待人工完整观看、隐藏标签偏好及风格/节奏判断；已有空挥、AI CPU 比例和导演效果差距见 Phase 5 报告，不能将胜率或 TypeScript 测试通过解释为全部内容验收。
