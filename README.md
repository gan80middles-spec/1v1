# 1v1 自动对抗短视频内容引擎

Phase 0 工程骨架已建立：严格 TypeScript、单 package ESM、内容校验、固定时钟、可序列化最小世界、版本化随机流和确定性验证。

当前只能运行明确标记的中立结构夹具：角色静止、能量按 60 Hz 增长，到指定 tick 结算超时。移动、碰撞、出招、AI、导演、正式回放和视频导出按后续阶段交付。页面上的两个圆是绘图探针，不代表角色美术已经完成。

开发顺序与唯一进度表：[开发执行计划](./开发执行计划.md)。规则依据：[实施规格](./1v1自动对抗短视频内容引擎_GPT6_Sol实施规格_v1.0.md)。验收证据：[Phase 0 报告](./docs/reports/phase-0.md)。

## Windows 安装

在项目根目录打开 PowerShell。本项目固定 Node 24.21.0 / npm 11.19.0，系统已有的 Node 22 不会被修改。

```powershell
# 首次在新机器上安装项目内 Node；已有对应 .tools 时跳过下载
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-node.ps1

# 每次打开新终端后激活本项目运行时
. .\scripts\use-node.ps1

# 用提交的 package-lock 安装依赖
npm.cmd ci

# P0 浏览器验证需要锁定的 Chromium，缓存保存在项目内
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.cache\ms-playwright'
npx.cmd playwright install chromium
```

已有缓存时，本次实际验证了 `npm.cmd ci --offline --no-audit` 从重新建立的 node_modules 安装成功。新机器的首次安装和浏览器下载需要网络。npm 11 对 esbuild 安装脚本的提示不影响本项目：Windows 平台二进制作为锁定的可选依赖安装，离线重装后的构建已验证。

完整工具链、Node 分发文件 hash、浏览器 revision 和机器实测信息见 [toolchain-lock.json](./toolchain-lock.json)。FFmpeg/ffprobe 正式导出工具留待 Phase 4；Playwright 自带的 FFmpeg 辅助程序尚未作为正式编码器验证。

## 运行

```powershell
. .\scripts\use-node.ps1
npm.cmd run build
npm.cmd run simulate -- --seed 17 --ticks 600
npm.cmd run simulate -- --seed 17 --ticks 600 --record-states --output "artifacts\中文 路径\示例.json"
npm.cmd run dev
```

开发页默认地址为 `http://127.0.0.1:5173`，提供 seed 输入、600 tick 运行和 hash 对照。CLI 的 `--help` 给出全部当前参数；seed 必须是 uint32，ticks 为 1～3600 整数。内容文件通过 `--content FILE` 指定，默认读取 `content/fixtures/phase0.json`。

成功退出码为 0，参数、内容或执行失败为 2。JSON 输出包含构建/算法版本、配置、内容/规则 hash、执行 tick、终局、每 60 tick 的检查点和状态/输入/事件序列 hash。加 `--record-states` 保存 S[0]～S[T]、全部输入和逐 tick hash；大文件存入忽略版本控制的 artifacts。

## 验证

```powershell
. .\scripts\use-node.ps1
npm.cmd run verify:phase0
```

这一命令执行 Node/Web 严格类型检查、单元测试、Node/Web 构建、模块依赖检查、两次独立进程的 600 tick 字节对照、记录开关对照、CLI 失败用例、冻结种子清单验证，以及真实 Chromium 的绘图/本地字体/Node-Web hash 验证。

独立入口：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd run check:boundaries`、`npm.cmd run test:determinism`、`npm.cmd run verify:browser`。确定性和浏览器脚本需要先构建。

结果保存在 `artifacts/phase-0/`：unit-tests.json、boundaries.json、determinism.json、browser.json、browser.png 和 `中文 路径/run-a.json`/run-b.json。种子清单验证不会重新挑选 seed，失败也不会自动替换种子。

## 模块与内容

- `src/contracts`：纯数据类型、声明式 schema 和版本；不执行比赛。
- `src/math`：canonical serialization、无 Node I/O 的 SHA-256、PRNG、种子派生、时间换算。
- `src/content`：字段/引用/时序/数值/注册约束校验，稳定 ID、只读 bundle 编译。
- `src/sim`：最小世界、60 Hz step、结束边界、world snapshot/restore/hash。
- `src/runner`：双中立输入组装和冻结评测清单定义。
- `src/cli`、`src/web`：Node I/O 与页面宿主入口。
- `scripts`：环境激活、模块边界、独立进程和浏览器验证。

结构内容有完整四槽、技能 timeline、状态/被动/Profile/竞技场 schema。predictor/plugin 注册在本阶段验证结构契约，尚无战斗或预测执行器。正式内容必须随其真实效果、预测、回放与测试一起交付。不要将 purpose 改成 production 来冒充已完成能力；当前模拟器会拒绝正式内容。

修改 JSON 后先运行相关测试；坏引用、缺槽、重复 ID、非法 tick、未知字段、越界数值会报告字段路径。内容键顺序和定义列表顺序不会改变规范化 bundleHash，效果数组保留业务顺序。时间输入用 `secondsToTicks` 编译为整数，不把浮点秒送入模拟。

`fixtures/random-v1.json` 冻结算法向量；`fixtures/seeds` 保存开发、训练、留出、导演成对和性能清单。后者是未来评测输入，尚未运行 200/800/400 场正式战斗。清单版本变更必须记入 docs/decisions.md。

## 诊断与当前限制

先看 CLI 的具体字段路径或错误信息；确定性失配定位第一个不同 tick，不修改最后状态。依赖检查失败时修复导入方向；sim 不允许导入 Node、AI、UI 或内容编译器。所有影响未来的字段必须进入声明式 schema、snapshot/restore 与 worldHash。

本阶段只有世界快照恢复。完整 Controller、感知 ring、回执和导演检查点在 P2-10/P3-11 实现；`RunnerHashInput` 只声明未来必须覆盖的组件。没有完整 Replay、worker 池或 MP4。

确定性承诺限于同构建、固定 Node/V8、相同内容/seed/输入；两种 seed 在本机 Chromium 与 Node 一致是诊断证据，不承诺跨所有 CPU/浏览器位级一致。本地字体探针只有 Latin 字形，正式中文字体和音视频编码器要在导出阶段单独验收。
