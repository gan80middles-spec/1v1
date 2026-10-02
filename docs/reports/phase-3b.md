# Phase 3B · 实时节奏导演与开关对照

日期：2026-10-02。分支 `codex/phase-3b`，基于 Phase 3A 文档提交 `176f00c234c2e64498fdd849a365b11d4e14210a`。实现提交 `0a49452a63cdac15f7887589667ee06a69fb8308`，文件 hash 见 [phase-3b-evidence.json](./phase-3b-evidence.json)。构建 `phase3b-v1`、AI `utility-v3`、导演配置 `gentle-v1` v1、指标 `pacing-v1`；Node 24.21.0 / V8 13.6.233.17-node.53。

P3-08～P3-13 已完成，G3B 工程出口通过；[Phase 3 汇总](./phase-3.md) 将 G3A/G3B 工程结果合并。冷场 p90 仅缩短 **2.61%**，未达到 20% 目标；重复无效攻击与大招有效率没有改善。生产默认保留 **off**，导演效果尚未证实。20 对节奏盲评、旧 H2 与四角色风格观感均仍待人工判断。

## 运行与观看

```powershell
. .\scripts\use-node.ps1
npm.cmd run dev
# http://127.0.0.1:5173/，实时导演可选 off / observe / pace

npm.cmd run build
npm.cmd run simulate -- --ai utility --a iron --b mirror --seed 17 --pacing pace --trace artifacts\phase-3b\trace.json --output artifacts\phase-3b\match.json
npm.cmd run simulate -- --replay artifacts\phase-3b\match.json

npm.cmd run simulate -- --ai utility --a iron --b mirror --seed 17 --pacing pace --checkpoint-at 240 --checkpoint artifacts\phase-3b\checkpoint.json --output artifacts\phase-3b\original.json
npm.cmd run simulate -- --resume artifacts\phase-3b\checkpoint.json --output artifacts\phase-3b\resumed.json

# 完整当前阶段验证；正式对照为 200 配置、400 次执行
npm.cmd run verify:phase3b
# 局部对照/观看包与计时
npm.cmd run evaluate:pacing
npm.cmd run measure:pacing
npm.cmd run review:pacing
# http://127.0.0.1:5176/

# 旧完整回归/冻结原始记录复查；后者需要 Phase 3A 原 artifacts
npm.cmd run verify:phase3a
node scripts/verify-phase3b-legacy.mjs
# 生成小型可提交证据；需要上述报告与旧回归报告
npm.cmd run record:pacing-evidence -- --implementation-commit 0a49452a63cdac15f7887589667ee06a69fb8308
```

网页模式改变会重置比赛并产生新 runId。“同 seed 对照”运行相同角色、人格、seed 和诊断设置的 off/pace 两局，分别回看；导演时间线可定位发出、淡出、结束，候选表同时显示 Ubase、原始/实际 DirectorDelta、强度、风险/基础分门槛及叠加上限。导入回放沿用它保存的构建、内容和模式；CLI resume 显式改模式会拒绝，修改模式必须新开一局。

`--ai utility` 默认使用新构建和 off。旧构建可用 `--build phase3a-v1` 等保留原行为。CLI 比赛 JSON 嵌入可选 directorRecords，并另存 `.json.director.ndjson.gz`；所有日志字段都有严格 schema，未知字段拒绝。输入回放不会创建或重跑导演。Phase 4 的正式 manifest、多文件封装及视频生产未在本阶段实现。

## 公平与确定性契约

PacingDirector 每 30 tick 更新，只接收延迟成熟的公共快照和公开内容，延迟为双方 reactionDelayTicks 最大值+1。每次消费截止 tick 前全部连续帧，禁止漏掉更新之间的伤害；公共历史窗口最多 361 帧（360 source ticks）。Observation ring 按 `max(64, delay+sampleInterval+2)` 增长，最大反应延迟/60 tick 采样的恢复场景验证容量 93。

导演不持有 world、控制器、敌人真实冷却或 RNG。有效交锋使用累计实际 HP 损失≥1、正值防御减伤、反射或屏障消散；微伤害累加到阈值才清除冷场。施法按 actor+sourceCastId 归因，等待声明式 timeline/投射物/状态寿命及公开在场效果全部结束后才确认无效。反射伤害不归原攻击者；最后生效 tick 的增益贡献按公开帧和此前状态回执还原。移动增益需要本人位移≥40px 且攻击距离带差距改善≥40px，不能把对手靠近误算成本人的有效 dash。

触发优先级固定为 engage→vary→showcase。开局 120 tick 保护；engage 要求 180 tick 无有效交锋，vary 要求 180 tick 窗口内同角色同槽至少 3 次已确认无效使用且 quiet≥60，有效使用清除之前的重复；showcase 要求公开 ready 保持≥180 tick 且 quiet≥60。每条提示 120 tick，前后各 30 tick 线性渐变，中间 60 tick 平台；提示结束后中立至少 120 tick，每场最多 6 条。applyTick=issuedTick+1，双方只有 nowTick 与自己的 sensedTick 均成熟才收到提示。

提示 ID、原始证据和包络不因逐次碰撞切换；每次公开采样刷新 liveEvidence，使有效连打能及时清除 vary 修正，刷新依据也必须对双方成熟。engage 只对当前在本方合法主攻击距离带之外且相同预测器给出正 bandProgress 的候选加分，最大 +1.2；与本人脱困分合计≤2.5。vary 最大 −0.6，与已有重复成本 R 合计≤1.0。showcase 最大 +0.8，要求本人合法大招且预测 D>0、相对继续动作减少至少 2 个 HP 百分点伤害或 setupValue≥0.5。正修正不能救回比最佳基础分低超过 1.2 的候选，死亡风险不能超过继续动作+0.05。

修正发生于正常评分后、迟滞和随机池选择前。合法性、动作锁、请求确认、紧急打断、人格与随机预算继续生效。配置/settings/options 在单局开始时克隆冻结。off 不运行导演，observe 只更新导演；两种模式逐 tick 输入相同。导演全部未来状态进入 runnerHash 和 FullCheckpoint，包括采样游标、ready 起点、累计微伤害、待结算施法、已完成使用、提示/中立区间；历史日志不影响未来 hash。支持版本的旧输入回放缺失 pacing 时明确迁移为 off。

## 工程验证

| 检查 | 实际规模与结果 |
|---|---|
| 类型、单元/场景、构建 | Node/Web 类型通过；11 文件、277 项测试通过 |
| 模块边界 | 63 源文件、5 个负例通过；五份冻结 manifest 保持原 hash |
| 正式对照 | 200 配置×off/pace=400 次执行；0 invalid、0 rejected requests |
| 输入回放 | 400 次输入回放通过；200 次 pace 逐 tick worldHash 与原决策运行一致 |
| 旁观模式与重跑 | 200 次 observe 输入与 off 相同；200 次 pace 重新决策输入/事件/最终状态及日志开关 runnerHash 一致 |
| 完整恢复 | 18 个实际发出提示的配置×提示前/平台/淡出=54 次恢复；逐 tick 输入和 worldHash 一致，944 次未来 runnerHash 一致 |
| 独立 CLI | 两个独立 Node 进程的完整比赛字节一致，tick 240 resume 字节一致；禁止续跑时改模式 |
| 旧构建 | 新 off 的 200 配置输入/事件保留旧 3A；原 800 场基线完整回放字节/runnerHash 和原 200 次输入重放保留 |
| 浏览器 | 三模式 Node/Chromium 的完整回放与 trace 相同；导入、时间线、新 runId、对照、390px 页面、40 盲评片段、私钥 404 和偏好保存通过 |
| 历史回归 | Phase 0 原 hash 保留，Phase 1/2 smoke 与浏览器、Phase 3A 四角色浏览器通过 |

277 项中包含 44 项导演专用用例，通用 Utility 的 41 场景分别运行于 phase2/3a/3b。验证重复、恢复和计时都是额外执行，不计入正式 400 次对照样本。

原 Phase 0 worldHash：`a6de98e7d34e9210ab249df0228e4fc06c0252e1d30f6ae96722b94d1f946601`。

## 正式对照结果与未达目标

固定清单 `pacing-pairs-v1`：10 组无序对阵含镜像×20 seeds=200 配置；训练/留出各 100 配置，双方都是原人格/default 设置的 Utility。同配置 off/pace 成对；不挑胜局、不替换失败种子。清单 hash：`88a092a91ddd688615996ef4fdad6ed79a29c91b7cc44bb2d11dff1ace8c8a6e`。

冷场口径为两次有效交锋之间≥180 tick 的完整间隔，包含开局及比赛结束截尾；按全部冷场区间汇总 p90，另报全部间隔和单场最长间隔。交锋覆盖为每次交锋后 60 tick 占实际比赛 ticks 的比例。参与度为较弱一方实际伤害/总伤害，<0.2 为一边倒，无伤害比赛也算一边倒。普通攻击空挥与增益大招有效性复用 behavior-v2：普攻未造成任何实际伤害为 miss，增益有实际墙成长/近战效果才能算有效；重复攻击指标只计已结束的攻击，未过效果截止点的施法截尾。这些定义保存在 evaluation.json。

| 指标 | off | pace |
|---|---:|---:|
| ≥3s 冷场区间数 | 305 | 292 |
| 冷场平均时长 / p90 | 3.919s / 5.117s | 3.881s / 4.983s |
| 全部交锋间隔 p90 | 2.750s | 2.733s |
| 单场最长间隔 p90 / 最大值 | 5.417s / 10.333s | 5.117s / 10.800s |
| 有效交锋覆盖比例 | 53.382% | 53.632% |
| 普攻空挥 / 总普攻 | 2668 / 3987（66.917%） | 2730 / 4074（67.010%） |
| 重复已确认无效攻击 | 442 | 458 |
| 有效大招 / 大招 | 17 / 26（65.385%） | 15 / 26（57.692%） |
| 平均比赛时长 / p90 | 24.711s / 31.283s | 24.631s / 31.000s |
| 较弱方平均伤害参与度 | 37.614% | 37.971% |
| 一边倒比赛 | 17 / 200（8.5%） | 16 / 200（8.0%） |
| 拒绝出招 / 请求 | 0 / 10044 | 0 / 10119 |

冷场 p90 相对改善 `1−4.983333/5.116667=2.6059%`，低于 20% 假设；拒绝出招和一边倒没有恶化，但空挥略增、重复次数与大招有效率更差。pace 发出 engage/vary/showcase 分别 195/79/22 条，共 5616 次决策至少一个候选受实际修正。提示次数、修正分数和个别成功案例不能证明总体观赏性。

训练集冷场 p90 为 5.017→4.800s（4.32%），留出集为 5.183→5.183s（0%）；完整分组保存在 evidence/evaluation 的 train/holdout 字段。以 matchup 分层、整对重采样的 2000 次 paired bootstrap 给出冷场 p90 改善的探索性 95% 区间：总体 −3.13%～8.16%，训练 −2.08%～12.99%，留出 −12.58%～8.90%，均包含零；这只描述该 seed 样本的变动，不能推断人类观看偏好。其他四项差值区间也保存在 evidence 中。没有从留出集中选参数。旧 3A 的 53.30% 空挥来自 Utility 对脚本基线的 800 场，此处是双方 Utility 的 400 次配对执行，不能把两个数混作导演前后效果。

曾在发布前原型中只用训练集的 100 配置尝试更保守阈值：冷场 210、重复 4、ready 240（上限不变）；200 次执行中冷场 p90 5.017→5.033s，重复 205→208，普通空挥 66.20%→67.16%，没有选择该配置。实验原始报告和代码归因版本留在 conservative-v2/pre-release；之后修复公共效果归因并用最终 gentle-v1 重跑完整 400 次，不将原型实验冒充最终构建效果。后续应先看盲评和失败 trace，再在训练集研究候选机会/触发阈值，重做最终构建的留出对照。

## 三类真实动作变化

`artifacts/phase-3b/mechanisms/` 每类有完整输入 JSON、trace 和 `.evidence.json`。网页导入后定位以下 tick。验证器在同一决策状态、同一预测和同一随机样本上去掉 DirectorDelta，再走正常迟滞/随机池得到局部对照；它只证明这次选择被修正改变，不声称后续整局因果轨迹等同于另一场 off。

| 提示 | seed / 场次 / actor / tick | 无修正选择→实际选择 | 证据 |
|---|---|---|---|
| engage | 611974910 / iron-vs-iron-0 / 1 / 292 | wait→approach | 公共 quiet=188；Ubase=0.529820，Delta=+1.06375，U=1.593570，预测 bandProgress 为正 |
| vary | 28929329 / iron-vs-standard-19 / 2 / 1193 | basic→retreat | 提示来自同角色同槽 3 次已确认无效；原 basic 候选受减分，移动候选无需加分也能进入选择 |
| showcase | 159082585 / iron-vs-rubber-17 / 2 / 1675 | retreat→Overdrive | Ubase=−0.088594，Delta=+0.8，U=0.711406；公开 ready 自 1314，预测 setup 有机会；实际施法接受并在 tick 1692 触发墙成长 |

engage 样本双方中心距 342.46→171.48px（之后 120 tick），展示实际靠近但不是整局隔离因果估计。showcase 样本没有直接大招伤害，真实收益为增益墙成长，不能写成“大招造成 HP 损失”。vary 只说明选择离开重复普攻，不能据此声称总体重复率下降。

## 运行开销与人工待评

独立串行计时使用 Core Ultra 7 265K、20 逻辑核、Windows 10.0.26100、约 34GB RAM。预热 30 场，再对训练集 30 配置×3 模式×3 次重复计时，共 270 场；轮换模式顺序、自然提前结束，trace/recordFrames 关闭，directorLog 开启。只计 runner.run()，排除构造、指标、hash、序列化和文件 I/O；以实际执行 ticks 归一化。

<!-- cost-table:start -->
| 模式 | 实际 ticks / 90 场 | ms/tick | 单串行实时倍数 | 相对 off 开销 |
|---|---:|---:|---:|---:|
| off | 134505 | 0.291678 | 57.14× | 基准 |
| observe | 134505 | 0.301512 | 55.28× | 3.37% |
| pace | 130518 | 0.300027 | 55.55× | 2.86% |

进程实测最大 RSS 约 298.4 MiB；三次相同模式的输入 hash 一致。
<!-- cost-table:end -->

计时是单机器三次重复的阶段诊断；不代表四 worker 吞吐、所有硬件性能或包含视频生成的端到端目标。正式对照记录 frames/trace 的宿主耗时也保留在 evaluation，不作为上述生产开销比较。

匿名包从每种 matchup 取第 0/10 个配置，各覆盖训练/留出，合计 20 对、40 个片段。X/Y 模式和观看顺序固定随机，片段只有表现缓存与绘图内容；private-key 不对服务开放。观看者可填写可读性、追击/空转、精彩度和 X/Y/相同偏好并下载。浏览器功能测试填写的偏好仅用于验证保存，不是人工评分。**当前没有人工观感结论。**

contentHash：`f1332cfea1a7794dbd3f3be30aaf36f4104caf04e8480eb0b2829a9c5e407d13`；rulesHash 沿用战斗未改的 3A：`c4abf75eb58164fdb80d6d1ca98274711ec00ca9d08bd5fafa5f14fcb85e3678`。三个战斗插件仍为 v1。详细摘要、源文件归一化 hash、400 个 gzip 回放/400 个导演 sidecar/40 个盲评缓存/9 个机制文件 digest 进入 evidence；大型文件留在 ignored artifacts，可由脚本重建。

下一任务为 P4-01：正式回放 manifest、多文件角色及文件完整性。进入后续生产链路时采用 `phase3b-v1`/`utility-v3`、默认 pacing off；保存配置/版本/hash，保留另开 pace 比赛进行研究的入口。导演效果、普通空挥、大招机会与人工观感继续作为校准差距，不把本阶段工程通过当作效果已证实。
