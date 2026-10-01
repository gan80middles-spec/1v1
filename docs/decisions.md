# 实施决策记录

## D0001 · Phase 0 环境和工具链（2026-10-01）

- 开工时仅有两份未提交设计文档，main 尚无首次提交；origin 为原计划记录的仓库。没有发现适用的 AGENTS.md。
- 系统 Node 22.16.0/npm 10.9.2。按规格使用项目内 `.tools/node-v24.21.0-win-x64` 的 Node 24.21.0/npm 11.19.0；不修改系统安装。
- 官方 ZIP SHA-256：`158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541`，与官方 SHASUMS256.txt 比对通过。
- npm 注册表实际核对并选择 TypeScript 5.9.3、Vite 7.3.6、Vitest 4.1.11、Zod 4.6.5、@types/node 24.19.0。精确版本及传递依赖由 package-lock.json 锁定。
- Playwright 1.63.0 仅用于 P0-06 的真实浏览器 Canvas/本地字体验证；浏览器下载保存项目内缓存。FFmpeg/ffprobe 未安装，留待导出阶段。
- Node 官方：[24.21.0 发布文件](https://nodejs.org/dist/v24.21.0/)。兼容依据：[Vite 7](https://v7.vite.dev/guide/migration)、[Vitest 3](https://v3.vitest.dev/guide/)。锁定版本是本次实际选择，不声称永远最新。
- 首装 Vitest 3.2.7 时 npm audit 确认 [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)，修复下限 4.1.11。按规格允许的安全升级改用 4.1.11；npm 注册表明确支持 Node ≥24、Vite 7。升级后安装审计为 0 项漏洞。相关配置按 [Vitest 4 迁移](https://vitest.dev/guide/migration/) 删除 minWorkers。业务规则没有变动。

## D0002 · Phase 0 的可运行边界（2026-10-01）

- Phase 0 的内容为明确标记的结构夹具；四槽完整并经过语义校验，但技能不执行，不能用作正式战斗或视频。
- 最小 Simulation 只接受双中立输入，保持身体静止，按规则增长能量并在精确 maxTicks 边界结算超时。碰撞、重力、攻击、AI 和导演在各自后续任务实现；不制造假实现。
- worldHash 包含最小世界全部字段、rulesHash/contentHash。runnerHash 仅规划字段契约，完整 AI/导演状态在 P2-10/P3-11 加入。本阶段不伪造完整检查点。
- 确定性范围仍为固定构建和 Node/V8 环境；Web 用同一纯模块作对照，正式比赛以 Node 为权威。没有修改战斗规格。

## D0003 · 超时平局边界的数值表示（2026-10-01）

- 最小场景：双方 maxHp=100，一方 hp=99.5、另一方 hp=100，按规格差值恰为 0.005，应判平局。
- 直接计算 `99.5/100 - 1` 的二进制浮点绝对值略大于 0.005。实现比较 `abs(hpA*maxHpB-hpB*maxHpA)` 与 `0.005*maxHpA*maxHpB`，保留相同规则含义。
- 创建和恢复终局使用同一个 timeoutWinner；测试包含容差边界、真正超出边界和镜像平局。规则参数和规格正文不变。

## D0004 · Phase 1 的内容与输入回放契约（2026-10-01）

- 保留 Phase 0 的 schema 1 中立模拟和结构夹具；新增 schema 2 的 Fighter 世界与正式两角色内容，构建标识为 phase1-v1。原夹具的内容 hash、601 帧序列 hash 和最终 hash 均保持不变。
- 原 impulse 只有“增量速度”，无法准确表达“橡胶突进速度 900”：已有水平速度 320 时直接加 900 会变成 1220。增加可选 velocityMode=add|set-x，突进显式 set-x，其他冲量缺省 add；同步规格 §5 的 Effect 接口和测试。
- 增加可选 scheduledPolicy=cancel-on-interrupt|before-first-emission，三连射显式选后者。所有发射在施法接受时排程，首次发射后受击/死亡不取消剩余任务；首发前取消。没有按技能 ID 写隐含特殊分支。
- CastRuntime 保存接受事件的 rootEventSeq；跨 tick 的 HitResolved→DamageResolved 关联接受事件，事件及调度状态进入完整 worldHash。
- 普通内容版本、重力、速度、伤害、S/A/R、CD 和能量数值均沿用原规格。Phase 1 predictorId 是下一阶段预测器的声明式元数据；本阶段由只读 Observation 的脚本对手执行打法，不冒充 Utility AI。
- 输入回放保存同构建版本、完整内容/插件版本、双方输入、事件、60 tick 检查点与最终 hash。导入重新执行输入并校验；播放器随后只读 RenderFrame。完整 runner 检查点、轨迹生产封装和视频仍按原计划交付。
- 开发种子清单不变。30 个开发配置全部 KO；另增加 seed 17 双 idle 的超时测试样例，不把该样例混入冻结开发清单，也不为获取超时结果换 seed。

## D0005 · Phase 2 的可恢复 Utility AI 与地面支撑（2026-10-02）

- 增加 phase2-v1 / utility-v1；输入回放接受 phase1-v1 和 phase2-v1，并按保存构建选择规则。旧 Phase 1 的 seed 17/18、30 配置和 Phase 0 原 hash 回归保持一致。
- 新内容只新增 counter/evasive 人格，技能数值不变。Utility 只读当前自身与延迟公共视图，不调用真实 Simulation。每次实际决策只消耗一个 RNG uint32，固定 hash 通道派生共用误差与抽签；trace 不属于未来状态。
- FullCheckpoint 覆盖 World、控制器/RNG、观察 ring、成熟游标、待送达回执、执行/结果/encounter 记忆、配置与 recorderCursor；runnerHash 覆盖全部未来状态。可选 recording 只保存过去的输入/事件/checkpoint，排除在 runnerHash 外；CLI 携带它以生成完整续跑回放。
- Phase 1 的非零移动会改变 Cast 中的 facing，不符合规格方向锁；phase2-v1 仅 free 时跟随 moveX。Phase 1 DamagePrevented 归因到来袭攻击，phase2-v1 归因到减伤状态的 sourceCastId。公共 bounce 增加可见墙面，避免将地面碰撞算成超弹增益的有效结果。
- 最小失败来自冻结留出 seed 1780203690（standard-vs-rush-29-side-1）：落下的角色碰撞地面支撑角色，向下冲量与地面归零反复发生在同一时刻，耗尽诊断预算。phase2-v1 的法向冲量分母使用允许运动方向上的有效逆质量；支撑体保留水平运动、拒绝向地面穿入的竖直冲量。参数/恢复系数不变，旧构建保留旧求解方式。增加最小几何回归及同 seed 重跑。
- 脱困必须预测向距离带取得正向进展；按 30 tick 内进展 / 20 px 比例限制到 +2，显示独立 stuckBonus/wallCost。避免远距位置质量饱和为零时，脱困分恰好卡在移动切换门槛。风险项和动作锁仍先约束选择。
- 两角色基线仅为冻结清单的 80 场初评，普通攻击空挥率未达目标。H2 包为相同感知水平的 20 场无标签轨迹，人工结论保持待评；不宣称完成四角色评测、观感批准或视频生产。
