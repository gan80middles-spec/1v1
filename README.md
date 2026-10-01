# 1v1 自动对抗短视频内容引擎

Phase 3A 已完成：标准、橡胶、铁球、镜子四角色共 16 个技能槽，包含冲撞速度增伤、巨人变形、几何反射和完整检查点恢复。G3A 工程验收通过；192 项测试、200 配置双跑及输入重放、800 场公平基线、四项消融和浏览器检查已完成。普通攻击空挥率 53.30%，高于 45% 目标；H2 和四角色观感仍待人工判断。

路线：[开发执行计划](./开发执行计划.md)。规则：[实施规格](./1v1自动对抗短视频内容引擎_GPT6_Sol实施规格_v1.0.md)。验收：[Phase 3A](./docs/reports/phase-3a.md)、[Phase 2](./docs/reports/phase-2.md)、[Phase 1](./docs/reports/phase-1.md)、[Phase 0](./docs/reports/phase-0.md)。本阶段导演为 off；实时导演在 Phase 3B、正式视频生产在 Phase 4 实现。

## 在 Cursor / PowerShell 中启动

在 `E:\1-1` 打开终端：

```powershell
. .\scripts\use-node.ps1
npm.cmd run dev
```

打开 [竞技场](http://127.0.0.1:5173/)。默认双方为 Utility AI；选择角色、人格和 seed，点“重置比赛”，再点“开始”。支持暂停、单步、倍速、碰撞层、运行到结束、保存/导入回放。

“决策回看”展示所有候选的合法性、D/L/P/K/X/C/E/R/B、脱困/撞墙分、切换门槛、随机池、威胁和出招结果。比赛结束后拖动决策进度可跳到当时的画面。“估计位置”叠加 AI 的 Belief；真实画面不传给 AI。trace 和输入回放分别保存，导入同场回放后可导入其 trace。

四角色和均衡、压迫、反制、闪避人格均可选；切换角色会选用它的默认人格。可关闭感知误差、近优随机或短期记忆；Rush/Ranged 基线具备四槽，并与 Utility 使用同样的延迟 Observation。旧 [Phase 1 页面](http://127.0.0.1:5173/?build=phase1-v1)、[Phase 2 页面](http://127.0.0.1:5173/?build=phase2-v1) 使用 standard/rubber；[Phase 0 页面](http://127.0.0.1:5173/phase0.html) 继续可用。端口被占用时以 Vite 打印的地址为准。

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
npm.cmd run simulate -- --ai utility --a iron --b mirror --seed 17 --pacing off --trace artifacts\phase-3a\trace.json --output artifacts\phase-3a\match.json
npm.cmd run simulate -- --replay artifacts\phase-3a\match.json

# 完整检查点包含控制器/RNG、观察 ring、待送达回执、执行/记忆和输入历史
npm.cmd run simulate -- --ai utility --a iron --b mirror --seed 17 --checkpoint-at 240 --checkpoint artifacts\phase-3a\checkpoint.json --output artifacts\phase-3a\original.json
npm.cmd run simulate -- --resume artifacts\phase-3a\checkpoint.json --output artifacts\phase-3a\resumed.json

# 人格、诊断和公平脚本对手
npm.cmd run simulate -- --ai utility --a rubber --b rubber --profile-a counter --profile-b pressure --no-noise --eval --no-memory
npm.cmd run simulate -- --ai utility --a standard --b standard --controller-b rush

# 保留旧构建和 Phase 0 原 hash
npm.cmd run simulate -- --ai utility --build phase2-v1 --a standard --b rubber --seed 17
npm.cmd run simulate -- --a standard --b rubber --seed 17
npm.cmd run simulate -- --seed 17 --ticks 600 --record-states

# 600 tick 零重力隔离夹具：固定非平行初速、关闭跳跃，标准空中技能仍执行
npm.cmd run simulate -- --ai utility --a standard --b standard --seed 17 --ruleset free-bounce-fixture --output artifacts\phase-3a\free-bounce.json
```

`--ai utility` 默认启用 phase3a-v1；控制器支持 utility/rush/ranged/idle，角色支持 standard/rubber/iron/mirror。`--profile-a`/`--profile-b` 为 balanced/pressure/counter/evasive。`--no-noise` 关闭误差，`--eval` 固定选择最高分，`--no-memory` 关闭习惯适应；它们保留正常反应延迟。`--no-prediction` 和 `--no-hysteresis` 是诊断开关。感知延迟消融仅在评测命令中执行，并明确标记信息预算改变。FreeBounceFixture 是内部模式隔离测试，不出现在正式模式选择中。

默认时间上限 3600 tick。seed 为 uint32，`--ticks` 为 1～3600。`--content FILE` 指定内容，`--help` 查看参数。Phase 3A 默认输出 `artifacts/phase-3a/replays/`；不指定 AI 且使用旧角色时保留 Phase 1 默认脚本，未指定角色使用 Phase 0 夹具。

输入回放只执行保存的输入，核对构建、完整内容/插件版本、事件、60 tick 检查点、结果和 worldHash。完整检查点用于 AI 重新决策续跑，另核对 runnerHash。CLI 检查点同时保存此前输入历史；纯运行状态快照不冒充完整输入回放。

成功退出码 0；参数错误和 invalid 比赛为 2。invalid 会保存 `.failure.json`。有限效果不会被静默丢弃；边界预算会诊断并停止该 substep 的剩余位移。

## 完整验证、基线与观感观看

```powershell
. .\scripts\use-node.ps1
npm.cmd run verify:phase3a

# 单独重做完整 800 场与四项消融；先 build
npm.cmd run evaluate:ai -- --manifest fixtures\seeds\ai-baseline-v1.json --ablations

# 验证已生成观看包后，另开终端
npm.cmd run review:style
# 保留 Phase 2 的 20 场 H2 包：npm.cmd run review:h2
```

[四角色观感入口](http://127.0.0.1:5175/) 播放 40 场隐藏人格的缓存轨迹：pressure/counter 各 20 场，每角色每人格 5 场；双方比较使用相同反应水平，关注 A 方并填写观感表，可下载结果。独立播放器只读表现帧，服务不提供 private-key.json，评分按观看包版本隔离。旧 [H2 入口](http://127.0.0.1:5174/) 保留 20 场两角色包。两者的人工结论仍待评。

`verify:phase3a` 依次执行类型、192 项测试、构建、58 文件边界/5 负例、冻结清单检查，以及 Phase 0/1/2 的 Node/浏览器回归。通用 Utility 场景分别使用 Phase 2 与 Phase 3A 构建执行。Phase 3A 完整执行 200 配置×2 次重复、200 次纯输入重放、30 个指定 tick 检查点恢复、独立 CLI 与零重力夹具；之后执行 800 场基线、固定 96 配置的四项消融（384 次额外执行）、40 场匿名观感包和四角色浏览器一致性验证。该命令包含完整长评测；局部检查可运行对应脚本。

完整产物在 `artifacts/phase-3a/`，可追溯快照见 [phase-3a-evidence.json](./docs/reports/phase-3a-evidence.json)。800 场未筛选镜像对战包含训练/留出各 400 场，胜率 99.375%（795 胜、5 负、0 平、0 invalid）；普通攻击空挥率仍未达标，大招使用不足和记忆收益未证实也已记录。回放和 trace 案例在 `artifacts/phase-3a/examples/`，包含全部 5 场失利、实际反射和基线巨人案例，可在竞技场导入。全量压缩输入记录位于 correctness/records、evaluation/records；CLI/网页导入使用未压缩 JSON，examples 脚本已为代表场次生成它们。大型记录不提交 Git，可通过完整验证命令重建。

## 模块和确定性边界

contracts 定义严格数据契约；content 编译声明式技能；math 提供几何/hash/RNG；sim 执行权威战斗；ai 只读 Observation 和公开内容；runner 组装双方同时决策与检查点；analysis 提取初评指标；replay/render 只读表现帧；cli/web 负责宿主 I/O。

`content/fighter-phase3a.json` 增加铁球/镜子、状态和两个专用插件，其余两角色及人格数值保持原配置。内容版本、插件、构建、AI 和 rulesHash 一起冻结；共享效果数学用于模拟与预测，见 [D0006](./docs/decisions.md)。旧 phase1/phase2 内容及 Phase 0 夹具保留，回放按保存构建执行。

确定性保证限定同构建、固定 Node/V8、相同内容与输入。当前 Chromium/Node 对照通过；不承诺所有 CPU/浏览器位级一致。
