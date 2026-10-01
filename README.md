# 1v1 自动对抗短视频内容引擎

Phase 1 已完成：标准和橡胶各有四个技能槽，可以在浏览器中完整比赛、暂停、单步、倍速、查看碰撞层、保存和导入输入回放。Node 使用同一战斗核心进行权威模拟。

当前打法是基于延迟公共感知的脚本对手；完整 Utility AI 从 Phase 2 开始。导演、镜子/铁球、批量视频生产和 MP4 导出按后续阶段交付。

开发顺序：[开发执行计划](./开发执行计划.md)。规则：[实施规格](./1v1自动对抗短视频内容引擎_GPT6_Sol实施规格_v1.0.md)。验收：[Phase 1 报告](./docs/reports/phase-1.md)、[Phase 0 报告](./docs/reports/phase-0.md)。

## 在 Cursor / PowerShell 中启动

在 `E:\1-1` 打开终端：

```powershell
. .\scripts\use-node.ps1
npm.cmd run dev
```

打开 [竞技场](http://127.0.0.1:5173/)。选择角色/打法/seed 后点“重置比赛”，再点“开始”。“暂停”保持当前 tick；“单步”前进一个 tick；“运行到结束”快速得到结果。比赛结束后可以重播、拖动回放进度、保存 JSON，或导入已保存的回放。

工程基线保留在 [Phase 0 页面](http://127.0.0.1:5173/phase0.html)。默认端口被占用时以 Vite 实际打印的地址为准。

## 首次安装

项目锁定 Node 24.21.0 / npm 11.19.0；系统 Node 不会被修改。

```powershell
# 已有 .tools 对应版本时跳过第一行
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-node.ps1
. .\scripts\use-node.ps1
npm.cmd ci

# 浏览器验收需要 Chromium；实际浏览器缓存保存在项目内
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.cache\ms-playwright'
npx.cmd playwright install chromium
```

精确依赖由 package-lock.json 锁定。工具链、机器信息、Node ZIP hash 和浏览器版本见 [toolchain-lock.json](./toolchain-lock.json)。已有缓存的离线安装在 Phase 0 验证过；新机器首次安装需要网络。FFmpeg/ffprobe 留待视频导出阶段。

## Node 模拟与输入重放

```powershell
. .\scripts\use-node.ps1
npm.cmd run build
npm.cmd run simulate -- --a standard --b rubber --seed 17 --output artifacts\phase-1\my-match.json
npm.cmd run simulate -- --replay artifacts\phase-1\my-match.json

# 可控对手与精确时间上限
npm.cmd run simulate -- --a rubber --b standard --seed 18 --controller-a rush --controller-b idle --ticks 1200

# 保留原 Phase 0 中立夹具命令与原 hash
npm.cmd run simulate -- --seed 17 --ticks 600 --record-states --output "artifacts\中文 路径\示例.json"
```

指定 `--a` 或 `--b` 启用 Fighter，两角色为 standard/rubber，默认时间上限 3600 tick；不指定角色则使用 Phase 0 中立夹具，默认 600 tick。打法为 rush/ranged/idle。`--content FILE` 可指定内容，`--help` 显示参数。seed 必须是 uint32，ticks 必须是 1～3600 的整数。

Fighter 默认将回放写到 `artifacts/phase-1/replays/`。JSON 保存构建、内容/插件版本、配置、全部输入与事件、每 60 tick 检查点和最终 worldHash。导入从初始状态只用输入重跑，校验检查点、结果和事件，然后用缓存 RenderFrame 播放。

成功退出码为 0，参数/内容错误及 invalid 比赛为 2。invalid 比赛额外写 `输出路径.failure.json`，含完整内容、当前有限状态、输入、事件和诊断。过多实体/派生效果不会被悄悄丢弃；边界接触预算则按规格诊断并停止该 substep 的剩余位移。

## 验证

```powershell
. .\scripts\use-node.ps1
npm.cmd run verify:phase1
```

这会执行 Node/Web 类型检查、72 项测试、构建、33 个源文件的依赖边界检查、Phase 0 原 hash 回归、30 个冻结开发配置各两遍、全部输入重放和逐 tick 世界序列比较，以及 Chromium 控件/像素/字体/回放导入导出和 Node/Web 一致性验证。包括一份故意超投射物限额的 CLI 失败包，以及双 idle 超时样例。

结果在 `artifacts/phase-1/`；小型验收快照保存在 [phase-1-evidence.json](./docs/reports/phase-1-evidence.json)。截图、完整回放和大型输出忽略版本控制，可以由验收命令重新生成。独立命令：`typecheck`、`test:phase1`、`build`、`test:phase1-smoke`、`verify:phase1-browser`；后两项需要先构建。

## 模块与后续工作

- `contracts`：数据类型、严格 schema、版本与公共感知契约。
- `math`：规范化 JSON、SHA-256、随机流、时间与相对扫掠几何。
- `content`：声明式内容编译、引用/时序校验、注册插件和稳定 ID。
- `sim`：固定 tick / 四 substep、圆碰撞、动作时间轴、命中/能量/状态/终局及完整世界快照。
- `ai`：只消费 Observation 的脚本控制器；不依赖 sim 或真实敌方状态。
- `runner`：先取同一个世界的双方感知，再求输入；延迟公共快照、回执投递与输入回放校验。
- `replay` / `render`：只读帧适配和固定镜头 Canvas 绘制；绘制模块不执行战斗。
- `cli` / `web`：Node 文件 I/O 和浏览器控件。

`content/fighter-phase1.json` 是两角色战斗内容，schema 2；`content/fixtures/phase0.json` 保留为 schema 1 结构夹具。predictorId 的声明式提示将由 Phase 2 实现预测与评分。反射机制在 Phase 3 加入；当前编译器会拒绝未实现的反射和其他被动，避免静默忽略效果。

`fixtures/seeds/` 的 5 份冻结清单保持不变。本阶段运行的是 30 场开发 smoke，尚未执行后续 200/800/400 场正式评测。完整 AI/感知/导演的 runner 检查点续跑、生产轨迹文件、worker 和视频仍按计划推进。

确定性范围为同构建、固定 Node/V8、相同内容/输入。当前 Chromium 和 Node 对照通过，不承诺所有 CPU/浏览器都位级一致。本地字体探针仅含 Latin 字形；正式中文字体与视频编码器在导出阶段单独验收。
