# Phase 0 验收报告

- 日期：2026-10-01（Asia/Shanghai）。结论：**G0 通过，P0-01～P0-06 完成**。
- 实现提交：`a4713239b1307c31d82ab368eed5274bbab954f5`；分支 `codex/phase-0`。
- 原文档基线提交：`3ae5ecc`（main）。实施规格文件 SHA-256：`D3A987A554575FB72D3D7BA11AF4888639C32C1DC8FED66FBDC7610E0BD86271`，规则正文未修改。
- engineBuild：`phase0-v1`；工具链：`phase0-win-x64-node24.21.0`。数据证据和文件 hash：[phase-0-evidence.json](./phase-0-evidence.json)。

## 当前可见结果

CLI 从结构内容创建双角色最小世界，以双中立输入完成 600 tick，保存 601 个状态帧、600 条输入和终局事件。角色保持静止，能量按每秒 1 增长，精确到达 maxTicks 后结算 timeout，重复执行一致。

Web 入口提供 seed 输入、600 tick 运行、静态 Canvas 和 hash。Chromium 真实执行后验证了颜色像素、本地字体加载与两个 seed 的 Node/Web hash 一致，并人工检查截图排版。

当前不是可玩的战斗；物理、攻击、AI、导演、正式回放与 MP4 按后续任务交付。结构夹具不会被当作生产内容。

## 任务与产物

| 任务 | 主要产物 | 验证证据 |
|---|---|---|
| P0-01 | toolchain-lock.json、docs/decisions.md、项目内 Node 下载/激活脚本 | Node 24.21.0/npm 11.19.0、机器/仓库基线与官方 ZIP hash 已核对 |
| P0-02 | package.json/package-lock.json、Node/Web tsconfig、Vite/Vitest、README、.gitignore | `npm ci --offline --no-audit` 成功重装；typecheck/test/build 通过；CLI 与 Web 可启动 |
| P0-03 | contracts 声明式 schema、content/compile、四槽结构内容 | 内容相关 15 项测试；坏引用、重复 ID、缺槽、非法时序/数值、未注册 predictor/plugin 均报字段路径 |
| P0-04 | math/random、canonical、SHA-256、random-v1 向量、5 份种子清单、RunnerHashInput | 固定向量、Node crypto 对照、-0/非有限值、键/定义顺序、训练/留出及换边 seed 测试通过 |
| P0-05 | math/time、sim/state/step、runner/neutral、cli/simulate | 两次独立进程完整报告字节相同；world restore 后缀一致；终局/超时归一 HP 边界测试通过 |
| P0-06 | 模块边界检查、独立进程/Chromium 验证、阶段报告 | 17 个源文件通过边界检查；5 个反例验证检查器；Canvas/字体/hash 通过；导出风险如实记录 |

## 复现命令

在 E:\1-1 的 PowerShell 中运行：

```powershell
. .\scripts\use-node.ps1
npm.cmd ci
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.cache\ms-playwright'
npx.cmd playwright install chromium
npm.cmd run verify:phase0
npm.cmd run simulate -- --seed 17 --ticks 600 --record-states --output "artifacts\中文 路径\示例.json"
npm.cmd run dev
```

本次依赖已缓存后实际使用 `npm.cmd ci --offline --no-audit`，其后执行完整验证成功。CLI 额外验证了中文/空格输出路径、6 项错误参数/内容用例、记录开启/关闭不扰动，以及全部冻结清单未漂移。没有把缓存可用解释为首次安装不需要网络。

## G0 检查结果

| 项目 | 结果 |
|---|---|
| Node/Web 严格类型检查 | 通过 |
| 单元/场景测试 | 6 个测试文件，44/44 通过，0 失败 |
| Node tsc 与 Web Vite 构建 | 通过 |
| 锁文件依赖重装 | 通过；48 个包重新安装 |
| 模块边界 | 17 个文件，5 个负例，通过；sim 仅依赖 sim/contracts/math |
| 固定 seed 17，600 tick，两次独立 CLI 进程 | 601 状态/600 输入/事件/完整 JSON 文件字节一致 |
| 记录开关 | 状态序列与终局 hash 一致 |
| 世界快照恢复 | 从 tick 120 续跑的全部后缀 hash 一致 |
| 冻结清单 | dev 30、correctness 200、baseline 800、pacing 200 配置/400 次、performance 110；5 份 hash 核对通过 |
| 浏览器 | Playwright 1.63.0、Chromium 153.0.8010.12/revision 1243，真实验证通过 |
| 字体 | IBM Plex Mono Regular 本地 TTF 加载成功，OFL 许可随文件保存；不代表中文导出已验收 |

seed 17 的代表性证据：

```text
contentHash       4aba9b5cc636680d7b3174e6e2dcd72ed576e2780faa93f431522f92620010d5
rulesHash         66ea96581c98c9d1c26d6f3f06049d4ca84e1fa77e4af059102b1a626a98903d
stateSequenceHash ed6bef5db8dbe685b57769975e7a178221779b6247fb0d5c08155d3615f8b0aa
finalWorldHash    a6de98e7d34e9210ab249df0228e4fc06c0252e1d30f6ae96722b94d1f946601
fullReportSHA256  25c7931d256fb3b79726fbe904279c2c5cc88dc5b31411cab73a321514170385
```

大型原始结果在 artifacts/phase-0，按计划不提交；小型证据摘要、清单 hash 和可复现命令随本报告提交。重新执行测试时带时间戳的 unit-tests.json/截图可能有新的文件 hash，权威状态序列 hash 应保持一致。

## 环境、变更和局限

机器为 Windows 10.0.26100 x64，Intel Core Ultra 7 265K，20 个逻辑核心，34,049,359,872 字节物理内存。系统 Node 22.16.0 保留，项目内运行 Node 24.21.0/V8 13.6.233.17-node.53。完整参数见工具链锁。

本次唯一依赖版本调整：初装 Vitest 3.2.7 的审计确认了已知 mocker 问题，改用兼容 Node 24/Vite 7 的修复版 4.1.11；升级安装审计为 0 项问题，原因已记录在 decisions.md。构建时 Zod 两处 PURE 注释被 Rollup 忽略并移除，仅影响第三方注释处理，类型检查与运行均通过。

正式 FFmpeg/ffprobe 未安装，libx264/AAC 未验证。Playwright 下载的 FFmpeg helper revision 1011 不作为正式导出工具链。中文字体、视频编码和性能目标留待指定阶段，不宣称已通过。单线程 20 倍/4 worker 50 倍实时等目标没有在中立夹具上测量或冒充正式 benchmark。

完整 runnerHash、AI/导演检查点、感知延迟与 worker 一致性均未实现，本阶段仅规划其输入契约。未来种子清单已经冻结，但 200/800/400 次正式战斗评测尚未执行。

Git 提权写入时因仓库所有权与当前用户不同，需要对当前命令设置 `-c safe.directory=E:/1-1`；没有修改全局 Git 信任设置。代码和文档只保存本地提交，没有推送或合并。

## 下一入口

下一任务：**P1-01**，从 src/sim/step.ts、src/sim/state.ts、src/math/time.ts 开始，落实圆形运动、半隐式积分、自驱、阻尼、重力、Jump/grounded 和四 substep。现有中立夹具保留为独立测试基线；正式 Fighter 通过独立 rulesetId 引入。
