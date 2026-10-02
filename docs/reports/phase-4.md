# Phase 4 · 完整回放与视频生产

日期：2026-10-03。分支 `codex/phase-4`，基于 Phase 3B 文档提交 `564be9dce554931c1d924b5a6b074fca8a5e25d3`。实现提交 `eb60d8faf0ff117548a3e8d6a567e3b40c93018a`；文件 hash 见 [phase-4-evidence.json](./phase-4-evidence.json)。P4-01～P4-10 完成，G4 工程出口通过，累计 **49/54**。

30 场正式比赛完成模拟、分析和多样性筛选，生成三组不同对阵的正式视频。每条均为 **1080×1920、60 FPS、H.264/yuv420p、AAC 48 kHz 双声道**，通过逐帧编号与 hash 检查、ffprobe 帧数/音轨/时长校验以及完整解码。成片采用原始战斗轨道，生产默认导演 **off**。

## 打开制作工作台

```powershell
. .\scripts\use-node.ps1
npm.cmd run build
npm.cmd run studio
# http://127.0.0.1:5177/production.html
```

工作台显示批次、评分、入选/排除原因、失败记录和逐帧进度，可发起批量模拟、筛选、导出、取消和恢复。独立回放页支持目录导入、原始配置显示、四分之一 tick 定位、播放、交锋/事件跳转、评分分项与反射近似证据，以及同轨道切换深/浅模板和本地导出。主竞技场仍可用 `npm run dev` 启动。

首次安装编码环境：在启用锁定 Node 后运行 `powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-export.ps1`。FFmpeg/ffprobe 为 SHA-256 校验过的便携版，不依赖系统 PATH；Noto Sans SC/OFL 和五份项目原创 WAV 随源码保存。具体版本、下载源与许可见 [export-toolchain.json](../../content/export-toolchain.json)、[audio-assets.json](../../content/audio-assets.json)。

## 命令与产物

```powershell
# 新目录自动创建；已有批次使用 --resume
npm.cmd run produce -- --config production.example.json --resume
# 分阶段执行
npm.cmd run batch -- --config production.example.json --resume
npm.cmd run rank -- --config production.example.json --resume
npm.cmd run render -- --config production.example.json --resume
npm.cmd run verify -- --config production.example.json --resume
# 完整本阶段验收
npm.cmd run verify:phase4
```

任务路径和全部参数由严格 JSON 配置冻结。外部进程以参数数组启动；正式产物位于 `artifacts/phase-4/正式视频 production v1/`，已实际验证中文与空格路径。大型轨道、PNG、MP4 和原始报告不提交 Git；源码、资产、复现命令和小型证据清单提交。

| 对阵 | Seed | 评分 | 战斗 ticks | 视频帧数 | 成片时长 | 视频 |
|---|---:|---:|---:|---:|---:|---|
| 标准 × 镜子 | 367399065 | 72.9784 | 2155 | 2312 | 38.5333 秒 | [video.mp4](../../artifacts/phase-4/正式视频%20production%20v1/exports/export-4f409b4991453addbea2/video.mp4) |
| 橡胶 × 铁球 | 3487474872 | 69.3020 | 1741 | 1898 | 31.6333 秒 | [video.mp4](../../artifacts/phase-4/正式视频%20production%20v1/exports/export-02e4db76f640a6d67ac7/video.mp4) |
| 铁球 × 镜子 | 506281477 | 48.7969 | 1214 | 1371 | 22.8500 秒 | [video.mp4](../../artifacts/phase-4/正式视频%20production%20v1/exports/export-d7bb3bb824d509c4e9cd/video.mp4) |

视频是 60 帧片头、S[0]～S[T] 共 T+1 帧完整战斗、6 帧 KO hold、90 帧片尾，因此总帧数为 T+157。事件 tick t 在跨过 S[t+1] 时触发一次音效；hold 保持 S[T]，不推进模拟、不重复音效。时长容差为一帧；AAC 编码目标为 192 kbit/s，静音较多时实际码率更低。

## 验收证据

| 验证 | 实际结果 |
|---|---|
| 类型/构建/单元测试 | 两端类型与生产构建通过；324 项测试通过，包含原 277 项和本阶段 47 项 |
| 依赖边界 | 87 个源文件、5 个反向依赖负例通过；replay/render 不导入 AI、物理、导演或宿主 I/O |
| worker 一致性 | 10 组对阵×2，共 20 配置，workers=1/4 的输入、事件、world/runner hash、结果、manifest 与排名完全一致 |
| 模拟失败 | 真实 worker exit 17；原 matchId/seed/config 一次重试，与对照包相同；连续失败止于两次并保留诊断 |
| 取消/锁 | 未完成模拟回到 pending；恢复原任务列表；Windows 实测活锁拒绝、死进程锁恢复、损坏锁拒绝 |
| 包与版本 | 缺/损文件、gzip 截断、未知 schema、ID/tick/hash 错误拒绝；嵌入原内容；空可选检查点不接受 |
| 三模式封装 | off/observe/pace 的 director 记录分别 0/6/11 条，完整检查点分别 9/9/18 个；off 为 null，启用模式保存真实导演状态 |
| 检查点实际续跑 | 从序列化生产包恢复 33 次，26,230 条后续输入和 450 次 world/runner 检查点比较一致 |
| 媒体恢复 | 轨道重建、25 张截图后、真实编码子进程中、验证阶段分别中断并恢复；损坏首 PNG 从首个坏帧重建；有效 PNG 和编码复用 |
| 输入重建 | 纯输入校验原事件与每个 world 检查点；生成完整检查点时另跑 Controller/Director，核对全输入与 runner hash |
| 页面 | 创建/取消/恢复、任务表与原因、交锋跳转、任意定位像素一致、两模板、移动端无溢出；未知 engineBuild 的已保存轨道实际播放并导出成功 |
| 音效/清理 | 五份波形与 hash 核对，固定增益无 clipping；只在媒体验证后清理编号 PNG；删除中断及 index/清理记录提交间隙可恢复 |
| 正式视频 | 三条文件、共 5,581 帧的逐文件检查、完整解码及 12 张片头/中段/KO/片尾图片检查通过 |
| 旧工程回归 | 原 Phase 0 确定性、浏览器 Node 对照和 Phase 3B 三模式回放/trace/盲评入口通过；五份冻结种子清单不变 |

原始验证分别在 `artifacts/phase-4/{unit-tests,boundaries,correctness,checkpoints,recovery,cleanup,browser,analysis-recheck}.json`。证据清单保存每个选中包的所有文件、MP4、源帧索引、音频和抽帧 hash。正式批次最初遇到三次抽帧过滤表达式错误，已修复并保留历史诊断；恢复成功，三任务当前均为 complete。预验收 worker 曾误写非入选轨道/空检查点，修正为显式六个基础 role；预验收包修正记录保留，最终 30 场分析复核无变化。

## 约束与后续

本阶段未改变战斗参数、AI 规则、实时导演或五份冻结清单。版本保持 `phase3b-v1 / utility-v3`，rulesHash/contentHash 与 Phase 3B 相同。新增包 schema 3、presentation 1、interesting-v1、canvas-video-v1；实现细则见 [D0008](../decisions.md)。

后续修正：Phase 5 对所有实际音效帧做更严格核对，发现 canvas-video-v1 的浮点映射在部分长度下可能延后一帧。当前新导出使用 canvas-video-v2 修复精确边界；旧 v1 文件与读取语义保留追溯。上述 Phase 4 检查结果是当时覆盖范围，不能据此声称旧版全部 cue 精确对齐；最终十条 v2 视频见 Phase 5 报告。

反射采用碰撞附近的保存状态与入射速度作最多 30 tick 的直线相对扫掠，记录参数；缺少前接触状态则不计有效反射。墙弹追击按真实伤害来源处理反射后的归属。大招必须产生已验证的伤害、防御、位置改善或增益收益；微小伤害不能独立创建交锋。同分按 matchId，多样性与短缺原因明确保存。

12 张图片经过模型视觉检查，未观察到中文缺字、重要文字越界或结果错位；全部媒体完整解码通过。尚未收集人工全片观看、音效喜好和 InterestingScore 与人工偏好的相关性。Phase 3B 冷场 p90 改善仅 2.61%，效果目标与 H2/风格/节奏观感仍待评，默认 off。完整性能 benchmark、留出指标校准和至少十条最终成片属于 Phase 5；下一步为 P5-01。
