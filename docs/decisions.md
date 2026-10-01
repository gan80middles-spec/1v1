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
