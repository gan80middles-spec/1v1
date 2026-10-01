# 1v1 自动对抗短视频内容引擎：实施规格 v1.0

> 修订日期：2026-10-01  
> 本次补充：实时节奏导演、Phase 3B、导演状态回放与成对效果评测。  
> 执行对象：GPT-6 Sol  
> 来源：在原项目规格草案上重写、收敛和补全。本文取代原草案，作为首版实施依据。  
> 当前交付物是设计文档；本文中的代码、命令和目录均为后续实施规格，尚未实现或实测。  
> 数值分为**规则常量**与**初始调参值**。规则常量变更需要提升规则版本；初始调参值可以在固定评测集上调整，但必须保存配置版本和评测结果。

## 0. 如何执行这份规格

项目要持续、批量产出值得看完的“A VS B”短视频。第一种形式是极简几何物理格斗：观众能迅速理解角色规则，并看懂接近、出招、闪避、击飞、墙弹和反击。

实现按第 23 章的阶段推进，每阶段都留下可运行结果。优先做出两名角色能打、能复现、能导出的完整流程，然后增加战术与角色。不要先建完所有抽象层。

本文已经作出的主要决策如下：

| 原草案中的问题 | 本版决策 | 原因 |
|---|---|---|
| 物理引擎留待选择 | 自定义圆形刚体运动、接触与游戏化击退；静态矩形边界 | 首版只有少量实体，需要控制墙弹、高速命中与可重放性 |
| 多个几何形状对应真实碰撞体 | 外观形状独立；角色碰撞体统一为圆 | 先验证角色规则，减少尖角、旋转和接触求解问题 |
| 首版同时做两个完整 Mode | 发布一个 Fighter；增加一个仅供测试的 FreeBounce 规则夹具 | 检查模块依赖，同时限制内容工作量 |
| 起步 6～10 名角色 | 最终 MVP 为标准、橡胶、铁球、镜子 4 名；先实现标准与橡胶 | 已覆盖近战、弹射、高速冲撞、投射物和反射 |
| Utility AI 只有评分因素列表 | 明确感知延迟、联合动作、短时预测、统一评分、承诺与迟滞、记忆和评测 | 防止站桩、抖动、无限后退和即时读招 |
| Replay 在输入记录与快照间摇摆 | 输入记录用于验证；逐 tick 的表现轨迹用于播放；完整检查点用于调试续跑 | 视频不依赖重新运行旧版本模拟器 |
| 按命中次数给精彩度加分 | 按有效交锋和不同事件组合评分，并做去重和多样性选择 | 高频擦碰、持续伤害不能刷分 |
| 实时导演只作为远期设想 | 增加 Phase 3B：以公开局势识别冷场和无效重复，有限调整 AI 候选倾向 | 在比赛发生过程中改善交锋节奏，并用开关对照验证作用 |
| 多 package 工程 | 单仓库、单 package、src 内模块边界 | 先建立清楚依赖，确有复用需求再拆包 |
| 全自动视频方案未定 | Node 批量模拟 → 独立轨迹播放 → Chromium Canvas 逐帧截图 → FFmpeg | 明确且可恢复的离线导出流程 |
| 复用比例百分比 | 改成可运行的隔离测试 | 未实现前不承诺复用比例 |

**验收分两层：**工程正确性可以自动验证；观赏性要通过盲评和真实视频反馈验证。本文给出观赏性的初始目标，不宣称这些参数已经证明有效。

## 1. 产品范围与完成定义

### 1.1 输入与输出

输入：两个已验证的角色定义、AI Profile、Fighter 规则版本、竞技场配置、seed、批次数量和视频模板。

输出：

1. 每场比赛的结果、摘要指标、输入日志和配置标识。
2. 入选比赛的可独立播放轨迹、事件、分数解释。
3. 1080 × 1920、60 FPS、H.264 视频与 AAC 音频的 MP4。
4. 可重新导出的任务清单，包含成功、失败和错误原因。

比赛目标时长 20～45 秒，硬上限 60 秒。初始角色 HP 100；目标为每场 8～15 个有效交锋段，而不是规定每场必须打几次。

### 1.2 MVP 范围

必须交付：四名角色、一个正式 Mode、UtilityController、实时节奏导演 PacingDirector、两个脚本基线、固定 tick 模拟、版本化内容、可解释 AI/导演调试面板、Replay、批量筛选、离线 MP4 导出。

延后：时间回溯、重力翻转、黑洞、分身、真实多边形碰撞、按预设胜负编排剧情、可视化技能编辑器、LLM 内容生成、强化学习、人机对战、联网、账号、云服务和平台上传。

角色战绩只记录由哪个规则与配置产生的数据。禁止把经精彩度筛选的比赛胜率当作角色真实胜率；平衡统计必须使用未经筛选的完整评测批次。

## 2. 技术栈与版本策略

| 层 | 决策 |
|---|---|
| 开发语言 | TypeScript，strict、noUncheckedIndexedAccess、exactOptionalPropertyTypes |
| 模块与构建 | ESM；Node 端 tsc 构建，Web 端 Vite |
| 运行时 | Node.js 24 LTS；以 24.21.0 为文档核对基线 |
| 开发基线 | TypeScript 5.9.x、Vite 7.x、Zod 4.x；这是兼容基线，不表示这些都是最新版本 |
| UI 与绘制 | 原生 HTML/CSS/TypeScript + Canvas 2D；首版不引入 UI 框架 |
| 批量执行 | Node worker_threads 常驻池 |
| 内容校验 | Zod 严格对象 + 交叉引用与语义校验 |
| 自动测试 | Vitest；选择与锁定 Vite 版本兼容的稳定版本 |
| 导出 | Playwright 自带 Chromium + FFmpeg/ffprobe |
| 包管理 | npm，提交 package-lock.json，使用 npm ci |
| 数据 | UTF-8 JSON、NDJSON；轨迹允许 gzip，先不设计二进制格式 |

Node 官方发布表列出 24 为 LTS。Vite 7 的 Node 要求由 Node 24 满足。正式开工时固定实际补丁版本、Playwright 与 Chromium revision、FFmpeg build 和编码器列表，写入 toolchain-lock.json。不要把“latest”当成可复现配置。[Node 发布表](https://nodejs.org/en/about/previous-releases)、[Vite 7 公告](https://vite.dev/blog/announcing-vite7)、[TypeScript 5.9](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html)、[Zod 文档](https://zod.dev/)。

工具链锁定是 Phase 0 的安装记录，不需要为本规格提前安装依赖。若基线存在安全或兼容问题，升级并记录原因；业务接口仍以本文为准。

选择自定义物理是基于本项目的形状与交互范围，不是宣称 Matter.js 不能固定步进或不能重放。若未来加入复杂刚体堆叠，重新评估引擎；当前无需抽象多个物理后端。[Matter.Engine API](https://brm.io/matter-js/docs/classes/Engine.html)

## 3. 架构、依赖与目录

### 3.1 运行关系

~~~text
内容 JSON → 校验/编译 → 不可变 ContentBundle
                              ↓
MatchRunner → ObservationBuilder → Controller → Intent
     │                                          ↓
     └────────────────────────────── Simulation.step
                                                ↓
                                  WorldState + DomainEvent
                                      │             │
                               ReplayRecorder    Analysis
                                      │             ↓
                               PresentationTrack  Director
                                      │             ↓
                                      └─────── Selection
                                                ↓
                                      RenderJob → MP4
~~~

MatchRunner 是组装入口。Controller 不导入 Simulation；Renderer 不导入 Controller 或战斗求解器。赛后评分 Director 读取事件与统计；实时 PacingDirector 读取延迟公共快照，向双方 Controller 提供有界的节奏提示。所有系统共用 contracts，但 contracts 不包含执行逻辑。

实时导演的数据支路为 PublicSnapshotRing → PacingDirector → Observation.directorCue → Controller。赛后评分保留上图的 Analysis → Director → Selection 路径。

Simulation 接收一对意图并执行一个 tick，不自行调用 AI。不同 Controller 产生相同意图序列时，战斗必须相同。Ruleset 仅决定初始化、可用动作、环境参数和胜负；墙面接触求解属于 physics，角色墙弹被动属于 abilities。不能把所有碰撞逻辑塞进 Ruleset。

### 3.2 最小目录

~~~text
src/
  contracts/        公共纯数据类型、版本、序列化格式
  math/             向量、碰撞几何、seed/hash、标量曲线
  content/          Zod schema、内容编译、引用校验
  sim/
    state.ts        世界状态和完整序列化
    step.ts         唯一 tick 调度入口
    physics/        积分、圆碰撞、扫掠、边界
    combat/         动作时序、命中、伤害、能量
    abilities/      通用效果、状态、被动处理
    rules/          fighter、free-bounce-fixture
  ai/
    observation.ts  延迟感知与可见性
    belief.ts       当前状态估计与威胁估计
    candidates.ts   联合动作生成
    predict.ts      只在感知副本中做短时预测
    score.ts        可分解评分
    select.ts       承诺、迟滞、随机选择
    memory.ts       有界历史和对手习惯
    controller.ts
    scripted.ts
  runner/           组装、tick 驱动、脚本/AI 控制器
  replay/           输入日志、检查点、表现轨迹、校验
  analysis/         交锋分段、指标、赛后评分、多样性
  director/         实时节奏识别、提示策略、状态与记录
  render/           Canvas、FX、音频计划、视频时间线
  web/              调试器与导出专用页两个入口
  cli/              simulate、batch、rank、render、verify
  jobs/             worker 池、任务清单、原子写入、恢复
content/
  characters/ abilities/ statuses/ passives/ ai-profiles/ arenas/
tests/
  unit/ scenarios/ determinism/ integration/
fixtures/
  seeds/ observations/ replays/
artifacts/          忽略版本控制；批次结果和视频
~~~

依赖允许：sim → contracts/math；ai → contracts/math 和只读内容定义；director → contracts/math 和公开内容；render → contracts/math/replay 的数据读取部分；runner → sim/ai/director/content/replay；cli/jobs → runner/analysis/render。AI 通过 Observation 接收 DirectorCue，不导入导演实现；导演不持有 WorldState 或 Controller 内存引用。

sim 不引用 ai、render、web、Node I/O；ai 不引用 sim 的完整世界与 step。通用预测运动函数放 math，不能以“复用”为由把真实世界引用传入预测器。用依赖检查防止反向导入，无需做插件加载器或服务容器。

## 4. 时间、随机数与确定性

### 4.1 时间语义

规则常量：60 simulation ticks/s，每 tick 四个物理 substep。所有冷却、持续时间、反应延迟、动作帧数均用整数 tick。设计 UI 可输入秒，编译时统一 round(seconds × 60)，正时长最少 1 tick，并显示结果。

S[t] 表示 tick t 开始前的完整状态。I[t] 从 S[t] 产生；step(S[t], I[t]) 输出 S[t+1] 和 tick=t 的事件。动作在 tick t 接受且 startup=N 时，活跃区间为 [t+N, t+N+active)。禁止在不同模块对 tick 边界各自解释。

### 4.2 随机数

根 seed 为 uint32；战斗 RNG 与双方 AI RNG 分流。使用版本化的 uint32 PRNG，例如 xoshiro128**，连同 SplitMix32 初始化实现一起冻结，并提供已知输入输出向量。浮点随机值统一为 uint32 / 2^32。

每场的种子由 rootSeed、matchupId、sampleIndex 经固定字节编码和固定 hash 派生，不能依赖 worker 编号、任务完成顺序或时间戳。双方 AI seed 带稳定 participantId；换边评测时跟随参与者。

选择随机数以 decisionIndex 为粒度消耗固定一次；评估候选、输出日志、绘制粒子不得消耗 AI/战斗 RNG。粒子从 replayId、eventId、particleIndex 派生视觉随机数。测试 RNG 序列与日志开关无关。

### 4.3 确定性承诺边界

必须保证：相同模拟器构建、固定 Node/V8 环境、相同 ContentBundle、seed 和输入，产生逐 tick 相同的权威状态与事件；worker 数量、倍速和日志开关不能影响结果。

MVP 不承诺所有浏览器、CPU 和未来 JS 引擎间浮点位级一致。浏览器调试模拟尽量与 Node 对照，但正式比赛以锁定 Node 环境为权威，导出以保存轨迹为权威。固定 tick 和 seed 不能单独证明确定性。

实体、候选、事件和效果均按稳定数字 ID 排序；不使用随机 UUID、Date.now、Math.random、对象地址或未经定义的遍历顺序参与逻辑。NaN/Infinity 立即判为 invalid，保存诊断，不修成 0 掩盖问题。

每 60 tick 计算规范化 hash；对象键固定排序、数组采用业务定义顺序、-0 规范为 0。worldHash 覆盖 WorldState、规则和内容标识；runnerHash 另包含 Controller、PacingDirector、感知历史、待送达回执和调度。输入重放只比较 worldHash；相同导演模式下的 AI 重跑与检查点续跑同时比较两者。不包含渲染粒子和调试输出。

## 5. 场地、运动与碰撞

### 5.1 初始物理参数

坐标单位为逻辑像素，时间单位秒；原点在场地左下，x 向右、y 向上。竞技场为 [0,960] × [0,960]；重力 (0,-1500)。正式视频将竞技场等比绘制于 1080×1920 画面中，y 轴只在 Renderer 转换。

| 参数 | 初始值 |
|---|---:|
| 标准半径 / 质量 | 32 / 1 |
| 地面最大自驱速度 | 320 px/s |
| 地面水平加速度 / 无输入减速度 | 1800 / 1400 px/s² |
| 空中水平加速度 | 600 px/s² |
| 跳跃初速度 | 620 px/s |
| 全局速度硬上限 | 1800 px/s |
| 正常墙面恢复系数 | 0.65 |
| 落地静止阈值 | 垂直入射速度绝对值 < 140 px/s |
| 初始位置 | (240,32)、(720,32) |

位移用半隐式 Euler：先更新速度，再更新位置。速度包括自驱与外力结果；自驱加速只把沿输入方向的速度推向目标速度，不能把高于目标的击飞速度瞬间截为 320。受击期间停用自驱，恢复后通过阻尼逐渐取回控制。每个 substep 在累计力和冲量后应用全局速度上限。

角色外观可为圆、方、三角、六边形或星形，碰撞均按圆处理。旋转只是表现数据。真实尖端伤害、刚体转动和角动量延后；角色差异由质量、反弹、技能和被动提供。

### 5.2 边界与接触

四面边界均封闭。圆心最小/最大坐标按半径收缩。接触仅在法向相对速度指向表面时反弹，先消除穿透再施加冲量。站在地面上不能每个 substep 都发 WallBounce。

地面有支撑状态：低速落地设 vy=0、grounded=true；高速被击飞落地时按恢复系数反弹。grounded 是接触结果，不能由“y 很小”自行推断。Fighter 只支持世界下方地面，重力翻转需后续单独设计支撑轴。

圆与圆先分离穿透，再按逆质量分配法向冲量。已确认地面支撑的身体保留水平响应，向地面穿入的竖直冲量受支撑约束；法向分母使用允许运动方向上的有效逆质量，避免身体/地面在同一时刻反复施加相反冲量（实现决定 D0005，phase2-v1；旧构建保留原求解）。普通身体接触不造成伤害；必须有活跃攻击体或显式冲撞状态。两个角色完全同心时使用按稳定 ID 决定的固定水平分离方向。

高速投射物与攻击体使用相对运动扫掠圆检测；双方上一 substep 到下一 substep 的位移都计入，禁止只检查最终重叠。角色半径最小 24，投射物半径最小 8；四 substep 不作为防穿透的唯一保证。每个 substep 的边界多次碰撞最多处理 4 次，超过则标记诊断并停止该 substep 的剩余位移。

### 5.3 击退

HitSpec 保存 launchDeltaV，不把“伤害”再次换算成隐含击退：

~~~text
deltaV = launchDeltaV × (1 / target.mass) × target.knockbackTakenMultiplier
newVelocity = oldVelocity × 0.25 + deltaV
~~~

方向在出招时由 facing/aim 锁定；向上分量明确写入数据。同 tick 多个命中的 deltaV 向量求和一次，旧速度保留项只算一次，再执行速度上限。墙弹保持切向速度、反转并衰减法向速度；橡胶增速有明确层数和总速度上限。

## 6. 战斗时序与状态

### 6.1 一个主动作状态，加正交运动与状态效果

~~~ts
type Tick = number;
type EntityId = number;
type AbilityId = string;
type Slot = "basic" | "skill1" | "skill2" | "ultimate";
type Vec2 = Readonly<{ x: number; y: number }>;

type ActionState =
  | { kind: "free" }
  | { kind: "cast"; castId: number; requestId: number; abilityId: AbilityId;
      startedTick: Tick; startupTicks: number;
      activeTicks: number; recoveryTicks: number }
  | { kind: "hitstun"; untilTick: Tick }
  | { kind: "dead" };

interface BodyState {
  position: Vec2;
  velocity: Vec2;
  radius: number;
  mass: number;
  grounded: boolean;
  facing: -1 | 1;
}

interface StatusInstance {
  instanceId: number;
  definitionId: string;
  sourceId: EntityId;
  sourceCastId: number | null;
  appliedTick: Tick;
  expiresTick: Tick;
  stacks: number;
}

interface Entity {
  id: EntityId;
  participantId: string;
  characterId: string;
  body: BodyState;
  hp: number;
  energy: number;
  energySuppressedUntilTick: Tick;
  lastProcessedRequestId: number;
  action: ActionState;
  cooldownReadyTick: Record<Slot, Tick>;
  statuses: readonly StatusInstance[];
}
~~~

Jumping/Falling 由 grounded 与 vy 推导；Knockback 是速度和 hitstun 的组合。不要再建立一套互相覆盖的 Jumping/Skill/Moving 大枚举。Startup、Active、Recovery 由 cast 的时间区间计算。

### 6.2 每 tick 固定顺序

1. 从 S[t] 保存公共快照，执行到期的延迟导演更新，再从同一 S[t] 构造双方 Observation；runner 独立求出双方意图，不能先应用 A 再让 B 观察。导演新提示最早下一 tick 生效。自身合法性按当前 tick 和截止时间计算，不因保存的旧 action 标记而额外迟一 tick。
2. 过期状态清理、当前动作阶段计算；检查合法性，接受或拒绝输入。
3. 接受出招时一次性扣能量、设冷却、生成 castId；应用 onCast 效果。零前摇技能当 tick 可生效。
4. 执行该 tick 到期的计划效果，更新状态修正与自驱输入。
5. 四次物理 substep，累计接触、命中候选和反射结果；伤害不在碰撞回调里递归结算。
6. 对命中候选去重；从本 tick 结算前状态计算伤害列表，同时应用双方 HP 变化与击退。
7. 处理受击中断、死亡、能量、有限被动事件链；记录最终状态与事件。
8. 检查胜负/超时，生成 S[t+1]，推进 tick。

同 tick 致命交换允许平局。已经命中目标的投射物不会因施法者本 tick 死亡而撤销。近战攻击若在更早 tick 被打断则消失；本 tick 的有效攻击互相命中允许 trade，不按实体 ID 偏袒一方。

在 tick t 结算的 hitstun=N 从 S[t+1] 起阻止 N 个完整 tick，untilTick=t+1+N。状态在 tick a 生效、持续 D tick，则有效于 [a,a+D)。CD 的 readyTick=接受 tick+CD。Death 在伤害批次后确定；MVP 不允许治疗复活，死亡后的被动治疗丢弃并保留原因，避免事件链改变同 tick 平局。

### 6.3 输入、取消与命中去重

移动为持续量，Jump/Cast 为一次触发。没有通用 Block/Dash；位移和防御由技能提供。首版 Jump 与 Cast 同 tick 互斥，组合输入时 Cast 优先、Jump 拒绝并记录原因。移动能否伴随技能由技能 movementScale 决定。

出招完整经过 Startup/Active/Recovery。没有普遍取消窗口和隐藏输入缓存；hitstun、死亡或技能明确的中断规则可以结束动作。进入 hitstun 后不保存旧 Cast 请求。无效请求当 tick 丢弃，不能在冷却结束后自动补发。

每个 castId、hitGroup、targetId 建立命中登记。默认一个 hitGroup 只能命中目标一次；多段攻击通过不同 hitGroup 表示，持续区域通过指定 intervalTicks 表示。被反射投射物保留 projectileId 与反射次数，更换伤害归属；同一 substep 不能再次命中刚发生反射的实体。

### 6.4 能量、结束与安全边界

HP 默认 100，能量上限 100。初始能量增长：每秒自动 +1；实际造成 1 点 HP 伤害 +0.35；实际受到 1 点 HP 伤害 +0.55。按截断后实际损失计算，不计算溢出伤害、护盾吸收、自伤、纯墙弹。一个角色一个 tick 的伤害能量增长最多 12。大招消耗 100，并使自身接下来 240 tick 的所有能量增长暂停，防止立即连开。

HP ≤ 0 判死亡；双方同 tick 死亡为 draw。3600 tick 未结束时比较剩余 HP / maxHP，差值 ≤ 0.005 则平局，否则为 timeout 胜利。结果必须区分 ko、double-ko、timeout、invalid，超时比赛默认不进入正式视频候选。

实体数上限 64、投射物 32、区域 8、单 tick 派生效果 256、事件因果深度 4。超限标记 invalid 并输出触发链，不静默删掉伤害。限额是保护与诊断措施，正常内容不得触达。

## 7. 内容、技能与插件边界

### 7.1 核心定义

~~~ts
interface CharacterDefinition {
  id: string;
  version: number;
  name: string;
  ruleText: string;
  body: {
    radius: number; mass: number; restitution: number;
    moveSpeed: number; groundAcceleration: number;
    airAcceleration: number; jumpSpeed: number;
  };
  stats: { maxHp: number };
  slots: Record<Slot, AbilityId>;
  passiveIds: readonly string[];
  aiProfileId: string;
  visual: { shape: "circle" | "square" | "triangle" | "hexagon";
            color: string; outlineColor: string };
}

interface HitSpec {
  damage: number;
  launchDeltaV: Vec2;
  hitstunTicks: number;
  hitGroup: string;
}

type Effect =
  | { kind: "hitbox"; radius: number; offset: Vec2;
      durationTicks: number; hit: HitSpec }
  | { kind: "projectile"; radius: number; speed: number;
      lifetimeTicks: number; reflectable: boolean; hit: HitSpec }
  | { kind: "impulse"; deltaV: Vec2; target: "self" | "hitTarget";
      velocityMode?: "add" | "set-x" }
  | { kind: "status"; statusId: string; target: "self" | "hitTarget" }
  | { kind: "heal"; amount: number; target: "self" }
  | { kind: "plugin"; pluginId: string;
      params: Readonly<Record<string, number | string | boolean>> };

type Condition =
  | { kind: "grounded"; value: boolean }
  | { kind: "hpBelow"; ratio: number }
  | { kind: "hasStatus"; statusId: string };

interface AbilityDefinition {
  id: AbilityId;
  version: number;
  tags: readonly ("melee" | "projectile" | "mobility" | "defense" | "buff")[];
  allowedWhen: "ground" | "air" | "both";
  startupTicks: number;
  activeTicks: number;
  recoveryTicks: number;
  cooldownTicks: number;
  energyCost: number;
  movementScale: number;
  conditions: readonly Condition[];
  scheduledPolicy?: "cancel-on-interrupt" | "before-first-emission";
  timeline: readonly {
    offsetTick: number;
    effects: readonly Effect[];
  }[];
  ai: AbilityAIHint;
}

interface PassiveDefinition {
  id: string;
  trigger: "wallBounce" | "damageDealt" | "damageTaken";
  internalCooldownTicks: number;
  conditions: readonly Condition[];
  effects: readonly Effect[];
}

type UltimateDefinition = AbilityDefinition;

interface StatusDefinition {
  id: string;
  version: number;
  durationTicks: number;
  stacking: "refresh" | "replace" | "stack";
  maxStacks: number;
  modifiers: {
    damageTakenMultiplier: number;
    knockbackTakenMultiplier: number;
    moveSpeedMultiplier: number;
    jumpSpeedMultiplier: number;
    massMultiplier: number;
    bodyScale: number;
    meleeHitboxScale: number;
    restitutionOverride: number | null;
    wallGrowthCoefficientOverride: number | null;
  };
  reflect: null | { extraRadius: number };
}
~~~

大招沿用 AbilityDefinition，由 slot=ultimate 和能量成本区分，不再创造第二套施法引擎。timeline 的 offsetTick 相对于出招接受 tick；项目内容编译器检查事件是否落在允许区间。近战 hitbox 通常在 startupTicks 创建。

Phase 1 接口补充：impulse 默认 add；set-x 将水平速度设置为 deltaV.x × aimX，垂直分量仍相加，用于落实橡胶突进的 900 水平速度，避免把已有自驱速度再次累加。scheduledPolicy 默认 cancel-on-interrupt；标准三连射显式使用 before-first-emission，首发前取消全部任务、首发后保留剩余任务。两个字段均是有限枚举，缺省不改变原有夹具的规范化数据。数值与技能时序不变。

数据只有有限 discriminated union，没有任意表达式、eval、任意脚本 URL 或通用循环。status 定义提供有界的 damageTakenMultiplier、knockbackTakenMultiplier、moveSpeedMultiplier、restitutionOverride、reflect 和 bodyScale 字段；多个倍率相乘后 clamp 到各字段合法范围。反射状态取是否存在，体型缩放取最大值而非无限叠乘。

stacking 必须为 refresh、replace 或 stack；每个定义写 maxStacks、durationTicks、刷新规则。消失时重新计算有效属性，不能靠“乘回倒数”恢复原属性。扩张体型后用一次位置投影推回场内；不能把位置越界当伤害。

未修改的 multiplier/scale 填 1，override 填 null。refresh 更新 expiresTick、不增加层；replace 移除旧实例后新建；stack 增层至上限并刷新整组截止时间。MVP 的 guard/buff 均使用 refresh、maxStacks=1；橡胶墙弹层数由被动状态单独维护。倍率上限默认 [0.1,3]，伤害减免倍率为 [0,2]；多个 override 取最近 appliedTick，平手取 instanceId 较大者。

### 7.2 内部插件

MVP 允许注册少量内部 TypeScript 处理器：rubber-wall-growth、speed-impact、reflect-projectile、scheduled-volley。不是动态加载系统。

插件只能通过受限 EffectContext 产生已定义状态改动命令；不能直接调用 Renderer、Controller、文件或网络。插件状态必须为可序列化数据；每个插件要有配置 schema、状态 schema、事件说明、预测近似和边界测试。新增一个角色应以 JSON 与复用效果为主，新增一种真正机制才添加处理器。

因果链中携带 rootEventId、parentEventId、depth；反射伤害不能触发无限反射/反伤，吸血只能响应实际 DamageResolved 且不把治疗重新解释为伤害。反射次数最多 2，第三次遇反射屏障时销毁投射物并记录 dissipated。

### 7.3 校验与内容编译

运行前用 Zod strictObject 做字段校验，再做语义校验：

- ID 唯一、引用存在；四个 slot 均有定义，插件必须已注册。
- 数值 finite；tick 为非负整数；activeTicks≥1，合法 duration≥1；质量>0，半径≥24。
- restitution 在 [0,1.15]；倍率、持续时间、伤害和速度有项目级上限。
- ultimate energyCost=100；其他首版技能 energyCost=0。
- 同一 hitGroup 的多段设计明确；不允许同 ID 循环自触发。
- timeline 在 cast 生命周期内；延时投射物任务由独立已序列化 scheduler 承接。
- AbilityAIHint 指向已存在的 predictor，显示射程和真实 hitbox 不产生第二套独立数值。
- Profile 的距离带和预测参数合法，不会产生空区间或负延迟。

通过后生成不可变 ContentBundle，保存原始内容、schemaVersion、bundleHash、插件版本。旧 Replay 内嵌其完整定义快照，禁止播放时悄悄读取最新角色 JSON。


## 8. Utility AI 的目标与总体算法

AI 必须能围绕角色能力争取胜利，表现出接近、维持距离、试探、追击、避险、反制和资源使用。它的失误应来自有限感知、有限预测和人格偏好。不要通过随机发送明显无效动作制造“人味”。

采用**单层联合动作 Utility + 有限执行承诺**。不另建会压制战术选择的进攻/防守状态机，不引入 GOAP、蒙特卡洛树搜索或强化学习。战术标签用于解释和候选构造，不成为互斥的“脑模式”。

~~~text
当前自身状态 + 延迟公共观察
             ↓
有界记忆与当前状态估计
             ↓
生成最多 18 个联合候选
             ↓
当前自身合法性过滤
             ↓
在感知副本中预测未来 30 tick
             ↓
按同一尺度计算收益与风险
             ↓
执行承诺 → 紧急判定 → 迟滞 → 近优随机
             ↓
移动保持量 + 一次 Jump/Cast
             ↓
真实 Simulation 再校验并执行
~~~

Utility 理论中的响应曲线与加权随机可用于平滑选择，相关背景见 Kevin Dill、Dave Mark 的 [GDC 原始演讲介绍](https://www.gdcvault.com/play/1012747/Improving-AI-Decision-Modeling-Through)。以下具体公式、延迟规则、阈值和测试均为本项目设计，不应归因于该演讲，也未经过游戏内实测。

### 8.1 Controller 接口与联合输入

~~~ts
type CastRequest = Readonly<{
  slot: Slot;
  aimX: -1 | 1;
}>;

interface ActionIntent {
  moveX: -1 | 0 | 1;
  jumpPressed: boolean;
  cast: CastRequest | null;
  requestId: number | null;
}

interface Controller {
  reset(init: ControllerInit): void;
  update(observation: Observation): ActionIntent;
  snapshot(): ControllerSnapshot;
  restore(snapshot: ControllerSnapshot): void;
}

interface ControllerInit {
  participantId: string;
  entityId: EntityId;
  aiSeed: number;
  profile: AIProfile;
  contentHash: string;
}

interface ControllerSnapshot {
  version: number;
  decisionIndex: number;
  lastDecisionTick: Tick | null;
  nextDecisionTick: Tick;
  rngState: readonly number[];
  memory: AIMemory;
  execution: ExecutionMemory;
}
~~~

update 每 simulation tick 调用；复杂评分仅在决策 tick 执行。两次决策之间返回持续 moveX；jumpPressed 与 cast 只在选中动作首次发送 tick 出现。不能把“保持 Attack”解释成冷却好了继续打。

每次新触发分配递增 requestId。执行器发出 accepted/rejected/finished/interrupted receipt；(entityId,requestId) 对应的请求只接受一次，但可收到接受和完成两个不同回执。回执用独立 receiptSeq 去重，不能把完成回执当成重复请求丢弃。Runner 记录全部发出的 I[t]，包括被拒绝意图；回放时由 Simulation 重做同样的校验。

基础合法性只依赖自身 action、grounded、冷却、资源和 Mode capability。近战不因真实敌方距离过远而拒绝，应正常挥空，避免通过 accepted/rejected 探测真实敌方位置。能力本身的真实碰撞发生在模拟里。

## 9. 感知、反应延迟与公平信息

### 9.1 Observation 是信息边界

~~~ts
interface PublicFighterView {
  id: EntityId;
  characterId: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  facing: -1 | 1;
  grounded: boolean;
  hpRatio: number;
  energyBand: "low" | "mid" | "ready";
  tell: null | {
    abilityId: AbilityId;
    phase: "startup" | "active" | "recovery";
    visibleSinceTick: Tick;
  };
  visibleStatusIds: readonly string[];
}

interface PublicProjectileView {
  id: EntityId;
  ownerId: EntityId;
  sourceCastId: number;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  reflectable: boolean;
  abilityId: AbilityId;
}

interface SelfView {
  entity: Readonly<Entity>;
  passives: readonly {
    passiveId: string;
    data: Readonly<Record<string, number | string | boolean>>;
  }[];
  legalSlots: readonly Slot[];
  canMove: boolean;
  canJump: boolean;
  receipts: readonly ActionReceipt[];
}

interface ActionReceipt {
  receiptSeq: number;
  entityId: EntityId;
  requestId: number;
  tick: Tick;
  result: "accepted" | "rejected" | "finished" | "interrupted";
  reason: "ok" | "busy" | "cooldown" | "resource" | "air-ground" | "conflict"
        | "duplicate" | "hitstun" | "dead";
}

interface Observation {
  nowTick: Tick;
  sensedTick: Tick | null;
  self: SelfView;
  opponent: PublicFighterView | null;
  projectiles: readonly PublicProjectileView[];
  visibleEvents: readonly PublicEvent[];
  directorCue: DirectorCue | null;
  arena: Readonly<{ width: number; height: number; gravity: Vec2 }>;
  capabilities: Readonly<{ jump: boolean; horizontalMove: boolean }>;
}

interface PublicEvent {
  seq: number;
  sourceTick: Tick;
  sourceId: EntityId | null;
  targetId: EntityId | null;
  detail:
    | { kind: "cast"; abilityId: AbilityId; castId: number; slot: Slot }
    | { kind: "damage"; castId: number; amount: number }
    | { kind: "bounce"; incomingSpeed: number }
    | { kind: "reflect"; projectileId: EntityId; defenseCastId: number | null }
    | { kind: "defend"; castId: number; preventedDamage: number }
    | { kind: "jump" }
    | { kind: "death" };
}

interface PublicSnapshot {
  tick: Tick;
  fighters: readonly PublicFighterView[];
  projectiles: readonly PublicProjectileView[];
  events: readonly PublicEvent[];
}
~~~

PublicEvent 是第 18 章 DomainEvent 的显式白名单投影：可见出招、命中、弹射、反射、受击与死亡。删除内部冷却、对手选择分数、隐藏状态、未来调度任务等字段。不能简单把完整 Event 对象强制转成 PublicEvent。

公开防御事件的 castId/defenseCastId 归属于产生保护效果的技能；投射物 sourceCastId 归属于产生弹体的技能。StatusInstance.sourceCastId 保存该关联，被动产生的状态为 null。导演和 AI 因此能区分“哪个技能成功防御”和“哪枚攻击被拦截”，无需查看私有技能状态。

自身体力、资源、姿态、受击与输入回执是当前值；对手、投射物、公共事件都是 sensedTick 时刻的已公开信息。自身体感即时变化允许 AI 知道“我被打中了”，但不能读到尚未感知的敌方位置或新投射物。

SelfView.passives 只包含自己的已知被动层数、截止时间与触发冷却，不包含对手数据。tell.visibleSinceTick 表示这次施法公开前摇开始的源 tick，不是每个阶段切换时重置的时间；无法确定起点时由 observed phase 给出区间估计，不读取内部精确计时补全。

对手的静态公开角色说明与技能定义可以预先知道。动态冷却只能根据已经看到的 CastAccepted 推断区间；未知视为 unknown，不假定冷却已经用过，也不读取真实 cooldownReadyTick。投射物和技能伤害可由公开定义估计。

### 9.2 延迟实现

每 tick 的 S[t] 在执行前写入 PublicSnapshotRing。ring 至少保存 64 tick。双方分别读取最大满足 snapshot.tick ≤ t - reactionDelayTicks 的快照；初始没有可读取快照时，opponent=null、projectiles=[]，按预先指定的入场位置策略移动。不得以 S[0] 填满过去的 ring。

默认入场策略只根据自身 x 向场地中心移动，到中心±32 px 内则等待；没有目标时不跳跃/施法。双方不会因初始化填充而在比赛第一 tick 获得零延迟敌情。

默认 reactionDelayTicks=9，decisionIntervalTicks=6。首次复杂决策在 t=0，之后每 6 tick；完整战术响应通常比公开变化晚 9～14 tick。反应延迟通过观察延迟实现，不能再叠一个同名“反应等待”而无意把延迟加倍。

每个可见事件携带 sourceTick 与 seq。延迟到期后仅送一次，按 (sourceTick, seq) 处理。高频 update 可以消费已到期事件和回执，但新事件不能触发不受限制的额外 Utility 计算。

时序约定：S[t] 的快照在 tick t 开始可见，tick t 内产生的事件最早写入 tick t+1 的公共快照；事件成熟条件同时要求产生该事件的快照已可读取。Controller 恢复时保留最后消费的 seq。自身回执在下一个 update 一次性送入数组，同 tick 接受后又受击中断时两条回执都保留。

**事件触发重评仅限：**当前动作被真实受击中断、自身死亡、或已延迟到达的重大威胁；仍遵守两次复杂评分至少间隔 3 tick。受击中断允许立即清空旧意图，不能借此提前读取对手。

### 9.3 估计“现在”，不访问真实未来

从延迟观测推算对手当前位置：

~~~text
age = nowTick - sensedTick
advanceTicks = min(age, 18)
estimatedPosition = integrate(observed position, observed velocity,
                             public gravity, advanceTicks)
~~~

边界反弹可以按公开场地与已知身体参数预测；未知输入不补为真实输入。age 超过 18 时不再无限外推，扩大不确定区间，并降低远距精确命中收益。

误差来自三个有界运动假设和每次决策一次采样的位置/速度偏移。同一次决策的所有候选共用相同偏移与假设；不能给每个候选不同噪声，否则比较失真。自身位置与合法性不加噪声。

禁止访问：对手 ControllerMemory、未成熟公共事件、真实 future queue、对手当 tick 输入、战斗 RNG 的未来值。PredictionContext 只接受 Observation 与已编译的公开能力描述，不接受 WorldState。

## 10. 候选动作与执行计划

### 10.1 联合候选集合

每次评估使用相同的未来 30 tick 窗口。候选不是独立的 Move/Attack 按钮，而是带持续移动策略的一小段计划：

| 类别 | 最多数量 | 说明 |
|---|---:|---|
| 保持/左移/右移 | 3 | moveX=0/-1/+1，无触发 |
| 跳起并保持/左移/右移 | 3 | 仅 canJump；消耗一次 Jump |
| basic/skill1/skill2/ultimate 各配 -1/0/+1 移动 | 12 | 仅自身合法技能；aim 取估计目标所在水平侧 |
| 合计 | 18 | 去重后通常更少 |

技能 movementScale=0 时三个移动版本相同，必须去重，不能让重复候选增加随机中奖概率。Jump 与 Cast 不联合；未来角色需要跳跃施法时，先在前一决策跳起，下次在空中合法施法。

移动计划固定世界方向，在两次决策间不追踪真实对手。到达场地内侧 8 px 安全余量时允许根据自身位置停止；不能根据实时敌人位置改变方向。精细距离修正只在下一次感知决策发生。

给计划附上 explanationTag：approach、spacing、retreat、punish、chase、evade、reflect、commit-ultimate 等。这些是从候选结果提取的解释，不是另一个决策系统。

### 10.2 合法性与可取性分开

硬门槛：死亡、hitstun、动作未完成、缺能量、未冷却、错误地面/空中要求、Mode 不支持。硬门槛失败候选不进入排序，trace 仍保留拒绝原因。

软判断：距离偏远、击中概率低、被反击风险高、靠墙、资源时机不好。它们通过分数处理，不能全部写成硬 if。防御反射技能在附近没有可反射威胁时可设“无有效作用”门槛，门槛数据只能来自 Observation。

未观察到对手时，只生成移动/等待，首版不盲开技能。全部候选被硬过滤时返回 moveX=0、无触发；若只是所有合法候选评分为负，仍选择其中最佳，不能因负分冻结。

### 10.3 承诺执行

~~~ts
interface ExecutionMemory {
  optionKey: string | null;
  moveX: -1 | 0 | 1;
  selectedTick: Tick;
  minimumHoldUntilTick: Tick;
  activeRequestId: number | null;
  triggerSent: boolean;
  expectedFinishTick: Tick | null;
  lastReceiptSeq: number | null;
  nextRequestId: number;
}
~~~

普通移动至少保持 12 tick，Jump 的方向至少保持 12 tick；等待至少 6 tick。Cast 接受后，启动到恢复结束属于模拟动作锁，AI 的“换主意”不能取消。busy 期间继续更新感知与记忆，只评估技能允许的移动方向；施法效果保持不变。

动作结束以后重新生成候选。不能把旧 Cast 当作“继续当前计划”，否则可能重复扣费。当前可续行候选是保持移动/等待；正在执行中的 cast 则在每个预测分支中作为既定动作存在。

移动承诺是行为稳定约束，可被延迟感知到的紧急危险打断；技能动作锁是规则约束，不能被 Utility 越权打断。

## 11. 短时预测器与威胁模型

### 11.1 预测预算

默认预测窗口 H=30 tick（0.5 秒），所有候选相同。每个候选评估 3 个对手运动假设：保持估计运动、向我接近、远离我。基础权重 0.5/0.25/0.25；有足够上下文样本时按第 14 章调整，单项改变量最多 0.15。

预测使用轻量运动状态、扫掠碰撞与能力摘要，不调用完整 Simulation、不推进真实 RNG、不克隆未来隐藏状态。采样网格每 6 tick 一段，同时插入前摇结束、攻击结束、投射物生成和落地等边界，避免跳过仅持续 4 tick 的攻击。每假设每候选最多 12 个积分段；超预算保守降低收益，不调用真实世界“补答案”。

首版不搜索未来动作树。候选在起点触发一次动作，并持续移动；预测窗口内不假定自己会自动补出第二个尚未选择的技能。

### 11.2 两类威胁

**可见承诺威胁：**已看到的前摇、正在运行的攻击、投射物和明确区域。根据观察时刻的阶段推算可能生效区间，生成 ThreatWindow。不能把延迟视图中的旧前摇当作当前刚开始。

**未承诺威胁：**对方尚未出招时，按已知普通攻击射程和接近速度估计一次潜在普通攻击。基础 likelihood=0.35；条件样本可把它调到 [0.15,0.65]。若已观察到对方仍处于不可取消动作或普通攻击冷却确定未结束，则对应时间段为 0。不能把所有技能都同时假定为必发，也不能将安静对手的威胁永久记为 0。

~~~ts
interface ThreatWindow {
  id: string;
  sourceId: EntityId;
  kind: "committed" | "possible-basic";
  startInTicks: number;
  endInTicks: number;
  estimatedDamage: number;
  likelihood: number;
  reflectable: boolean;
}

interface AbilityAIHint {
  predictorId: "melee" | "projectile" | "dash-hit"
             | "guard" | "reflect" | "self-buff" | "volley";
  preferredCenterDistance: readonly [number, number];
  purpose: "damage" | "defense" | "mobility" | "setup";
}
~~~

射程、伤害、前摇、持续时间从 AbilityDefinition 编译为摘要；AIHint 只保存用途、期望距离与预测器选择。禁止另写一份假的攻击射程来让 AI “看起来更聪明”。

### 11.3 预测产物

~~~ts
interface OutcomeEstimate {
  expectedDamageDealtPct: number;
  meanDamageTakenPct: number;
  worstDamageTakenPct: number;
  killLikelihood: number;
  deathLikelihood: number;
  positionQualityBefore: number;
  positionQualityAfter: number;
  residualExposurePct: number;
  setupValue: number;
  confidence: number;
}
~~~

百分比以对应目标的 maxHp 为分母；HP 损失不超过当前 HP。击杀与死亡 likelihood 是三个假设与威胁 likelihood 加权后的启发式值，不是经过校准的统计概率。UI 应标“估计”而非“真实命中率”。

命中收益考虑前摇、相对轨迹、半径、攻击活跃区间、墙体遮挡和可见防御。碰撞检测返回确定命中/未命中，再按假设权重得到估计；不直接让“距离越近”无条件产生伤害收益。

遭受伤害计算只计一次同一 ThreatWindow；反射改变该投射物的归属后，预测己方免伤和可能的返还伤害。反射保护本身不能再额外加一份“防御奖励”，避免重复计算。

长恢复动作如果恢复期超过 H，估计 H 后至 min(恢复结束,H+30) 的残余暴露，最大记 12 HP 百分点；只计算 H 外风险，与窗口内 L 不重复。长持续 buff/区域的 H 外收益可通过 setupValue 近似，但上限为 2 分，confidence≤0.6，不能给“大招”三个字额外加固定高分。

这里的 0.6 上限是 setup 估计专属置信度，不降低同一候选在 H 内已明确命中的 D。self-buff 预测器采用一个有界的“下一次机会”摘要：先按距离/相对速度估计未来 120 tick 内是否能完成一次普通攻击或墙弹，不继续搜索后续技能。铁球 giant 的收益取放大前后普通攻击几何命中估计差×普通攻击 HP 百分点，加质量变化带来的 H 外受击风险差；橡胶 overdrive 取下一次高速墙弹后达到可攻击距离的估计改善×4。乘 setup 置信度后 clamp 到 [0,2]。H 内已计入的收益和风险必须扣除；没有可达机会时取 0。用成对场景验证 buff 在有机会/无机会时的得分顺序。

若某能力无法给出可解释预测，先用保守且有上限的专用摘要，并增加场景测试。未实现 predictor 的能力不得进入自动对战内容库。

### 11.4 位置价值

以双方圆心距离定义距离带。profile 选择当前可用主攻击的 preferredCenterDistance；若远程技能全在冷却而普通攻击可用，距离带退回近战，不长期站在远处等待冷却。

~~~text
band(d, lo, hi, falloff) =
  d < lo ? clamp01(1 - (lo-d)/falloff) :
  d > hi ? clamp01(1 - (d-hi)/falloff) : 1

space = clamp01(min(self.x-radius, width-radius-self.x) / 160)
heightFit = clamp01(1 - abs(self.y-opponent.y) / 220)
positionQuality = 0.65*band(distance,lo,hi,160)
                + 0.20*space + 0.15*heightFit
~~~

位置收益使用 after-before，不给“持续待在好位置”每次重复发奖励。墙边并非绝对坏位置：rubber-wall-growth 角色可把 space 权重降至 0.05，其余权重按比例归一；仍保留位移受阻风险。无敌人时不计算此值。

## 12. 统一 Utility 评分

### 12.1 分数尺度

所有候选的主分数使用近似“HP 百分点价值”。不能把 Attack 的 0～1 命中概率直接与 Move 的距离像素比较，也不能把任意数量 consideration 连乘导致复杂动作天然低分。

定义：

~~~text
D = expectedDamageDealtPct × confidence
L = 0.75 × meanDamageTakenPct + 0.25 × worstDamageTakenPct
P = 3 × (positionQualityAfter - positionQualityBefore)
K = 8 × killLikelihood
X = 18 × deathLikelihood
E = residualExposurePct
B = clamp(setupValue, 0, 2)

Uraw = wD*D - wL*L + wP*P + K - X - wC*C - wL*E - R + B
~~~

伤害不确定性通过 confidence 降低收益，风险不乘相同折扣，避免“越看不清越莽”。默认 confidence 随观测 age 在 9→18 tick 区间从 0.95 线性降到 0.70；超过 18 则降到 0.50。已知静态位置场景和无噪声测试可设为 1。

风险倍率 wL=(2.0-1.2*riskPreference)×lowHpMultiplier；lowHpMultiplier=1+0.5×clamp01((0.3-hpRatio)/0.3)。wD=0.8+0.4*aggression；wP=0.8+0.4*spacing；wC=0.8+0.4*resourcePatience。保留最坏分支和死亡惩罚，避免高风险人格变成主动送死。

所有 U 必须 finite。每项与总分一起记录；非法值使该候选失效，并使开发模式测试失败。

### 12.2 资源机会成本与重复惩罚

普通技能 C=2×cooldownTicks/(cooldownTicks+120)；普通攻击也按自己的短冷却算，但 move/jump/wait 成本为 0。

大招 C=6×reserveFactor，其中 reserveFactor=max(0.25,1-readyAgeTicks/600)。readyAge 从自身能量第一次到 100 开始，消耗后归零。大招待用越久机会成本逐渐降低，但仍需预测存在有效作用；不能蓄满就对空气释放。

R 只惩罚近期重复无效尝试：同一 slot 在最近 180 tick 中最多记最近 3 次已完成的失误，每次 0.25，总上限 0.75。命中过、成功反射、有效减伤或造成有效位移的动作不算失误。位移/等待不受此惩罚；有效重复策略不为“多样性”被强行禁止。

防御的收益来自 L 的下降。攻击的收益来自 D。墙弹如果带来后续命中或位置改善会自然得分；没有伤害或战术价值的碰撞不额外奖励。精彩度分数不输入 Uraw。

### 12.3 可复核算例

设默认人格 wD=wP=wC=1、wL=1.4，confidence 已包含在 D，E/R/B/K/X 全为 0：

| 候选 | D | L | 位置变化 ΔP | C | Uraw |
|---|---:|---:|---:|---:|---:|
| 趁对手恢复用普通攻击 | 8.4 | 1.2 | 0.10 | 0.8 | 6.22 |
| 使用较慢远程技能 | 12.0 | 4.5 | 0 | 2.0 | 3.70 |
| 继续接近 | 0 | 1.8 | 0.50 | 0 | -1.02 |
| 后退 | 0 | 0.1 | -0.20 | 0 | -0.74 |
| 等待 | 0 | 3.0 | 0 | 0 | -4.20 |

普通攻击得分为 8.4-1.4×1.2+3×0.10-0.8=6.22。它优于伤害更高但易受反击的技能。若所有攻击都不合法，后退仍优于等待，不因分数为负而失去动作。

这是评分计算的单元测试向量；不能以这张表替代完整场景中的预测测试。

## 13. 选择、迟滞、反应与脱困

### 13.1 选择顺序

1. 收到受击/死亡/动作结束回执，先更新执行记忆。
2. 在决策 tick 构造同一份 Belief，生成和评估候选。
3. 若存在模拟动作锁，只允许合法移动变化；绝不选择新的 Cast。
4. 当前移动仍在 minimumHoldUntilTick 内，默认续行。
5. 检查延迟感知的紧急危险；满足条件可解除移动承诺。
6. 承诺到期后，新候选必须超过当前续行候选的迟滞门槛。
7. 在达到门槛的近优候选内做有限随机选择，发出一次触发。
8. 保存 trace 和新执行记忆。

迟滞门槛：

~~~text
纯移动/等待方向切换：switchMargin = 1.5 + 0.10 * abs(Ucurrent)
新 Jump：switchMargin = 0.75
新 Cast：switchMargin = 0.35
允许切换，当 Ubest > Ucurrent + switchMargin
~~~

当前动作已结束、当前候选非法或当前 option 为空时不应用迟滞。为启动新 Cast 计算的“当前”是继续移动/等待的价值，不是上一发攻击已经获得的历史价值。

移动、Jump、Cast 使用不同迟滞是为了防止小幅方向抖动，同时避免有冷却与动作锁约束的技能长期因移动阈值过高而不释放。移动最低承诺和技能合法性仍先检查。自增益大招测试必须覆盖：满能量 600 tick、存在可利用增益的后续交锋机会、当前无紧急威胁时，其净 setup 收益能越过 Cast 门槛；无交锋机会时 setupValue=0，仍不能空放。

### 13.2 紧急危险

在已经延迟送达的威胁中，预测当前计划未来 12 tick 将损失 ≥12% maxHp，且最佳可行动作至少降低 6 HP 百分点风险，允许立即打断移动承诺，仍遵守两次评分至少间隔 3 tick。

紧急动作从普通合法候选中选，不能生成无敌帧、提前结束 Recovery 或临时给予 Dash。只因“有一个投射物”不算紧急，必须估计当前轨迹会造成实质损失。

### 13.3 有限随机选择

先逐项筛掉未达到各自动作迟滞门槛的候选，再在余下候选中仅保留 U≥Ubest-band 的近优项。band=profile.nearBestBand，默认 0.8；band=0 时直接取最高分。每项权重：

~~~text
weight = (0.1 + max(0, 1 - (Ubest-U)/band))²
~~~

按 optionKey 排序，使用本次决策唯一随机值加权选择。eval 模式可以固定选最高分，分数相同按 optionKey；生产 profile 使用近优随机。被硬过滤、明显更差和无作用技能永远不进入随机池。

不要每 tick 添加新噪声打破承诺。不同 seed 产生不同但合理的战局；同 seed 的行为必须完全复现。

### 13.4 卡住、空挥与无限后退

- 最近 90 tick 没有造成/受到有效伤害、距离在近战带之外且自身位移<20 px：设置 stuck 标记 60 tick，把“走进有效距离”的正向位置收益增加最多 2 分。
- 最近 180 tick 没有有效交锋：逐步把可用主攻击距离带向近战收缩最多 30%，存在明确来袭威胁时暂停收缩。
- 同方向移动撞边连续 30 tick 且位移<8 px：该方向候选加 2 分成本，直到离边>40 px。
- 普通攻击连续三次无命中：记录 debug diagnostic，优先检查距离预测和方向锁定；不得直接赠送必中或增加射程。

这些属于 Controller 自己的脱困逻辑。实时导演在其基础上提供第 18.5 节的节奏提示，两者的叠加幅度有统一上限。脱困没有高于生存的绝对优先级，每个触发及导演修正均写入 trace。

### 13.5 伪代码

~~~text
update(obs):
  consumeNewVisibleEvents(obs)
  consumeSelfReceipts(obs.self.receipts)
  clearInvalidExecutionIfNeeded()

  if self.dead or self.hitstun:
    return neutralIntent

  if not decisionDue and not permittedMaturedInterrupt:
    return heldMoveWithoutTrigger()

  decisionIndex += 1
  decisionRandom = rng.next01()       // 每次决策固定消耗一次
  belief = buildBelief(obs, memory, decisionRandom)
  candidates = generateLegalJointOptions(obs, content)
  evaluated = predictAndScoreAll(candidates, belief)
  continuation = scoreCurrentContinuationInSameBelief()

  selected = selectWithCommitmentAndHysteresis(
    evaluated, continuation, execution, decisionRandom
  )
  recordTraceIfEnabled()
  updateExecution(selected)
  scheduleNextDecision()
  return emitMoveAndAtMostOneNewTrigger(selected)
~~~

为避免同一随机值在误差采样与抽签中产生明显相关，使用固定 hash(decisionRandomBits, channelId) 派生 beliefNoise 与 choice 两个值；不新增 RNG 调用。决策调度 nextDecisionTick=now+decisionIntervalTicks，允许中断的最小间距单独记录。

## 14. 人格、短期记忆与调参方法

### 14.1 AIProfile

~~~ts
interface AIProfile {
  id: string;
  version: number;
  aggression: number;
  riskPreference: number;
  spacing: number;
  resourcePatience: number;
  reactionDelayTicks: number;
  decisionIntervalTicks: number;
  positionNoisePx: number;
  velocityNoisePxPerSecond: number;
  nearBestBand: number;
  distancePreference: "melee" | "mixed" | "ranged";
}

interface EncounterSample {
  startedTick: Tick;
  completedTick: Tick;
  context: "near-ground" | "far-ground" | "air";
  outcome: "basic" | "skill" | "jump" | "retreat" | "other";
}

interface AIMemory {
  lastVisibleEventSeq: number;
  encounters: readonly EncounterSample[];
  recentOwnResults: readonly {
    slot: Slot; completedTick: Tick;
    result: "hit" | "defended" | "repositioned" | "miss";
  }[];
  lastEffectiveInteractionTick: Tick;
  ultimateReadySinceTick: Tick | null;
  lastPositions: readonly { tick: Tick; position: Vec2 }[];
  opponentCooldownEstimates: readonly {
    abilityId: AbilityId; earliestReadyTick: Tick;
    latestReadyTick: Tick; confidence: number;
  }[];
  pendingEncounter: null | {
    startedSourceTick: Tick;
    context: EncounterSample["context"];
    observedOutcome: EncounterSample["outcome"] | null;
  };
  pendingOwnResults: readonly {
    requestId: number; castId: number; slot: Slot;
    finalEffectTick: Tick; resultDueTick: Tick;
    effective: boolean;
  }[];
  stuckUntilTick: Tick;
  blockedMoveX: -1 | 0 | 1;
}
~~~

所有 0～1 参数严格校验。positionNoise 以有限均匀误差作为默认，不引入每帧高频颤抖。nearBestBand 默认 0.8，与第 13 章一致；竞技诊断 profile 可设 0。

lastPositions 每 3 tick 采样一次，保留最近 180 tick，最多 61 条；recentOwnResults 最多 12 条；pendingOwnResults 最多 16 条；对手冷却估计最多保留角色的 4 个 slot。reactionDelayTicks 支持 [0,30]，decisionIntervalTicks 支持 [3,12]，nearBestBand 支持 [0,1.5]；迟到信息和记忆均有固定上限。

| Profile | aggression | risk | spacing | patience | 延迟/决策间隔 tick | 位置/速度误差 | 距离 |
|---|---:|---:|---:|---:|---|---|---|
| balanced | .50 | .50 | .50 | .50 | 9 / 6 | 6 px / 18 px/s | mixed |
| pressure | .85 | .75 | .30 | .30 | 11 / 6 | 8 / 24 | melee |
| counter | .40 | .30 | .85 | .65 | 8 / 6 | 5 / 16 | mixed |
| evasive | .35 | .25 | .95 | .55 | 10 / 6 | 7 / 20 | ranged |

人格和能力水平分开调。比较 pressure/counter 的“风格”时固定相同延迟与误差，避免把反应更快误认为人格更聪明。生产配置可以采用表中初始值，但评测必须记录。

jumpPreference、skillPreference 不作为无条件加分旋钮。角色爱跳应通过空中控制、攻击几何与合适预测收益体现；否则易产生原地跳和乱放技能。

### 14.2 对手习惯

一次 encounter 定义为：从有效攻击中心距离带外进入带内，且距上次采样至少 45 tick。进入后观察最多 30 tick，将第一个可见的出招/跳跃/主动后退作为 outcome；没有则为 other。整个 episode 只记一次，避免同一个 Cast 的多个帧被统计成多次。

context 在进入时确定：任一方离地为 air，否则圆心距离≤140 为 near-ground，其余为 far-ground。主动后退要求双方距离连续 12 个源 tick 增加且对手水平速度指向远离自身，不能把我方被击退算作对手后退。等 sensedTick 覆盖 episode 的 30 tick 截止时才最终记 other；不能用 nowTick 提前完成尚未看到结果的 episode。

保存最近 12 个已完成 encounter，并删除完成距现在>480 tick 的样本。只消费已送达的可见事件；启动与结束时刻用 sourceTick，不能用重复投递 tick。

对每个 context，五类结果使用对称先验 α=2：

~~~text
p(outcome | context) = (count(outcome, context) + 2) / (N(context) + 10)
~~~

N<4 时只使用默认威胁模型；N≥4 时允许根据后验调整假设权重/possible-basic likelihood，每项相对基础值最多 ±0.15。总权重再归一。记忆只影响估计与候选价值，不新增“读心反制”按钮。

自己动作的结果在看到结算事件以后才写入 recentOwnResults。对于结束但尚未收到延迟结果的动作保持 pending；不能立即判 miss。结果窗口延伸至该 cast 最后一个投射物/计划效果结束，再加反应延迟，设项目级最长 360 tick；不得在技能飞行途中计空挥。

### 14.3 调参顺序

1. 固定 seed、无噪声，验证几何预测与真实命中是否一致。
2. 加动作承诺与迟滞，消除抖动和重复触发。
3. 加感知延迟，验证读取信息的边界。
4. 调统一收益/风险尺度，避免某一动作族始终霸榜。
5. 用相同能力水平比较人格，确认能区分进攻距离、风险和资源时机。
6. 加近优随机和有限误差，观察失败是否可解释。
7. 最后启用短期记忆，做有/无记忆对照。

禁止同时调物理、伤害、AI 权重和导演分数后仅凭几场视频得出结论。每次调参使用训练 seeds，确认后在固定留出 seeds 验证；留出集不参与参数搜索。

### 14.4 AITrace：必须能回答“为什么这样做”

每次实际决策记录：

- nowTick、sensedTick、观测 age、profile/version、decisionIndex。
- 当前执行计划、剩余承诺、模拟动作锁、允许的输入。
- 三个假设与权重、误差采样、威胁的来源和到期时间。
- 全部候选的合法性原因、D/L/P/K/X/C/E/R/B、Uraw、confidence。
- 当前续行分数、迟滞门槛、是否触发紧急/脱困、随机池与选中项。
- requestId、后续接受/拒绝/命中结果。

批量默认只保存聚合指标与输入日志；完整 trace 按 seed 或失败场景开启。日志打开与否不能影响随机数和行为。

调试视图同时画出“真实位置”和“AI 当时估计的位置”，真实信息仅供人查看，不再反馈给 Controller。通过点击一次空挥，应能看见 AI 当时认为目标在哪里、准备多久和为何分数高。


## 15. 首版角色与技能测试集

所有角色先使用同一基础移动模型。数值是调参起点；规则文本必须忠实于实际效果，不写“无限加速”“绝对反射”之类不成立的描述。

### 15.1 角色基础值

| 角色 ID | 外形 | HP | 半径 | 质量 | 恢复系数 | 速度/跳速 | Profile | 一句话规则 |
|---|---|---:|---:|---:|---:|---|---|---|
| standard | 六边形 | 100 | 32 | 1.0 | .65 | 320/620 | balanced | 近身打击与远程火球交替进攻 |
| rubber | 圆形 | 100 | 32 | .8 | .90 | 340/640 | pressure | 高速撞墙后短暂加速，最多三层 |
| iron | 方形 | 110 | 36 | 1.6 | .40 | 270/560 | pressure | 冲撞越快越痛，但起手更慢 |
| mirror | 三角形 | 95 | 30 | .9 | .65 | 320/620 | counter | 在正确时机展开屏障可反射飞行物 |

地面加速度/空中加速度沿用 1800/600。铁球的高质量影响碰撞冲量和受击，不额外偷加未说明的减伤。镜子的三角外观仍按圆碰撞。

### 15.2 公共约定

下面 S/A/R 为 startup/active/recovery tick；CD 从接受 tick 开始计时，至少覆盖 S+A+R。所有近战 hitbox 以施法者位置附着移动，offsetX 按 aimX 翻转；launchDeltaV.x 同样翻转。

默认近战半径 34、offset=(48,0)，伤害 8、击退 (500,300)、hitstun=10；可命中中心距离约 48+34+目标半径，AI 与碰撞均从该几何计算。不是“距离小于 100 自动命中”。

本章技能默认 allowedWhen=both、普通技能能量成本 0、大招成本 100；近战 movementScale=.25、投射物 .5、防御 .6、自增益大招 0，表内说明覆盖默认。未单列的 hitstun 为 10，所有非冲撞击退均按对应表值。FreeBounceFixture 因此能使用相同能力。free 状态下 facing 跟随非零 moveX；出招接受时 facing=aimX 并锁定至动作结束。估计目标与自己 x 相同时沿用当前 facing。

初始 AI 距离带（圆心距离）：melee [76,104]、projectile [220,420]、dash-hit [150,260]；defense/self-buff 沿用该角色当前主攻击距离带。角色全套远程技能都不可用时改用 melee 带。后续可按真实攻击几何和测试结果调整，但不能将距离带直接当成必中判定。

所有投射物半径 12，出生于 offset=(48,8)，水平飞行，无重力，撞墙销毁，默认寿命 90 tick。反射只作用于标记 reflectable=true 的投射物；不反射近战和全场效果。

### 15.3 标准角色

| Slot / ID | S/A/R；CD | 具体效果 | AI predictor |
|---|---|---|---|
| basic / standard-jab | 8/4/14；26 | 默认近战；movementScale=.25 | melee |
| skill1 / standard-bolt | 12/1/18；120 | 速度 720，伤害 11，击退 (420,240)，可反射 | projectile |
| skill2 / standard-push | 16/5/19；180 | 半径 42、offset=(48,0)，伤害 8，击退 (850,460)，hitstun 16 | melee |
| ultimate / standard-volley | 18/1/24；300 | tick 18/30/42 各发一弹，伤害各 8，速度 800；可反射 | volley |

volley 一旦三枚弹的任务已在施法接受时排程，仍需按 cast 是否在首次发射前中断处理：首次发射前被打断则全部取消；首次发射后剩余任务保留，角色死亡也保留。三个 hitGroup 分别编号，动作恢复至 tick 43；大招的持续发射构成可识别的弹幕节奏。

### 15.4 橡胶

被动 rubber-wall-growth：仅当墙/天花板入射法向速度≥250，且距该角色上次触发≥6 tick 时生效。层数+1，上限 3；刷新 120 tick。墙面反弹后总速度乘 (1+0.04×当前层数)，总速度仍受 1800 限制。低速落地不触发，不用接触帧刷层。

| Slot / ID | S/A/R；CD | 具体效果 | AI predictor |
|---|---|---|---|
| basic / rubber-slap | 7/5/14；26 | 伤害 7、击退 (540,340)，其他默认 | melee |
| skill1 / rubber-dash | 8/10/18；150 | 活跃开始设 vx=aimX×900；附着半径 34 的冲撞 hitbox，伤害 10、击退 (700,280)；活跃期间关闭自驱 | dash-hit |
| skill2 / rubber-cushion | 5/1/16；180 | 从 tick 5 起持续 36 tick，受伤×.6、受击击退×1.25；自身仍可被打断 | guard |
| ultimate / rubber-overdrive | 12/1/18；300 | 从 tick 12 起 240 tick，墙弹增长系数由 .04 变 .10，跳速×1.15；层数仍最多 3 | self-buff |

cushion 提供减伤但会更易弹飞，有收益也有位置代价。overdrive 不直接造成伤害；预测器用当前轨迹是否可触发墙弹与紧随的有效进攻估值，不因名字加大分。

### 15.5 铁球

被动 speed-impact 仅作用于标记 dash-hit 的活跃冲撞，不把普通身体碰撞变成无限伤害。伤害倍率=1+clamp((speed-400)/800,0,0.75)，speed 使用当前 substep 首次接触前的相对速度模长；每 cast 对每个目标一次。

| Slot / ID | S/A/R；CD | 具体效果 | AI predictor |
|---|---|---|---|
| basic / iron-smash | 13/5/22；40 | 伤害 11、击退 (650,330)、hitstun 14 | melee |
| skill1 / iron-charge | 18/14/24；210 | 活跃开始 vx=aimX×850；冲撞基础伤害 9，击退 (800,280)；关闭自驱 | dash-hit |
| skill2 / iron-brace | 5/1/18；180 | tick 5 起持续 42 tick，受伤×.7、受击击退×.4、移动速度×.6 | guard |
| ultimate / iron-giant | 16/1/22；300 | tick 16 起 240 tick，半径×1.35、mass×1.4、所有近战 hitbox 半径×1.25、自驱速度×.8 | self-buff |

体型变化同步修改真实身体与 PublicView，恢复时重新计算基础值。铁球伤害倍率上限、巨人效果之间如何组合必须由同一 HitSpec 编译路径给预测器和模拟器读取。

### 15.6 镜子

| Slot / ID | S/A/R；CD | 具体效果 | AI predictor |
|---|---|---|---|
| basic / mirror-jab | 8/4/14；26 | 伤害 7、击退 (480,280) | melee |
| skill1 / mirror-shard | 10/1/16；105 | 速度 820，伤害 9、击退 (400,240)，可反射 | projectile |
| skill2 / mirror-screen | 6/1/16；150 | tick 6 起持续 18 tick，外层屏障半径为身体半径+14，可反射 | reflect |
| ultimate / mirror-dome | 12/1/20；300 | tick 12 起持续 180 tick，全方向反射屏障，半径身体+24；受近战伤害无减免 | reflect |

反射屏障在投射物伤害接触前检测；以接触法线反射速度，保持速率，更改 owner 为屏障角色。自动朝原施法者拐弯的“追踪返还”不属于首版。

同一 substep 最多反射一次；刚反射后对新 owner 忽略碰撞，直到投射物圆心离开屏障半径+自身半径+1。反射后可击中原 owner，能量按新的实际伤害归属计算。超过 2 次反射按第 7 章消散。

### 15.7 内容交付顺序与扩展验证

先标准角色镜像，再标准/橡胶，再铁球和镜子。角色命名、颜色和规则说明都用内容数据配置。

后续第五角色优先做重力，但需先明确施力范围、上限和 AI 预测。时间回溯必须限定回滚哪些状态、如何处理 projectile/energy/cooldown/event 因果；MVP 不保留一个“回滚整个世界”的空接口。

## 16. Ruleset 与模式隔离

~~~ts
interface Ruleset {
  id: string;
  version: number;
  createInitialState(config: MatchConfig, content: ContentBundle): WorldState;
  capabilities(): Readonly<{ jump: boolean; horizontalMove: boolean }>;
  environmentAt(tick: Tick): Readonly<{ gravity: Vec2 }>;
  evaluateResult(state: Readonly<WorldState>): MatchResult | null;
}

interface MatchConfig {
  matchId: string;
  seed: number;
  rulesetId: string;
  rulesetVersion: number;
  arenaId: string;
  contentHash: string;
  pacing: { mode: "off" | "observe" | "pace"; profileId: string };
  participants: readonly [
    { participantId: string; characterId: string; profileId: string },
    { participantId: string; characterId: string; profileId: string }
  ];
  maxTicks: number;
}

interface MatchResult {
  matchId: string;
  reason: "ko" | "double-ko" | "timeout" | "invalid";
  winnerParticipantId: string | null;
  endedAfterTicks: number;
  remainingHp: readonly [number, number];
  diagnosticCode: string | null;
}
~~~

Fighter 为唯一正式模式。FreeBounceFixture 使用零重力、矩形封闭边界、关闭 jump，初速度设为两条固定非平行向量。使用标准角色及其空中可用能力、HP、投射物、事件和 Replay 跑完 600 tick 的隔离测试即可，不要求调成第二种可发布内容。

新增 Mode 时允许添加专用运动策略与评分参数，不承诺所有角色和 AI 权重原样复用。必须复用的是输入/事件/回放协议、资源与通用效果、批处理和导出。测试夹具不进入视频 UI 的正式模式菜单。

## 17. Replay：播放、验证与续跑分开定义

### 17.1 三类数据

| 数据 | 用途 | 保存策略 |
|---|---|---|
| InputLog + Config + Seed | 从头重新模拟并检测漂移 | 每场保存 |
| PresentationTrack + DomainEvent | 不运行 AI/物理就能播放、导出 | 入选场保存；调试可全量 |
| FullCheckpoint | 从中间 tick 继续模拟/调试 | 入选场每 120 tick 保存，可配置关闭 |

输入日志记录每 tick 的双方 I[t]，可以用持续 moveX 的 run-length encoding 压缩，但 Jump/Cast 触发必须保留精确 tick 和 requestId。播放轨迹保存 S[0] 到 S[T]，共 T+1 帧，事件属于 tick 0..T-1。

单靠周期快照与输入日志不足以让新版本模拟器正确播放旧比赛，所以正式 MP4 只消费 PresentationTrack。没有轨迹的旧日志遇到不兼容 engineBuild，必须明确报告不能重建，不能静默运行新规则。

### 17.2 状态完整性

~~~ts
interface ProjectileState {
  id: EntityId;
  ownerId: EntityId;
  sourceCastId: number;
  abilityId: AbilityId;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  expiresTick: Tick;
  reflectionCount: number;
  ignoreOwnerUntilOutside: boolean;
  hit: HitSpec;
}

interface ScheduledEffect {
  id: number;
  dueTick: Tick;
  ownerId: EntityId;
  castId: number;
  cancelPolicy: "before-first-emission" | "never";
  effects: readonly Effect[];
}

interface HitboxState {
  id: EntityId;
  ownerId: EntityId;
  castId: number;
  localOffset: Vec2;
  radius: number;
  expiresTick: Tick;
  aimX: -1 | 1;
  hit: HitSpec;
}

interface CastRuntime {
  castId: number;
  ownerId: EntityId;
  requestId: number;
  abilityId: AbilityId;
  firstEmissionTick: Tick | null;
  interruptedTick: Tick | null;
  finishedTick: Tick | null;
}

interface WorldState {
  tick: Tick;
  entities: readonly Entity[];
  projectiles: readonly ProjectileState[];
  hitboxes: readonly HitboxState[];
  casts: readonly CastRuntime[];
  scheduledEffects: readonly ScheduledEffect[];
  hitRegistry: readonly {
    castId: number; hitGroup: string; targetId: EntityId;
    lastHitTick: Tick;
  }[];
  passiveRuntime: readonly {
    entityId: EntityId; passiveId: string; nextAllowedTick: Tick;
    data: Readonly<Record<string, number | string | boolean>>;
  }[];
  combatRngState: readonly number[];
  nextEntityId: number;
  nextCastId: number;
  nextEventSeq: number;
  nextReceiptSeq: number;
  result: MatchResult | null;
}

interface Simulation {
  step(intents: readonly [ActionIntent, ActionIntent]): StepResult;
  snapshot(): WorldState;
  restore(snapshot: WorldState): void;
}

interface StepResult {
  state: Readonly<WorldState>;
  events: readonly DomainEvent[];
  receipts: readonly ActionReceipt[];
}

interface ContentBundle {
  schemaVersion: number;
  bundleHash: string;
  characters: readonly CharacterDefinition[];
  abilities: readonly AbilityDefinition[];
  passives: readonly PassiveDefinition[];
  statuses: readonly StatusDefinition[];
  profiles: readonly AIProfile[];
  pacingProfiles: readonly PacingProfile[];
  pluginVersions: Readonly<Record<string, number>>;
}

interface FullCheckpoint {
  nextTick: Tick;
  world: WorldState;
  controllers: readonly [ControllerSnapshot, ControllerSnapshot];
  pacingDirector: PacingDirectorSnapshot | null;
  publicSnapshotRing: readonly PublicSnapshot[];
  pendingSelfReceipts: readonly ActionReceipt[];
  matchConfig: MatchConfig;
  recorderCursor: number;
}
~~~

这些契约包含 MVP 已知的持续状态：能量暂停、命中体、volley 首发标记、反射忽略状态、请求/回执序号和 pending encounter。新增影响未来的字段必须同时进入 schema、snapshot/restore 与 hash。不能把字段留在不可见 class 闭包里。cast、命中登记在动作结束且其投射物、命中体和计划任务均消失后清理；AI 已保存所需结果标识，不能依赖永远不清理的世界历史。

runner 的感知 ring、Controller RNG、下一次评分时间、执行承诺、pending 行为结果和实时导演状态都属于 FullCheckpoint。恢复后从 nextTick 消费输入，不能重复播放检查点前一 tick 的事件。off 模式导演快照为 null；observe/pace 模式必须保存有效快照。

### 17.3 表现轨迹

~~~ts
interface RenderEntity {
  id: EntityId;
  characterId: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  facing: -1 | 1;
  hp: number;
  energy: number;
  actionPhase: "free" | "startup" | "active" | "recovery" | "hitstun" | "dead";
  visibleStatusIds: readonly string[];
}

interface RenderFrame {
  tick: Tick;
  entities: readonly RenderEntity[];
  projectiles: readonly {
    id: EntityId; ownerId: EntityId; abilityId: AbilityId;
    position: Vec2; radius: number;
  }[];
  visualEffects: readonly {
    id: number; ownerId: EntityId; kind: "shield" | "buff";
    position: Vec2; radius: number;
    startedTick: Tick; endsTick: Tick;
  }[];
}

interface ReplayManifest {
  replaySchemaVersion: number;
  replayId: string;
  engineBuild: string;
  rulesHash: string;
  contentHash: string;
  toolchainId: string;
  seed: number;
  tickRate: 60;
  durationTicks: number;
  result: MatchResult;
  config: MatchConfig;
  files: readonly {
    role: "content" | "inputs" | "events" | "track" | "checkpoints" | "director";
    path: string; sha256: string; bytes: number;
  }[];
}
~~~

轨迹还要保存画面确实使用的区域/屏障/特效状态；不从最新内容推断旧技能持续时间。事件保存真实命中位置和方向，不能事后用插值坐标替代打击点。

读取时验证 schema、文件长度/hash、tick 单调性、实体 ID 和有限数值。支持的旧 schema 必须显式迁移；不支持时给清楚错误。JSON 不保存 NaN/Infinity。

### 17.4 批量存储策略

第一遍每场保留配置、输入日志、全量战斗事件、分析摘要、结果与每 60 tick 的 worldHash/runnerHash；事件可 gzip。全部比赛都保存逐 tick 轨迹会增加 I/O，因此仅在筛选后，用锁定构建和输入日志重跑选中比赛生成 track。若需要 FullCheckpoint，则启用相同 Controller 重新决策，同时逐 tick 对比原输入；纯输入重放不伪造 Controller 的中间状态。

第二遍必须逐检查点验证 worldHash 与第一遍完全相同；重建 FullCheckpoint 时还必须验证 runnerHash。任何漂移都阻止导出并保存差异；禁止在最后帧强行校正成原胜负。若实测 I/O 与体量足够小，可开启全量轨迹，但不改变协议。

状态 hash 与文件 hash 统一使用 SHA-256，但输入不同：worldHash/runnerHash 使用规范化状态字节，文件 hash 使用完整文件字节。可以每 60 tick 计算而非每 tick，以降低开销；测试模式逐 tick 比较原始状态。浮点值使用可往返的标准 JSON 数值表示，不能先大幅四舍五入掩盖漂移。

## 18. 事件、统计与 Director

### 18.1 强类型事件

~~~ts
interface EventMeta {
  seq: number;
  tick: Tick;
  sourceId: EntityId | null;
  targetId: EntityId | null;
  position: Vec2 | null;
  rootEventId: number;
  parentEventId: number | null;
  depth: number;
}

interface EventPayloadMap {
  MatchStarted: { matchId: string };
  CastAccepted: { requestId: number; castId: number; abilityId: AbilityId; slot: Slot };
  CastInterrupted: { castId: number; reason: "hitstun" | "dead" };
  ProjectileSpawned: { projectileId: EntityId; castId: number };
  HitResolved: { castId: number; hitGroup: string; projectileId: EntityId | null };
  DamageResolved: { castId: number; amount: number; hpBefore: number; hpAfter: number };
  WallBounce: { wall: "left" | "right" | "floor" | "ceiling";
                incomingNormalSpeed: number; castId: number | null };
  ProjectileReflected: { projectileId: EntityId; previousOwnerId: EntityId;
                         newOwnerId: EntityId; reflectionCount: number;
                         defenseCastId: number | null };
  StatusApplied: { statusId: string; expiresTick: Tick; stacks: number };
  EntityDied: { lastDamageCastId: number | null };
  MatchEnded: { result: MatchResult };
}

type DomainEvent = {
  [K in keyof EventPayloadMap]:
    EventMeta & { type: K; payload: EventPayloadMap[K] }
}[keyof EventPayloadMap];
~~~

根据实际功能补充 Jumped、ShieldAbsorbed、StatusExpired、ActionRejected 等事件时，必须为每个事件定义 payload 与可见性。没有结构化定义的 metadata:any 禁止用于业务统计。

ActionSelected/UtilityTrace 是调试记录，不属于战斗事件。DamageResolved 是 HP 伤害的唯一统计来源；HitResolved 只表示命中，不能同时给同一次攻击累计两次伤害。墙弹保留最近一次有效击退的 castId，超过 60 tick 清空归因。

### 18.2 交锋分段与去重

有效交锋段定义：从一次 cast 累计实际 HP 伤害≥1，或一次拦截原本会在 30 tick 内命中目标的反射/防御开始；最后一个有效互动后间隔>90 tick 则结束。持续伤害按 cast 累计达到阈值才产生有效标记，交锋起点回指该 cast 第一笔伤害。连续碰撞和粒子事件不延长交锋。

每个交锋段保存参与者、双方伤害、有效 castId、反射、墙弹追击、空中命中和大招。持续伤害按 (castId,targetId) 聚合；一次多段弹幕属于一个技能事件，不能把 100 个微小 tick 当成 100 次高潮。

“有效反射”的判定使用反射前一刻的投射物位置/速度和目标运动做最长 30 tick 的弹道外推，保存该近似判定与参数；不声称知道未发生世界的真实结果。只在远处反射一枚本不会命中的弹不算救命防御。防御后反击指有效防御后 60 tick 内由防御方造成 HP 伤害；空中命中要求实际命中时至少一方 grounded=false。第一版不实现昂贵 NearMiss 检测，不把缺少证据的擦边作为加分项。

### 18.3 InterestingScore v1

先做硬过滤：invalid、重放 hash 漂移、缺文件、超时、时长<8 秒，不进入正式候选。8～20 秒与 45～60 秒的正常 KO 保留，但时长分降低。平局可作为单独模板内容，默认生产只选 KO。

定义各归一化量均在 [0,1]：

- E：有效交锋数 / 10，截断到 1。
- C：发生墙弹后 60 tick 内由原击退者追击命中的交锋段数 / 3，截断。
- I：包含有效反射、防御后反击、空中命中的交锋段数 / 4，截断；一个段只计一次。
- U：双方至少产生伤害、防御或已验证位置收益的大招施放数 / 2，截断；空放不计。
- V：有效普通攻击以外的不同 abilityId 数 / 5，截断。
- B：双方造成伤害较小值 / 较大值；都为 0 时为 0。
- F：KO 时胜者剩余 HP 比例 h≤.35 时，1-h/.35；否则 0。
- R：最终胜者曾落后 HP 比例差的最大值 / .35，截断；最大落后≥.15 且此后造成有效伤害才记分。
- T：时长 d∈[20,45] 时为 1；8～20 线性从 0 到 1；45～60 线性从 1 到 0。
- N：非交锋总 tick 占比中超过 .25 的部分 / .50，截断。
- Q：无效重复施法数 / 所有施法数，零分母取 0。
- S：最长无有效互动区间超过 180 tick 的部分 / 360，截断。

~~~text
InterestingScore = clamp(
  16E + 10C + 12I + 12U + 8V + 8B + 8F + 8R + 18T
  - 15N - 10Q - 15S,
  0, 100
)
~~~

正权重总和 100。所有 feature 与子分项写入结果文件，scoreVersion 独立版本化。长度、大招次数与低血量都只给有上限的贡献，不能无限刷分。

评分是首版排序假设，必须与人工观感对照。训练期抽取至少 30 场，分别混入高分、中分、随机场次，打乱标签做成对偏好判断；若高分组没有优势，修改特征再测，不能仅不断加重“命中数”。

### 18.4 Top K 的多样性

按分数排序后逐个接受，额外限制同一 matchup、同一胜者、相似终结方式的占比。每场建立签名：按时间排列的最多 12 个交锋标签与决定性 abilityId；同 matchup 且签名完全相同只保留最高分。

同一 matchup 默认最多 2 场进入一次 10 条生产队列；当输入只有一个 matchup 时放宽并在清单注明。不要为了凑 K 输出失败或低质量内容：候选不足就返回实际数量与原因。

Director 是纯赛后函数：

~~~ts
interface MatchAnalysis {
  matchId: string;
  result: MatchResult;
  durationTicks: number;
  exchanges: readonly ExchangeSummary[];
  metrics: Readonly<Record<string, number>>;
}

interface ExchangeSummary {
  id: number;
  startTick: Tick;
  endTick: Tick;
  damageByParticipant: readonly [number, number];
  effectiveCastIds: readonly number[];
  effectiveAbilityIds: readonly AbilityId[];
  wallChase: boolean;
  effectiveReflect: boolean;
  defenseCounter: boolean;
  airborneHit: boolean;
  effectiveUltimateCount: number;
}

interface RankedMatch {
  matchId: string;
  scoreVersion: number;
  score: number;
  features: Readonly<Record<string, number>>;
  eligible: boolean;
  rejectionReasons: readonly string[];
  signature: readonly string[];
}

interface Director {
  evaluate(analysis: MatchAnalysis): RankedMatch;
}
~~~

上面的 Director 接口负责赛后评分和筛选。实时节奏调节采用下节的 PacingDirector，配置、提示与状态均有版本和回放记录；它通过有界评分修正影响 Controller 的选择。导演不修改 HP、伤害、冷却、能量、随机种子或胜负结算。

### 18.5 实时节奏导演 PacingDirector

目标是让比赛过程中更容易出现有效接近、交锋、变化与有作用的大招。它关注一段时间内的节奏，Utility AI 继续负责当前局势下的具体动作选择。

典型场景：双方已 3 秒没有有效交锋，导演短暂鼓励能缩短有效攻击距离的候选；双方反复使用同一无效动作，导演略微降低该动作的倾向；大招长期蓄满且存在有效使用机会时，导演提高这一机会的选择权重。

这项能力列入 MVP，安排在基础 Utility AI 与四角色稳定后的 Phase 3B。阶段产物包括可开关的实现、导演调试视图、回放支持和效果评测。首版不根据预定胜者安排比赛，也不要求每场都发生逆转。

#### 18.5.1 观察与更新频率

导演每 30 tick 更新一次；开局前 120 tick 保持中立。输入仅包含公共快照与已成熟的公开事件，其观察延迟为双方 reactionDelayTicks 的最大值再加 1 tick。这样提示依据的局势已经能够被双方感知。

Runner 先保存 S[t] 的公共快照，再运行到期的导演更新；新提示 earliest applyTick=t+1。在构造 Observation 时，只有 nowTick≥applyTick 且 sensedTick≥basedOnTick 才放入 directorCue。双方收到相同提示，按相同公式处理；角色之间的差异来自自身可见状态与能力。

导演不得查看未来输入、真实敌方冷却、Controller 候选分数、私人记忆或未成熟事件。自身体感即时反馈仍按第 9 章处理。导演自身不使用随机数，开关诊断日志不能改变其输出。

每次更新消费从上次已读源 tick+1 到本次成熟截止 tick 的全部快照，不能只读每隔 30 tick 的单帧而漏掉中间事件。公共 ring 容量至少为 max(64,导演观察延迟+sampleIntervalTicks+2)；成熟区间有缺帧时报告异常，不能偷偷补当前状态。

公共窗口保留最近 360 个源 tick，记录双方伤害、有效反射/防御、公开施法、位置和能量 ready 状态。有效伤害采用累计实际 HP 损失≥1 的规则。无效施法只在公开时序与其可见效果均结束后确认，不能提前把飞行中的弹体计为空放。PublicProjectileView.sourceCastId 连接公开施法、投射物和命中。

#### 18.5.2 三种提示及有界作用

| 提示 | 初始触发条件 | 对合法候选的作用 |
|---|---|---|
| engage：恢复交锋 | 成熟观察中连续 180 tick 没有有效互动 | 仅给处于有效攻击距离带外、预计能缩短与距离带差距的候选加分，最多 +1.2 |
| vary：减少无效重复 | 最近 180 tick 内同一角色同一 slot 最近 3 次已结束使用均无效，且最近 60 个成熟源 tick 没有有效互动 | 对自己对应的近期无效重复候选增加最多 0.6 的成本；有效连续进攻不受影响 |
| showcase：把握大招机会 | 任一角色公开能量持续 ready≥180 tick，且当前未处于刚发生有效互动后的 60 tick 保护期 | 对自身已经合法的大招候选最多 +0.8，且其预测 D>0、有效减伤≥2 HP 百分点或 setupValue≥0.5 至少满足一项 |

同时满足条件时按 engage、vary、showcase 顺序选一种。提示持续 120 tick：前 30 tick 线性增至强度 1，中间 60 tick 保持，末 30 tick 降至 0；结束后至少 120 tick 中立，每场最多 6 次提示。已触发的提示采用固定时间包络，不随每个碰撞反复开关；真实危险和动作合法性仍由 AI 每次判断。

AI 先计算含自身脱困的基础分 Ubase，再计算 DirectorDelta，最后以 Ubase+DirectorDelta 进入原有承诺、迟滞与随机选择。导演没有新增合法动作，也不能绕过 hitstun、Recovery、最短动作承诺或反应延迟。

具体幅度：

~~~text
engageDelta = intensity × 1.2 × clamp01(distanceBandGapImprovement / 120)
varyDelta = -intensity × 0.6 × clamp01(recentConfirmedMissesForSlot / 3)
showcaseDelta = intensity × 0.8 × hasEffectiveUltimateOpportunity
~~~

engage 仅在当前位置位于当前可用主攻击距离带外时计算。正向加分仅适用于 Ubase≥UbaseBest-1.2 的候选，且该候选的 deathLikelihood 不高于当前续行估计超过 0.05；不会把明显不合算的冲锋提升成优选。紧急生存判定照常优先。

recentConfirmedMissesForSlot 只统计该 slot 最近一次有效使用之后、180 tick 窗口内的连续已确认失误；出现有效命中/防御/位移则归零。导演 vary 与原有 R 分别记录，再按总成本上限合并。

自身脱困与 engage 的接近加分总和上限为 2.5；自身 R 与 vary 的重复成本总和上限为 1.0。trace 同时保留截断前后值，避免两个系统反复惩罚同一失败。赛后 InterestingScore 不进入实时公式；“精彩分高”本身不构成出招收益。

#### 18.5.3 接口与可重放状态

~~~ts
type DirectorCueKind = "engage" | "vary" | "showcase";

interface PacingProfile {
  id: string;
  version: number;
  sampleIntervalTicks: number;
  initialQuietTicks: number;
  noInteractionThresholdTicks: number;
  repeatedMissThreshold: number;
  readyHoldThresholdTicks: number;
  cueDurationTicks: number;
  rampTicks: number;
  neutralBetweenCuesTicks: number;
  maxCuesPerMatch: number;
}

interface DirectorCue {
  id: number;
  kind: DirectorCueKind;
  issuedTick: Tick;
  basedOnTick: Tick;
  applyTick: Tick;
  expiresTick: Tick;
  profileId: string;
  profileVersion: number;
}

interface DirectorPublicSample {
  tick: Tick;
  fighters: readonly PublicFighterView[];
  projectiles: readonly PublicProjectileView[];
  events: readonly PublicEvent[];
}

interface PacingDirectorSnapshot {
  version: number;
  mode: "observe" | "pace";
  nextUpdateTick: Tick;
  nextCueId: number;
  emittedCueCount: number;
  neutralUntilTick: Tick;
  currentCue: DirectorCue | null;
  recentPublicSamples: readonly DirectorPublicSample[];
  lastConsumedEventSeq: number;
  lastConsumedSnapshotTick: Tick | null;
  lastEffectiveInteractionTick: Tick;
  readySinceByEntity: readonly { entityId: EntityId; sinceTick: Tick | null }[];
  pendingPublicCasts: readonly {
    castId: number; actorId: EntityId; abilityId: AbilityId; slot: Slot;
    firstSeenTick: Tick; latestPossibleEffectEndTick: Tick;
    effective: boolean;
  }[];
}

interface PacingDirector {
  update(maturedSnapshots: readonly PublicSnapshot[], nowTick: Tick): DirectorCue | null;
  snapshot(): PacingDirectorSnapshot;
  restore(snapshot: PacingDirectorSnapshot): void;
}
~~~

窗口按源 tick 淘汰，最多 361 帧；pendingPublicCasts 上限 64，保留至其公开效果结束并完成结算。readySince 与最后有效互动时间单独保存，防止仅靠短窗口丢失长等待信息。所有派生缓存均可从已保存状态重建。

update 返回当前有效或等待 applyTick 的提示，无提示时返回 null；每个 cueId 只写一条 issued 记录，淡出/结束另记状态变化。PacingProfile 数值均为有界整数，rampTicks×2≤cueDurationTicks；本版生产初值使用上文常量，变更提升 profile version。

为保持角色原生 AI 的可测试性，配置提供三个模式：off 完全关闭；observe 计算并记录提示但不交给 Controller；pace 实际启用修正。模式在创建比赛时冻结，运行中改变模式创建新的 runId 并从头模拟。

导演记录单独保存为 director.ndjson.gz，包含提示、触发证据、应用区间与终止原因。它属于 Runner 记录，不计入伤害、交锋或精彩度事件。FullCheckpoint 保存 PacingDirectorSnapshot，runnerHash 包含该状态；worldHash 仍用于权威战斗状态比较。

输入回放直接消费已记录意图，不重跑导演；从检查点继续 AI 对战时恢复导演状态。旧 schema 缺少 pacing 字段的已支持回放显式迁移为 off，不能自动套用新导演。生产模式必须标明是否开启节奏导演及其版本。

#### 18.5.4 验证是否真的更精彩

工程场景必须覆盖：冷场达到阈值才触发；持续有效交锋保持中立；有效重复攻击不被误罚；大招无作用时不获加分；提示不能解除动作锁；导演看不到尚未成熟事件；提示次数/持续时间/淡出上限；提示在双方使用相同规则；off 与 observe 的逐 tick 输入一致；pace 同 seed 重跑和检查点续跑一致。

在 200 个固定 matchup/seed 配置上分别运行 off/pace，共 400 次成对执行，保持角色、AI、初始随机流与工具链一致。开关导演允许比赛轨迹和胜负自然变化；不要求两种模式 hash 相同。原有 800 场 Utility 基线统一使用 off，导演开关对照另出报告。

比较最长/平均冷场区间、有效交锋占比、无效重复、空挥、比赛时长分布、大招有效率、双方伤害参与度、观众偏好及运行开销。初始改进目标为冷场区间 p90 下降至少 20%，同时无效出招和一边倒比例不恶化；这些是待实测目标。

至少抽取 20 对 off/pace 回放，隐藏模式并随机呈现顺序，记录观看者对节奏和可读性的偏好。人工偏好、指标及未达项一同报告。生产默认是否启用 pace 依据该验证结果决定；效果不足时回到阈值、幅度或触发条件调整，不能仅凭赛后分数升高宣称导演有效。


## 19. 批量模拟、任务恢复与产物

### 19.1 批量执行

Node worker_threads 适合 CPU 密集的 JavaScript 工作；使用常驻 worker 池，避免每场新建线程。默认 worker 数为 max(1,min(4,availableParallelism()-1))，允许 CLI 覆盖。模拟和视频编码分别限流，默认不并行占满全部 CPU。[Node Worker Threads 文档](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html)

一场比赛完全由一个 worker 顺序执行。禁止把同一场双方 AI 分到异步 worker 竞速返回。worker 返回结果顺序不影响 matchId、seed、排名或去重；排名同分按 matchId 排序。

父进程先生成完整任务列表及种子，再分派任务。失败重试最多一次，使用原 matchId/seed/config；再次失败保留 failure，不用新 seed 替换成功率。用户取消时完成当前文件的原子写入，未完成任务标为 pending。

### 19.2 任务状态机

~~~text
pending → simulating → simulated → ranked
                              ↓
                         not-selected
ranked → selected → rebuilding-track → ready-to-render
       → rendering → encoding → verifying → complete

任一阶段 → failed（保存 stage、errorCode、message、diagnosticPath）
~~~

每个阶段成功后先写临时文件、flush/close，再在同一卷 rename 为最终文件，最后更新任务清单。恢复时验证已有产物 hash；存在一个 MP4 文件不表示任务 complete。

同一 jobId 由一个父进程持有独占锁。启动发现旧锁时检查进程与清单状态，明确恢复，不同时写同一结果目录。

### 19.3 目录与命令契约

~~~text
artifacts/<batchId>/
  batch.json                 配置、toolchain、任务状态
  rankings.json
  matches/<matchId>/
    manifest.json
    content.json
    inputs.ndjson.gz
    events.ndjson.gz
    checkpoints.ndjson.gz    入选场，可关闭
    track.ndjson.gz          入选场
    analysis.json
    hashes.json
    ai-trace.ndjson.gz       可选
    director.ndjson.gz       实时导演提示和触发证据
  exports/<renderJobId>/
    render-job.json
    frame-%06d.png           编码验证成功后可清理
    audio.wav
    video.mp4
    verification.json
~~~

后续实现提供等价 CLI：

~~~sh
npm run simulate -- --a standard --b rubber --seed 17
npm run batch -- --a standard --b mirror --count 200 --seed 1000 --workers 4
npm run rank -- --batch artifacts/example --top 5
npm run render -- --batch artifacts/example --selected --preset vertical-1080
npm run verify -- --batch artifacts/example
~~~

命令示例是入口契约，不要求这些文件目前存在。参数校验失败应在模拟前退出；CLI 返回非零退出码代表失败，部分成功时输出完成/失败/跳过数量。所有报告含规则、内容、AI、分数与工具链版本。

## 20. Renderer 与离线视频导出

### 20.1 唯一渲染输入

~~~ts
interface PresentationSample {
  simTimeTicks: number;
  frameBefore: RenderFrame;
  frameAfter: RenderFrame;
  alpha: number;
  activeVisualEvents: readonly DomainEvent[];
}

interface RenderStyle {
  id: string;
  version: number;
  width: number;
  height: number;
  fps: number;
  visualSeed: number;
}

interface Renderer {
  prepare(content: ContentBundle, style: RenderStyle): Promise<void>;
  draw(sample: PresentationSample, videoTimeSeconds: number): void;
}

interface RenderJob {
  id: string;
  replayId: string;
  replayManifestHash: string;
  rendererVersion: string;
  templateId: string;
  fps: 60;
  width: 1080 | 720;
  height: 1920 | 1280;
  timeline: readonly TimelineSegment[];
  totalFrames: number;
  toolchainId: string;
}

interface TimelineSegment {
  startFrame: number;
  endFrameExclusive: number;
  sourceStartTick: number;
  sourceEndTick: number;
  kind: "intro" | "battle" | "hold" | "outro";
}
~~~

Renderer 没有 stepSimulation()。prepare 一次性加载字体、音频与资源，draw 是由输入决定的纯绘制；禁止在 draw 内调用 Date.now、setTimeout 或推进随机源。

在两个轨迹帧之间线性插值位置和速度；出生/死亡/瞬移类不连续状态使用边界切换，不跨越跳变插值。MVP 没有瞬移能力，但轨迹协议保留 discontinuity 标记的扩展位置。

粒子、拖尾、闪光由事件年龄计算，不能只依赖“上一帧积累”，确保从任意视频帧开始导出都一致。拖尾可回看固定长度轨迹。hitstop 是视频时间线的 hold，不冻结或改变模拟 tick。

### 20.2 初始视觉与包装

1080×1920 布局：上方角色名称、规则说明和 HP；中部完整固定竞技场；下方能量、大招提示和胜负。重要文本距离外缘至少 72 px。720 预览按相同比例缩放。

标准角色偏蓝、橡胶偏橙、铁球偏灰金、镜子偏紫；同角色对战用轮廓与标记区分。色彩不作为唯一身份标识。基础 FX：命中闪白、击退拖尾、墙弹火花、反射闪环、大招提示、KO 定格。

默认视频时间线：开场 1 秒；完整战斗；结束 1.5 秒。首版仅 KO 插入 6 帧 hold；不开任意自动剪切与全局慢动作。通过基本导出验收后，可按事件增加最多 3 次、每次 3 帧的 hitstop，总额≤0.5 秒。

模板只能读取真实事件生成固定格式文案，例如“A 反射了 B 的火球”。不从比分臆造“读心”“绝地翻盘”；翻盘文字必须符合第 18 章逆转定义。自动标题/解说 LLM 延后。

### 20.3 时间映射与音频

每个输出帧 n 的视频时间为 n/60。TimelineSegment 使用半开区间 [startFrame,endFrameExclusive)，所有段连续且不重叠。battle 段把输出帧线性映射到源 tick；hold 段 sourceStartTick=sourceEndTick。

一个 DomainEvent 只生成一次主音效，音频时间取源 tick 第一次跨过事件边界的输出时刻；hold 的重复帧不重复触发。片头片尾没有新的模拟 tick。音效计划在导出前一次性生成，不用浏览器实时录音。

首版使用本地固定的少量 hit、wall、reflect、ultimate、KO 音效，统一采样率 48 kHz，混成长度与视频相同的 WAV；生成静音底轨以保证无事件时也有完整音轨。叠加使用固定增益并检查 clipping，不能随运行环境的音量改变输出。项目保存素材来源与版本，选择自制或已具备使用许可的素材。

### 20.4 导出链路

1. 校验 Replay 和 RenderJob，计算 totalFrames。
2. 启动锁定 Chromium，viewport 与视频分辨率一致、deviceScaleFactor=1。
3. 打开本地导出页并等待 document.fonts.ready、图片解码和 prepare 完成。
4. 逐帧调用 renderFrame(n)，等待 draw 完成；只截取 canvas 区域，写 frame-000000.png 起始的连续 PNG。
5. 可从最后一个完整、校验通过的 PNG 之后恢复；不跳过中间缺帧。
6. 生成 audio.wav，调用 FFmpeg 编码，随后 ffprobe 和抽帧验证。
7. 原子移动最终 MP4，标记 complete；验证成功后才可清理中间帧。

Playwright 提供页面/元素截图 API；本方案使用显式帧驱动，不依靠真实时间播放或屏幕录制速度。[Playwright Screenshots](https://playwright.dev/docs/screenshots)

首版以逐帧 PNG 的可靠性为优先。1080p PNG 序列可能占用数 GB，运行前预估空间并限流为一个渲染任务。性能达不到第 24 章目标时，再把 PNG 写盘改为有背压的 image2pipe；不能通过丢帧提升速度。

~~~sh
ffmpeg -framerate 60 -start_number 0 -i frame-%06d.png -i audio.wav \
  -map 0:v:0 -map 1:a:0 -c:v libx264 -preset medium -crf 20 \
  -pix_fmt yuv420p -c:a aac -ar 48000 -b:a 192k \
  -movflags +faststart -shortest video.mp4
~~~

上式仅为参数说明。实现使用 child_process.spawn 的参数数组，不拼接 shell 字符串，支持 Windows 中文和空格路径。运行前检查 libx264、aac 编码器存在，记录 ffmpeg -version。FFmpeg 的图片序列输入与编码参数见[官方手册](https://ffmpeg.org/ffmpeg.html)。

验证：分辨率、像素格式、编码器、音轨存在、帧率与预计总帧数匹配；音视频时长差≤1/60 秒（允许按容器/编码采样边界解释并记录）。源帧无缺号，开头/中间/KO/结尾至少各抽一帧人工检查。ffprobe 提供媒体流与容器信息；不要把“命令退出 0”当作全部验证。[ffprobe 文档](https://ffmpeg.org/ffprobe.html)

硬件编码可在后续作为速度选项；首版固定软件编码输出路径，避免不同 GPU 的编码能力成为首个工程阻塞。

## 21. 调试 Editor

Editor 服务调试与选片，不做完整内容创作平台。需要两个页面入口：交互调试器、无控件的导出页；它们共享 Renderer。

必须提供：

1. 角色/Profile/seed 选择；开始、暂停、单 tick、倍速与重置。
2. 实时模式与 Replay 模式清楚区分；旧回放显示原版本，不读取最新配置替换。
3. hitbox/hurtbox、速度向量、地面接触、动作阶段、HP/能量/冷却覆盖层。
4. AI 面板：真实与感知位置、候选分项表、当前承诺、迟滞门槛、威胁与选择原因。
5. 事件时间线与逐事件跳转；Cast 的接受→命中/失误关联。
6. 单场分析的交锋分段、InterestingScore 分解与入选/排除原因。
7. 载入 Replay、同轨迹切換视觉模板、发起本地导出任务并查看进度。
8. 导出“最小失败包”：match config、content hash/快照、seed、输入、错误 tick、trace。

9. 导演调试面板：赛前选择 off/observe/pace，显示延迟观察窗口、当前提示、强度包络、触发原因、剩余持续/中立时间；候选表显示 Ubase、DirectorDelta 与最终分数。
10. 从导演提示时间线跳转到对应回放位置，成对查看相同 seed 的 off/pace 比赛。该面板用于调试实时导演，属于既有 Editor 的一部分。

实时修改 Profile 仅用于新比赛；正在运行的比赛修改时应创建新的 runId 并从头重启，不让一场比赛的配置前后不一致。比赛中临时调试开关不进入核心状态；若开关确实影响逻辑则必须作为配置记录。

## 22. 验证方案：先验证正确，再验证有效

### 22.1 确定性与基础规则

| 测试 | 做法 | 通过条件 |
|---|---|---|
| 重复运行 | 4 角色全部无序对阵（含镜像，共 10 组），每组 20 seeds，各跑两次 | 全部逐检查点 hash、事件、结果相同 |
| worker 一致性 | 同一任务清单 workers=1 与 4 | 输入/状态/结果/排名一致 |
| 日志不扰动 | trace 开/关、预览开/关 | 权威输出一致 |
| 输入重放 | 不运行 Controller，仅重放输入 | 逐 tick 状态与事件一致 |
| 检查点恢复 | 在 120、240、终局前检查点恢复 | 与不中断运行后缀一致 |
| 高速命中 | 对向高速移动、小半径弹体、墙角、完全重叠 | 无穿透/NaN/无穷事件 |
| 同 tick 交换 | 双方致命攻击同 tick 生效 | double-ko，不偏袒实体顺序 |
| 反射 | 正向/斜向、屏障边界、双镜面 | 正确归属、最多 2 次、无无限循环 |
| 能量与被动 | 多段、溢出伤害、墙面静止接触 | 不重复计能量，不刷被动 |
| 模式隔离 | FreeBounceFixture 600 tick | 无地面/Jump 假设渗入公共层 |
| 旧回放 | 更新角色 JSON 后加载保存轨迹 | 画面与结果使用原内容 |

fixtures 保存预期数据与版本。改变规则后不能无解释“更新所有快照让测试过”；报告哪个行为变化、为何变化和哪些基线被重建。

### 22.2 AI 场景测试

场景可注入确定的 Observation 序列，不依赖真实对手 AI 恰好演出某种行为。默认关闭噪声/近优随机，固定相同能力水平；同时检查评分关系和实际执行结果。

| 场景 | 预期行为与证据 |
|---|---|
| 距离很远、只有近战可用 | 接近的评分优于原地连续挥空；3 秒内进入可攻击距离 |
| 敌人近距离 Recovery，窗口足够 | 可命中普通攻击优于等待；不会因高伤害但慢前摇技能错过窗口 |
| Recovery 太短或敌人已离开 | 不机械地因 Recovery 标签强行惩罚 |
| 刚在真实世界出现新投射物 | 感知延迟到期前行为与“未出现”分支一致，自身状态相同时逐 tick 输入相同 |
| 投射物延迟可见且逼近 | 可行躲避或反射降低预测 L，保护动作在合法窗口执行 |
| 来袭时间短于反射前摇 | 不把来不及完成的反射算成功免伤 |
| 对方只有近战、没有飞行物 | mirror-screen 不因 defense 标签反复空开 |
| 技能在冷却或自身处于 hitstun | 不发送对应新 Cast；无隐藏缓存 |
| 两个方向分数小幅交替 | 无外部事件时 1 秒内方向翻转≤2 次；不每次决策反转 |
| 身处墙边且后退无空间 | 不持续对墙走 2 秒；合法接近、跳跃或防御能够胜出 |
| 敌方高速墙弹 | 根据延迟估计预判交点，不追逐真实下一帧位置 |
| 低 HP 可撤退且可实质免伤 | 风险规避 profile 相对 pressure 更倾向生存 |
| 敌方残血但我会更早死亡 | 死亡风险进入比较，不能只看到斩杀奖励 |
| 大招满能量但无作用目标 | 不空放；有合适机会且等待成本降低后能释放 |
| 长恢复与短恢复攻击 | H 外恢复风险生效，长动作不会靠截断窗口获利 |
| 反复同一接近后动作 | 至少 4 个独立 encounter 后估计小幅改变；不在第一次就读心 |
| 日志额外读取、候选枚举换顺序 | 排序规范化后结果与 RNG 不变 |
| 所有候选分数为负 | 选合法最佳动作；不是永远 Idle |
| Jump/Cast 触发保持多个 tick | 只消费一次 requestId，不连续跳或重复扣能量 |

公平性测试必须保持自身输入与自身状态相同，仅改变未观察到的对手信息。若新投射物已真实打中自身，允许自身 HP/hitstun 不同带来反应，不能把合理体感误判为泄漏。

### 22.3 对战基线与指标

ScriptedController 至少两个：

- RushBaseline：每 12 tick 根据同样延迟 Observation 向目标移动，普通攻击合法且估计在范围内就触发。
- RangedBaseline：保持公开火球的距离带，合法时发射；墙边反向；不使用真实对手状态。

Utility、脚本都用相同战斗能力与感知预算，不能通过给基线禁用技能制造优势。脚本必须能调用角色两技能与大招的简单合法规则，具体规则固定版本，防止评测时悄悄削弱基线。

评测清单：4 角色×2 基线×50 seeds×2 换边=800 场，使用同角色镜像以隔离数值差异；另做 10 组角色 matchup×20 seeds 的观赏性/稳定性集。训练与留出 seed 列表分开，至少一半作为留出。

报告：胜/负/平、胜率的 Wilson 95% 区间、普通攻击空挥率、技能有效率、方向翻转率、贴墙停滞比例、首次有效交锋时间、有效交锋占比、大招满能量等待时长、无效请求率、平均预测耗时。胜率定义为获胜场数/总场数，平局单列而不记半胜；无效场不计入胜率并作为硬失败另报。

初始行为目标：无效请求率<1%；可接近的场景首次交锋 p90<4 秒；无威胁下持续卡墙>2 秒的比赛<1%；普通攻击空挥率<45%。这些目标用于定位问题，不能靠禁止出招或拉长等待“优化统计”。

Utility 对 RushBaseline 的胜率点估计目标≥60%，同时报告区间，不要求每角色都达到同一数值。胜率、观赏性、角色风格分开报告；胜率高但一直逃跑的版本不能直接批准为生产配置。

### 22.4 消融与人工评估

至少对比关闭以下单个模块的版本：预测、迟滞、感知延迟、短期记忆。记录胜率和行为指标变化。短期记忆如果没有改善且增加调试成本，可以在 MVP 默认关闭，但其接口与场景测试仍保留；不以“有记忆”作为必然更聪明的证据。

固定同一角色对战、相同 seeds、相同反应水平，盲看 pressure/counter 两组，每组至少 10 场。记录进攻距离、技能等待、主动追击比例，确认风格区别不是噪声。

人工观赏性评测至少检查：1～2 秒能否理解角色差异；命中与失误是否读得懂；墙弹是否形成追击；大招是否清楚；节奏是否出现无意义停顿。由内容负责人决定是否进入扩角色阶段，不能用 TypeScript 测试通过替代这一步。

## 23. 分阶段实施计划与停止条件

### Phase 0：可复现骨架

实现单 package、模块依赖、schema、内容 hash、PRNG、tick 定义与工具链锁。最小 CLI 输出固定 seed 的 600 tick 状态 hash；建立 canonical serialization。

验收：同输入重复运行一致，配置错误有具体路径提示。此阶段不做完整 Editor 或复杂技能系统。

### Phase 1：两名角色的可视战斗

标准与橡胶；圆形运动、跳跃、普通攻击、火球、冲撞、墙弹；ScriptedController；Canvas 固定镜头；输入重放。先用普通攻击与一个技能跑通，再加第二技能和大招。

验收：能完整从开始到 KO/超时；击飞与墙弹可读；高速攻击不会明显穿透；保存输入后可复现。同 tick 交换与命中去重测试通过。

### Phase 2：Utility AI 核心

实现延迟 Observation、联合候选、预测器、统一评分、执行锁/承诺/迟滞、trace。先无噪声再加入近优随机；加入两个 Profile。短期记忆最后接入。

验收：第 22.2 节关键场景全部通过；一场空挥可以从 trace 解释；没有读取真实对手状态的导入/引用。若战斗观感差，优先修预测、角色射程和动作节奏，不增加新角色掩盖问题。

### Phase 3A：四角色与内容稳定

加入铁球和镜子、反射、状态叠加与 4 名角色全部技能；完善人格和记忆；执行基线、换边与稳定性评测。

验收：角色机制可辨识；4 角色全部组合无模拟错误；高频碰撞不刷能量/被动；FreeBounceFixture 通过。记录待调数值与实测结果。

### Phase 3B：实时节奏导演

实现第 18.5 节的公共节奏观察、engage/vary/showcase 提示、有界 Utility 修正、导演面板、配置版本、提示记录和检查点恢复。先实现 observe 验证触发，再启用 pace 验证行为变化。

验收：导演信息边界、幅度/次数上限、动作锁和确定性通过；完成 200 配置×off/pace 的 400 次执行与至少 20 对回放盲评；用数据说明是否减少冷场并改善可读性。原生 Utility 基线保持 off，以便分清导演的影响。

### Phase 4：视频生产完整流程

表现轨迹、独立 Replay 播放、赛后 Director 评分、Top K、worker 池、任务恢复、逐帧导出、音效与 MP4 验证；同时保存 Phase 3B 导演配置和记录。

验收：一条命令从批次配置生成至少 3 个通过检查的竖屏 MP4；模拟/导出被中断后可从有效阶段恢复；同回放无需调用 AI 即可换模板导出。

### Phase 5：性能与内容验收

运行标准 benchmark、留出集、评分盲评和视频人工检查。修复明确瓶颈，记录性能及局限。产出至少 10 条用于实际反馈的成片，包含至少 3 组不同角色对阵。

验收：第 24 章全部工程硬门槛通过；内容评审结果如实记录。不承诺平台流量表现，也不以“能生成 MP4”声称产品方向已验证。

实施者每阶段交付：运行命令、代表 seed/Replay、测试结果、关键变更、未解决问题。不得跳过前一阶段的硬门槛，把核心漂移和 AI 信息泄漏留到最后。

## 24. 性能预算与 MVP 验收清单

### 24.1 性能测量方法

基准固定 Node/toolchain、content、seed 清单与机器信息；预热 10 场，计时至少 100 场。分别测只模拟、模拟+AI、模拟+记录、渲染、编码。报告中位数/p95、峰值 RSS、总模拟 tick 和墙钟秒。

仿真速度=累计 simulatedSeconds / wallSeconds。不能用“200 场里多数 5 秒就死”说明引擎处理 45 秒比赛很快；另加固定 2700 tick、不提前终止的性能夹具。

初始目标：单 worker 带 Utility AI 与输入记录≥20 倍实时；默认 4 worker 吞吐≥50 倍实时（机器核心不足则报告实际并解释）；完整 trace 模式单列，不要求达到生产吞吐。导演 off/observe/pace 分别测量并报告开销，生产配置以实际选用模式的吞吐为准。

预测预算：每决策≤18 个新候选×3 假设，每假设≤12 段；AI 在单场 CPU 时间中目标≤60%。达不到先剖析几何查询、分配与日志，不自动降低反应延迟或删除公平性。

离线 1080p 导出目标≤视频时长的 10 倍；这只是待测目标，PNG 和软件编码可能成为瓶颈。720p 预览优先用于调试。正式验收必须报告实际吞吐与硬件，不把估算写成实测。

### 24.2 工程硬门槛

- [ ] 四名角色、正式 Fighter 和全部内容通过 schema/语义校验。
- [ ] 固定 200 场正确性集、800 场 AI 基线集完成，无 NaN、无限循环、崩溃或文件损坏。
- [ ] 同 seed 重跑、输入回放、检查点续跑、worker 数量变化均满足声明的确定性边界。
- [ ] AI 延迟信息边界、联合动作、无重复触发、忙碌状态与紧急响应测试通过。
- [ ] 每个技能可解释预测；trace 能重现至少一个成功惩罚、一次失误、一次反射与一次脱困。
- [ ] Replay 用原配置播放；新版本不兼容时显式失败，不静默改结果。
- [ ] Director 的所有子分项可解释；重复伤害与无效碰撞不刷分。
- [ ] 实时 PacingDirector 的触发、幅度、信息边界和回放正确，400 次开关对照与至少 20 对盲评结果已记录。
- [ ] 批量任务取消/失败/恢复可用，seed 不因失败而更换。
- [ ] 无 AI/物理参与的独立渲染可以完成视频，字体/画面/音轨正确。
- [ ] 至少 10 条正式规格视频，至少 3 组对阵，抽帧与观看均无明显漏帧、错位或音效重复。
- [ ] README 说明环境、命令、工具链、输出目录、内容编辑、失败诊断与已知限制。
- [ ] 观赏性评审和性能报告与工程结果分开记录。

行为目标与性能目标未达标时，可以提交可运行结果，但必须标出差距，不得在交付中写“MVP 全部验收通过”。如果机器能力限制视频吞吐，允许记录工程限制；不能缩短比赛、丢帧或降低正式输出规格而不说明。

## 25. 实施过程中允许调整与必须保护的约束

可通过有记录的实验调整：伤害、速度、前摇/恢复、初始 Profile、Utility 权重、导演权重、视觉颜色和音效增益。每次内容/AI 配置变更提升对应版本与 hash；规则时序变化提升 rulesVersion。

必须保护：

1. Simulation 与 Renderer 分离，正式视频消费轨迹。
2. 双方同一 tick 的决策都来自尚未应用任一方意图的状态。
3. AI 仅使用允许观察的数据，延迟与记忆可验证。
4. 战斗状态、Controller 状态、感知历史和 RNG 都能序列化。
5. 候选在统一尺度上比较；动作触发、持续移动与执行锁明确。
6. 模拟、筛选、导出均有可恢复产物；失败不能被换 seed 掩盖。
7. 赛后 Director 只做评分；实时 PacingDirector 通过已记录的有界候选修正影响决策，不改战斗数值或胜负规则；内容统计保留未筛选样本。
8. 每个新机制都有真实效果、AI 近似、回放表示与测试，四者同时交付。

如果实现发现这些决策存在实际矛盾，先给出能重现矛盾的最小场景，再修改规格与代码。不要把“后续可能用到”作为增加通用框架、复杂 DSL 或更多服务的理由。

最终成功标准仍然是：以可控制的制作成本，持续生成观众能够看懂、愿意看完的规则对抗短视频。代码正确、可复现和可解释，是快速检验这一目标的基础。
