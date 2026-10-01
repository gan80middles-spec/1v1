# 1v1 自动对抗短视频内容引擎

Phase 2 已实现两角色 Utility AI：延迟感知、联合动作、短时预测、收益/风险评分、动作承诺、短期记忆、脱困、人格和逐决策回看。G2 工程验收通过，H2 观感检查待人工判断。普通攻击空挥率的初评仍高于目标，不能视为生产配置已定型。

路线：[开发执行计划](./开发执行计划.md)。规则：[实施规格](./1v1自动对抗短视频内容引擎_GPT6_Sol实施规格_v1.0.md)。验收：[Phase 2](./docs/reports/phase-2.md)、[Phase 1](./docs/reports/phase-1.md)、[Phase 0](./docs/reports/phase-0.md)。导演、铁球/镜子、正式视频导出在后续阶段实现。

## 在 Cursor / PowerShell 中启动

在 `E:\1-1` 打开终端：

```powershell
. .\scripts\use-node.ps1
npm.cmd run dev
```

打开 [竞技场](http://127.0.0.1:5173/)。默认双方为 Utility AI；选择角色、人格和 seed，点“重置比赛”，再点“开始”。支持暂停、单步、倍速、碰撞层、运行到结束、保存/导入回放。

“决策回看”展示所有候选的合法性、D/L/P/K/X/C/E/R/B、脱困/撞墙分、切换门槛、随机池、威胁和出招结果。比赛结束后拖动决策进度可跳到当时的画面。“估计位置”叠加 AI 的 Belief；真实画面不传给 AI。trace 和输入回放分别保存，导入同场回放后可导入其 trace。

均衡、压迫、反制和闪避人格均可选；可关闭感知误差、近优随机或短期记忆。选择双方脚本打法 rush/ranged/idle 会使用保留的 Phase 1 构建。旧 [Phase 0 页面](http://127.0.0.1:5173/phase0.html) 继续可用。端口被占用时以 Vite 实际打印的地址为准。

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
npm.cmd run simulate -- --ai utility --a standard --b rubber --seed 17 --trace artifacts\phase-2\trace.json --output artifacts\phase-2\match.json
npm.cmd run simulate -- --replay artifacts\phase-2\match.json

# 完整检查点包含控制器/RNG、观察 ring、待送达回执、执行/记忆和输入历史
npm.cmd run simulate -- --ai utility --seed 17 --checkpoint-at 240 --checkpoint artifacts\phase-2\checkpoint.json --output artifacts\phase-2\original.json
npm.cmd run simulate -- --resume artifacts\phase-2\checkpoint.json --output artifacts\phase-2\resumed.json

# 人格、诊断和公平脚本对手
npm.cmd run simulate -- --ai utility --a rubber --b rubber --profile-a counter --profile-b pressure --no-noise --eval --no-memory
npm.cmd run simulate -- --ai utility --a standard --b standard --controller-b rush

# 保留旧构建和 Phase 0 原 hash
npm.cmd run simulate -- --a standard --b rubber --seed 17
npm.cmd run simulate -- --seed 17 --ticks 600 --record-states
```

`--ai utility` 启用 Phase 2；控制器支持 utility/rush/ranged/idle，角色支持 standard/rubber。`--profile-a`/`--profile-b` 为 balanced/pressure/counter/evasive。`--no-noise` 关闭误差，`--eval` 固定选择最高分，`--no-memory` 关闭习惯适应；它们不关闭正常反应延迟。几何测试使用显式 delay=0 的诊断 profile。

默认时间上限 3600 tick。seed 为 uint32，`--ticks` 为 1～3600。`--content FILE` 指定内容，`--help` 查看参数。Phase 2 默认输出 `artifacts/phase-2/replays/`；没有 `--ai` 且指定角色时保留 Phase 1 默认脚本，未指定角色使用 Phase 0 夹具。

输入回放只执行保存的输入，核对构建、完整内容/插件版本、事件、60 tick 检查点、结果和 worldHash。完整检查点用于 AI 重新决策续跑，另核对 runnerHash。CLI 检查点同时保存此前输入历史；纯运行状态快照不冒充完整输入回放。

成功退出码 0；参数错误和 invalid 比赛为 2。invalid 会保存 `.failure.json`。有限效果不会被静默丢弃；边界预算会诊断并停止该 substep 的剩余位移。

## 验证和 H2 观看

```powershell
. .\scripts\use-node.ps1
npm.cmd run verify:phase2

# 验证已生成观看包后，另开终端
npm.cmd run review:h2
```

[H2 盲评入口](http://127.0.0.1:5174/) 播放 20 场隐藏人格的缓存轨迹：pressure/counter 各 10 场，其中标准/橡胶各 5 场；两组采用相同反应延迟、决策间隔和误差。关注 A 方并填写观感表，可下载结果。独立播放器不运行 AI/物理，服务不提供 private-key.json。开发服务器也可打开 [H2 页面](http://127.0.0.1:5173/h2.html)。

`verify:phase2` 检查 Node/Web 类型、113 项测试、构建和模块边界；保留 Phase 0 原 hash 和 Phase 1 的 30 配置回归；Phase 2 的 30 配置各双跑，比较逐 tick worldHash、60 tick runnerHash、输入重放和 trace 开关；检查 120/240/实际终局前一 tick 的续跑和独立 CLI 进程；运行 80 场两角色基线初评、20 场 H2 观看包，并用 Chromium 验证界面、trace/回放导入导出和 Node/Web 一致性。

完整产物在 `artifacts/phase-2/`，小型可追溯快照见 [phase-2-evidence.json](./docs/reports/phase-2-evidence.json)。基线是冻结 800 场清单的两角色初评子集，训练/留出各 40 场；完整四角色 800 场评测、消融、worker 和生产视频按后续阶段交付。H2 待评，测试通过不代替观感判断。

## 模块和确定性边界

contracts 定义严格数据契约；content 编译声明式技能；math 提供几何/hash/RNG；sim 执行权威战斗；ai 只读 Observation 和公开内容；runner 组装双方同时决策与检查点；analysis 提取初评指标；replay/render 只读表现帧；cli/web 负责宿主 I/O。

`content/fighter-phase2.json` 增加人格，战斗数值沿用 Phase 1。旧 `fighter-phase1.json` 和 Phase 0 夹具保留。Phase 2 修复出招方向锁、防御归因和地面支撑碰撞；以独立 rulesHash/build 保护旧回放，见 [D0005](./docs/decisions.md)。

确定性保证限定同构建、固定 Node/V8、相同内容与输入。当前 Chromium/Node 对照通过；不承诺所有 CPU/浏览器位级一致。
