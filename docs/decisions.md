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
