# Phase 3 · 四角色与实时导演汇总

日期：2026-10-02。P3-01～P3-13 已完成，G3A 与 G3B 工程出口均通过；总开发进度 39/54。当前构建 `phase3b-v1`、AI `utility-v3`、实时导演配置 `gentle-v1` v1，生产默认 pacing **off**。

[Phase 3A](./phase-3a.md) 实现四角色 16 槽、速度增伤、巨人、反射、公平脚本基线和模式隔离。冻结时 192 项测试、200 配置正确性、800 场公平基线及 384 次消融通过；53.30% 普攻空挥仍高于目标，大招稀少、记忆收益和风格观感尚未证实。旧构建内容、800 场回放/runnerHash 与原证据保持。

[Phase 3B](./phase-3b.md) 实现公开延迟导演、三类有界提示、完整恢复/输入重放、调试时间线、同 seed 对照与 20 对匿名包。277 项测试、400 次正式配对执行、54 次提示阶段恢复、944 次未来 hash 核对、CLI/浏览器/旧构建检查通过。冻结源代码、数据和文件摘要分别保存在 [3A evidence](./phase-3a-evidence.json) 与 [3B evidence](./phase-3b-evidence.json)。

导演冷场 p90 5.117→4.983s，仅缩短 2.61%，未达到 20% 目标。无工程 invalid/拒绝出招，一边倒 8.5%→8.0%，但重复无效攻击 442→458，大招有效率 65.38%→57.69%；不能宣称总体节奏/观看效果改善。两个阶段的空挥率采用不同对手与样本，不能直接作前后效果比较。

H2、四角色风格和实时导演 20 对观感仍待人工评审。工程出口通过与效果/人工结果分别记录；按计划可以继续 Phase 4 生产链路工程，并冻结采用 off。下一任务 P4-01 为正式 ReplayManifest、多文件/gzip/hash/schema 读取；批量选片、FFmpeg、正式 MP4 和最终效果校准尚未完成。

```powershell
. .\scripts\use-node.ps1
npm.cmd run dev
npm.cmd run verify:phase3b
npm.cmd run review:pacing
# http://127.0.0.1:5176/
```
