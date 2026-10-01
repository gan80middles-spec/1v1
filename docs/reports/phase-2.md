# Phase 2 · Utility AI 验收报告

日期：2026-10-02。分支：`codex/phase-2`，从 Phase 1 的 `6a2b32bcc7c2803ee1086fc3d05b606637665944` 开始。构建 `phase2-v1` / AI `utility-v1`；Node 24.21.0、V8 13.6.233.17-node.53。机器可核对记录见 [phase-2-evidence.json](./phase-2-evidence.json)。

P2-01～P2-11 已完成，G2 工程出口通过。H2 人工观感判断待评。没有扩角色、接入实时导演或生成正式视频。

## 可运行结果

浏览器默认双方使用 Utility AI。它只接收当前自身状态和延迟成熟的公共敌情，生成最多 18 个联合候选，在三个运动假设上预测、分解评分，并执行承诺、迟滞和近优选择。均衡、压迫、反制、闪避人格可选；误差、随机选择和习惯记忆可分别关闭。

调试界面可以在比赛结束后逐决策跳转，查看硬过滤原因、评分分项、脱困/撞墙分、威胁窗口、续行分数、随机池、请求和结果，叠加估计位置。trace 独立导出/导入。输入回放不运行 AI；H2 播放器只读取保存的表现帧，不运行 AI 或物理。

```powershell
. .\scripts\use-node.ps1
npm.cmd run dev
# http://127.0.0.1:5173/

npm.cmd run build
npm.cmd run simulate -- --ai utility --a standard --b rubber --seed 17 --trace artifacts\phase-2\trace.json --output artifacts\phase-2\match.json
npm.cmd run simulate -- --replay artifacts\phase-2\match.json

npm.cmd run simulate -- --ai utility --seed 17 --checkpoint-at 240 --checkpoint artifacts\phase-2\checkpoint.json --output artifacts\phase-2\original.json
npm.cmd run simulate -- --resume artifacts\phase-2\checkpoint.json --output artifacts\phase-2\resumed.json
```

CLI 的 `--profile-a`/`--profile-b`、`--controller-a`/`--controller-b`、`--no-noise`、`--eval`、`--no-memory` 用法见 [README](../../README.md)。没有 `--ai utility` 的旧角色命令继续使用 Phase 1 默认脚本；旧 Phase 0 命令也保留。

## 任务证据

所有路径相对仓库根目录；任务状态仍由开发执行计划维护。

| 任务 | 主要实现 | 验证证据 |
|---|---|---|
| P2-01 | contracts/ai-schema.ts、runner/observation.ts | 隐藏敌人位置/冷却/投射物改变时，成熟前输入和 RNG 一致；冷启动只依据自身向中心入场；事件/回执单次消费；ring 缺帧拒绝 |
| P2-02 | ai/options.ts、contracts/ai.ts | 最多 18 项、不可移动施法去重、无 Jump+Cast、冷却/hitstun/能量过滤、全负分/全非法处理、请求 ID 唯一 |
| P2-03 | ai/belief.ts、ai/motion.ts、ai/prediction.ts | 同决策误差共用、外推最多 18 tick、三假设；近战/投射物/突进命中与真实模拟对照；无 sim 导入 |
| P2-04 | ai/prediction.ts、content/utility.ts | melee/projectile/dash-hit/guard/self-buff/volley；30 tick、事件节点与落地、每分支最多 12 段；迟到防御无虚假免伤、H 外恢复风险、setup 上限 2 |
| P2-05 | ai/score.ts、ai/abilities.ts | 规格算例 6.22；死亡/斩杀、confidence、资源与重复成本；低 HP 风险权重；远程不可用时回退近战距离带 |
| P2-06 | ai/utility.ts、ai/selection.ts | 承诺、独立 Cast/Jump/移动门槛、先门槛后随机池；紧急危险最小评分间隔 3 tick；每实际决策一个 uint32；一次触发；满能量增益大招可实际执行 |
| P2-07 | web/main.ts、web/ai-debug.ts | Chromium 逐决策回看、评分表、估计位置、trace 与输入回放导入导出；trace 开关双跑相同 |
| P2-08 | ai/memory.ts | 有界历史、独立 encounter、源时钟结算、四样本前不适应、后验变化上限、记忆开关；飞行中不判 miss；pending 结果恢复 |
| P2-09 | ai/memory.ts、ai/score.ts、fighter-phase2.json | 卡墙成本、60 tick 脱困、正向距离进展最多 +2；远距等待可越过移动门槛；人格对照采用同样感知预算 |
| P2-10 | runner/utility.ts、ai/utility.ts、runner/observation.ts | 120/240/实际终局前一 tick 的完整恢复，后缀输入、状态、事件和 runnerHash 相同；独立 CLI 恢复文件逐字节相同 |
| P2-11 | tests/utility.test.ts、scripts/verify-phase2*.mjs、web/h2.ts | 通用场景矩阵、两角色基线初评、可复核失误 trace、20 场 H2 无标签观看包 |

## 工程验证

执行 `npm run verify:phase2`；最后的入场/脱困边界修正后再次执行类型检查、全部测试、构建及受影响的 Phase 2 对战和浏览器检查。结果：

- 9 个测试文件、113 项通过：保留原 72 项，新增 41 项 Utility/恢复/几何回归。
- 50 个源文件依赖边界通过，5 个负向自检；ai 只能依赖 contracts/math/ai，不能导入 Simulation。
- 冻结开发清单 30 个配置、60 次 Utility 执行；逐 tick worldHash、每 60 tick runnerHash、全部输入/事件和终局完全相同。另验证 30 份纯输入重放，日志开关不改变动作/RNG。
- 完整检查点测试含普通 120/240 tick 与真实终局前一 tick；比较恢复后每 tick 的输入/世界、完整事件和最终 runnerHash。输入重放仅比较 worldHash，不伪造控制器状态。
- 两个独立 Node CLI 进程输出逐字节相同；CLI 从第 240 tick 恢复也得到逐字节相同的完整回放。
- Chromium 153.0.8010.12 验证决策滑条、估计位置、trace 导入导出、回放导入导出和 390px 移动布局；没有页面异常。
- Phase 0 原最终/序列/文件 hash 不变；Phase 1 的 30 配置和 seed 17/18 浏览器回归保持原结果，超时与故意超预算失败包仍通过。

Phase 2 的代表浏览器/Node 对照：

| seed | 终局 tick | finalWorldHash |
|---|---:|---|
| 17 | 1456 | db53d1f09875272bd809bc8f6a71deff8c439a37bbf4f4fdd8d1026b26439287 |
| 18 | 1535 | 675d9a21aa281632c0ac470e61a024dc7e58e7904179b96b0579972ecf834a39 |

内容 bundleHash：`2123af25fbf62655bd80a4404043dfdc9b37512ee1c013744c81964a9dbee192`。开发清单 hash：`d0d1df027f4596c20a8e9011c881f7f2147de39c028d94175f3b0342103f8bb3`。原五份 seed 清单未修改。

时延测量是 seed 17 上每次实际决策的宿主计时，包含记忆、预测、选择和 trace 构造；平均/p95、样本数在 evidence 的 predictionTiming 中。它不进入状态/hash，不能当作所有机器的性能保证。

## 场景矩阵与失误解释

AI-01～05、08～11、13、15～16、18～19 与四个实现边界均有确定场景测试。AI-12 的低 HP 风险权重、AI-14 的无机会不空放/有机会实际开大、AI-17 的候选排序与 trace/RNG 公平性也在本阶段补测；四角色完整关门仍按 P3-04/P3-07。AI-06/07 是镜子反射场景，明确留到 P3-02/P3-03，未计为已通过。

失误案例：`rubber-vs-rubber-0`，seed 1245564233，tick 41 的 rubber-slap（requestId 2、castId 3）。接受施法后没有产生该 cast 的伤害。`artifacts/phase-2/miss-trace.json` 保存同场全部决策，可配合该场输入回放导入，在 requestId 对应决策查看延迟/误差、三个运动假设、命中收益和切换门槛，再核对实际事件。没有通过补伤害或修改终局消除失误。

所有现有能力有注册预测路径。增益大招除净 setup 评分外，还以能量 ready 600 tick、可用墙弹与后续交锋的受控场景验证实际选择和一次触发；没有机会时保持未使用。自然开发场景并不保证每个技能都有合适施放机会，接受覆盖清单如实保存在 evidence。

## 两角色基线初评

从冻结 `ai-baseline-v1.json` 取 standard/rubber、两基线、sampleIndex 0～4（train）和 25～29（holdout）、双方换边：80 场，训练/留出各 40。participantId 为 utility/baseline，换边不改变其派生 seed。双方能力相同，脚本可调用全部技能，反应延迟相同；沿用 Phase 1 的 rush/ranged 规则。

本次 Utility 79 胜、1 负、0 平、0 invalid，不能据此宣称完成正式 800 场或四角色强度结论。每个“角色×基线×分集”只有 10 场，Wilson 95% 区间在 evidence 中。

| 角色 / 基线 | train 胜/10 | holdout 胜/10 | 普通攻击空挥率（train / holdout） |
|---|---:|---:|---|
| standard / rush | 9 | 10 | 约 59% / 51% |
| standard / ranged | 10 | 10 | 约 73% / 63% |
| rubber / rush | 10 | 10 | 约 46% / 46% |
| rubber / ranged | 10 | 10 | 约 52% / 53% |

无效请求率为 0；该子集没有连续贴墙停滞超过两秒的比赛。空挥率仍高于 <45% 初始目标，尤其 standard 对 ranged；这是明确的校准差距，胜率不能抵消它。指标原始分子/分母、技能有效率、方向翻转、追击、首次交锋、有效交锋占比和满能量等待均保存在 `artifacts/phase-2/baseline.json`，不通过禁止普通攻击优化统计。

预测为有限几何近似，没有把真实未来输入送给 AI。后续应结合失误 trace 和留出场景校准短时运动/冷却机会与动作节奏。完整四角色评测和预测/迟滞/延迟/记忆消融留在 P3-06。

## H2 观看包与交接

```powershell
. .\scripts\use-node.ps1
npm.cmd run review:h2
# http://127.0.0.1:5174/
```

20 场无标签缓存轨迹：pressure/counter 各 10 场，每组 standard/rubber 各 5；各配对 seed 相同，对手为同角色 rush。两种人格的反应延迟均 9 tick、决策间隔 6 tick、位置/速度误差 6px/18px/s、近优带 0.8。只比较偏好差异，未借反应速度制造风格。

观看页面可暂停、倍速、拖动、逐场填写“看得懂、追击、空转、打法印象”，评分保存在本机，可下载 JSON。人工需要实际观看并记录是否进入扩角色阶段；自动浏览器操作产生的表仅是控件测试，不是观感评审。private-key.json 只供揭盲，观看服务拒绝该路径。

H2 状态仍为待评；P3-01/P3-03 的扩角色依赖尚未放行。若观感需改进，先调整 Phase 1/2 并重跑受影响用例。轨迹封装/独立播放器等不依赖扩角色的工程任务可另行推进。

## 规则修复与产物

[D0005](../decisions.md) 记录出招方向锁、防御归因、可见墙面和地面支撑冲量修复。冻结留出 seed 1780203690 曾触发零时刻身体/地面碰撞循环；保存失败包、补最小几何回归，修复后原 seed 通过，未替换清单。旧构建保留原规则，新 rulesHash 保存到世界/hash/检查点。

源代码、内容、测试、脚本和小型 evidence 纳入版本控制。完整 replay、trace、截图、H2 轨迹等保存在忽略的 artifacts 中，可由验证脚本再生成。GitHub 推送可在用户下一次要求时执行。
