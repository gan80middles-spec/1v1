# 1v1 自动对抗短视频内容引擎

Phase 3B 已完成，G3 工程验收通过：四角色 16 槽加入实时节奏导演、同 seed 开关对照、提示时间线与完整恢复。277 项测试、400 次正式对照、54 次导演检查点恢复和浏览器检查通过。冷场 p90 仅缩短约 2.6%，未达到 20% 目标；默认保持导演 off，20 对回放观感仍待人工评审。

路线：[开发执行计划](./开发执行计划.md)。规则：[实施规格](./1v1自动对抗短视频内容引擎_GPT6_Sol实施规格_v1.0.md)。验收：[Phase 3B](./docs/reports/phase-3b.md)、[Phase 3 汇总](./docs/reports/phase-3.md)、[Phase 3A](./docs/reports/phase-3a.md)、[Phase 2](./docs/reports/phase-2.md)、[Phase 1](./docs/reports/phase-1.md)、[Phase 0](./docs/reports/phase-0.md)。正式视频生产留在 Phase 4。

## 在 Cursor / PowerShell 中启动

在 `E:\1-1` 打开终端：

```powershell
. .\scripts\use-node.ps1
npm.cmd run dev
```

打开 [竞技场](http://127.0.0.1:5173/)。默认双方为 Utility AI；选择角色、人格和 seed，点“重置比赛”，再点“开始”。支持暂停、单步、倍速、碰撞层、运行到结束、保存/导入回放。

“决策回看”展示所有候选的合法性、D/L/P/K/X/C/E/R/B、脱困/撞墙分、切换门槛、随机池、威胁和出招结果。比赛结束后拖动决策进度可跳到当时的画面。“估计位置”叠加 AI 的 Belief；真实画面不传给 AI。trace 和输入回放分别保存，导入同场回放后可导入其 trace。

四角色和均衡、压迫、反制、闪避人格均可选；切换角色会选用它的默认人格。可关闭感知误差、近优随机或短期记忆；Rush/Ranged 基线具备四槽，并与 Utility 使用同样的延迟 Observation。旧 [Phase 1 页面](http://127.0.0.1:5173/?build=phase1-v1)、[Phase 2 页面](http://127.0.0.1:5173/?build=phase2-v1) 使用 standard/rubber；[Phase 0 页面](http://127.0.0.1:5173/phase0.html) 继续可用。端口被占用时以 Vite 打印的地址为准。

“实时导演”选择 off（关闭）、observe（只记录提示）或 pace（有界加分/减分）。切换模式立即重置并生成新 runId；observe 与 off 的逐 tick 输入一致。展开导演时间线可跳到发出/淡出/结束，查看公共证据、强度、Ubase、原始/实际 DirectorDelta 和叠加上限。“同 seed 对照”生成 off/pace 两局，可以分别回看。旧 [Phase 3A 页面](http://127.0.0.1:5173/?build=phase3a-v1) 保留冻结构建并关闭导演。

## 首次安装

项目锁定 Node 24.21.0 / npm 11.19.0，系统 Node 不会被修改：

```powershell
# 已有 .tools 对应版本时跳过第一行
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-node.ps1
. .\scripts\use-node.ps1
npm.cmd ci
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.cache\ms-playwright'
npx.cmd playwright install chromium
```

依赖由 package-lock.json 锁定；环境记录见 [toolchain-lock.json](./toolchain-lock.json)。新机器首次安装需要网络；FFmpeg/中文导出字体在视频阶段单独准备。

## Node 模拟、trace、检查点和输入重放

```powershell
. .\scripts\use-node.ps1
npm.cmd run build
npm.cmd run simulate -- --ai utility --a iron --b mirror --seed 17 --pacing pace --trace artifacts\phase-3b\trace.json --output artifacts\phase-3b\match.json
npm.cmd run simulate -- --replay artifacts\phase-3b\match.json

# 完整检查点包含控制器/RNG、观察 ring、回执、执行/记忆、导演全部未来状态和输入历史
npm.cmd run simulate -- --ai utility --a iron --b mirror --seed 17 --pacing pace --checkpoint-at 240 --checkpoint artifacts\phase-3b\checkpoint.json --output artifacts\phase-3b\original.json
npm.cmd run simulate -- --resume artifacts\phase-3b\checkpoint.json --output artifacts\phase-3b\resumed.json

# 人格、诊断和公平脚本对手
npm.cmd run simulate -- --ai utility --a rubber --b rubber --profile-a counter --profile-b pressure --no-noise --eval --no-memory
npm.cmd run simulate -- --ai utility --a standard --b standard --controller-b rush

# 保留旧构建和 Phase 0 原 hash
npm.cmd run simulate -- --ai utility --build phase3a-v1 --a iron --b mirror --seed 17 --pacing off
npm.cmd run simulate -- --ai utility --build phase2-v1 --a standard --b rubber --seed 17
npm.cmd run simulate -- --a standard --b rubber --seed 17
npm.cmd run simulate -- --seed 17 --ticks 600 --record-states

# 600 tick 零重力隔离夹具：固定非平行初速、关闭跳跃，标准空中技能仍执行
npm.cmd run simulate -- --ai utility --a standard --b standard --seed 17 --ruleset free-bounce-fixture --output artifacts\phase-3a\free-bounce.json
```

`--ai utility` 默认启用 phase3b-v1、utility-v3 和 `--pacing off`；控制器支持 utility/rush/ranged/idle，角色支持 standard/rubber/iron/mirror。`--pacing observe` 只计算提示，`--pacing pace` 接入评分。旧构建只允许 off。`--profile-a`/`--profile-b` 为 balanced/pressure/counter/evasive。`--no-noise` 关闭误差，`--eval` 固定选择最高分，`--no-memory` 关闭习惯适应；它们保留正常反应延迟。`--no-prediction` 和 `--no-hysteresis` 是诊断开关。感知延迟消融仅在评测命令中执行，并明确标记信息预算改变。FreeBounceFixture 是内部模式隔离测试，不出现在正式模式选择中。

默认时间上限 3600 tick。seed 为 uint32，`--ticks` 为 1～3600。`--content FILE` 指定内容，`--help` 查看参数。Phase 3B 默认输出 `artifacts/phase-3b/replays/`，同时保存 `.json.director.ndjson.gz` sidecar；回放也嵌入导演记录，trace 独立保存。不指定 AI 且使用旧角色时保留 Phase 1 默认脚本，未指定角色使用 Phase 0 夹具。

输入回放只执行保存的输入，核对构建、完整内容/插件版本、事件、60 tick 检查点、结果和 worldHash，不重新运行导演。完整检查点用于 AI 重新决策续跑，另核对包含导演状态的 runnerHash。resume 沿用保存的模式；显式改成不同模式会报错，修改模式请新开比赛。旧支持版本回放缺失 pacing 时明确迁移为 off。CLI 检查点同时保存此前输入历史；纯运行状态快照不冒充完整输入回放。

成功退出码 0；参数错误和 invalid 比赛为 2。invalid 会保存 `.failure.json`。有限效果不会被静默丢弃；边界预算会诊断并停止该 substep 的剩余位移。

## 完整验证、基线与观感观看

```powershell
. .\scripts\use-node.ps1
npm.cmd run verify:phase3a

# Phase 3B 全套：400 次对照、重放/恢复、浏览器和运行开销
npm.cmd run verify:phase3b
# 单独重做对照与 20 对观看包，先 build
npm.cmd run evaluate:pacing
npm.cmd run review:pacing
# http://127.0.0.1:5176/

# 单独重做完整 800 场与四项消融；先 build
npm.cmd run evaluate:ai -- --manifest fixtures\seeds\ai-baseline-v1.json --ablations

# 验证已生成观看包后，另开终端
npm.cmd run review:style
# 保留 Phase 2 的 20 场 H2 包：npm.cmd run review:h2
```

[四角色观感入口](http://127.0.0.1:5175/) 播放 40 场隐藏人格的缓存轨迹：pressure/counter 各 20 场，每角色每人格 5 场；双方比较使用相同反应水平，关注 A 方并填写观感表，可下载结果。独立播放器只读表现帧，服务不提供 private-key.json，评分按观看包版本隔离。旧 [H2 入口](http://127.0.0.1:5174/) 保留 20 场两角色包。两者的人工结论仍待评。

`verify:phase3b` 执行类型、277 项测试、构建、63 文件边界/5 负例、冻结清单检查、200 配置×off/pace 共 400 次正式执行及 20 对盲评包，再验证 400 次纯输入重放、200 次 pace 逐 tick 状态重放、200 次 off/observe 输入一致、200 次 pace 重复与日志开关一致、54 次实际提示前/平台/淡出恢复、944 次 runnerHash 对照，以及独立 CLI、浏览器模式/trace/对照/移动端/盲评和 270 场计时。所有计数分别报告，验证重跑不扩大正式样本。

`verify:phase3a` 保留原来的 200 配置双跑/输入重放、30 个检查点、800 场基线、384 次消融、40 场风格包和旧浏览器回归；当前通用测试包含新增 Phase 3B 场景。原 192 项/58 文件是 Phase 3A 冻结时的计数。本次还用原始 800 场记录验证旧构建输入、事件、回放与 runnerHash 完全保留；复查入口为 `node scripts/verify-phase3b-legacy.mjs`，需要原 Phase 3A artifacts。完整命令包含长评测，局部检查可以运行对应脚本。

[导演盲评入口](http://127.0.0.1:5176/) 提供 20 对、40 个隐藏模式片段，训练/留出各 10 对，每种对阵各 2 对。X/Y 顺序固定随机，可记录偏好并下载结果；服务不提供 private-key.json。人工偏好仍待填写。Phase 3B 原始数据在 `artifacts/phase-3b/`，摘要与文件树 hash 见 [phase-3b-evidence.json](./docs/reports/phase-3b-evidence.json)。同配置双 Utility 对照的空挥率为 66.92%→67.01%，与旧 Utility 对脚本基线的 53.30% 使用不同样本和对手，不能混作同一实验。

完整产物在 `artifacts/phase-3a/`，可追溯快照见 [phase-3a-evidence.json](./docs/reports/phase-3a-evidence.json)。800 场未筛选镜像对战包含训练/留出各 400 场，胜率 99.375%（795 胜、5 负、0 平、0 invalid）；普通攻击空挥率仍未达标，大招使用不足和记忆收益未证实也已记录。回放和 trace 案例在 `artifacts/phase-3a/examples/`，包含全部 5 场失利、实际反射和基线巨人案例，可在竞技场导入。全量压缩输入记录位于 correctness/records、evaluation/records；CLI/网页导入使用未压缩 JSON，examples 脚本已为代表场次生成它们。大型记录不提交 Git，可通过完整验证命令重建。

## 模块和确定性边界

contracts 定义严格数据契约；content 编译声明式技能；math 提供几何/hash/RNG；sim 执行权威战斗；ai 只读 Observation 和公开内容；director 只消费成熟公共快照；runner 组装双方同时决策与检查点；analysis 提取评测指标；replay/render 只读表现帧；cli/web 负责宿主 I/O。

`content/fighter-phase3a.json` 增加铁球/镜子、状态和两个专用插件，其余两角色及人格数值保持原配置。内容版本、插件、构建、AI 和 rulesHash 一起冻结；共享效果数学用于模拟与预测，见 [D0006](./docs/decisions.md)。旧 phase1/phase2 内容及 Phase 0 夹具保留，回放按保存构建执行。

`content/fighter-phase3b.json` 保留相同战斗数值，增加版本化 gentle-v1 配置。导演不读取敌方真实冷却、AI 内部状态或未来事件，不消耗战斗随机数，也不更改物理；成熟延迟取双方反应延迟最大值+1。分数修正、公共归因、包络和恢复决策见 [D0007](./docs/decisions.md)。生产默认 off；pace 效果仍需校准和人工判断。

确定性保证限定同构建、固定 Node/V8、相同内容与输入。当前 Chromium/Node 对照通过；不承诺所有 CPU/浏览器位级一致。
