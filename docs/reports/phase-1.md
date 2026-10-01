# Phase 1 验收报告

- 日期：2026-10-01，Asia/Shanghai。结论：**G1 通过，P1-01～P1-09 完成**。
- 分支：`codex/phase-1`；基线：`be0d8d9`；构建：`phase1-v1`；content/world/replay schema：2。
- 实现提交：`c8094148d22ff452029bb65ab0b5dfbef802a59d`。精确证据：[phase-1-evidence.json](./phase-1-evidence.json)。规则接口补充：[D0004](../decisions.md)。

## 当前可见结果

浏览器中可以观看标准/橡胶及同角色对战。标准使用蓝色六边形、橡胶使用橙色圆形，A/B 标签区分同角色。页面显示 HP、能量、技能冷却、动作阶段、墙弹层数和场上事件；前摇、攻击范围、受击数字和击退轨迹可见。

可开始、暂停、单步、0.5/1/2/4 倍速，切换 seed、角色和脚本对手，开启碰撞圆/速度向量覆盖层。可以完整观看或快速结束比赛，再重播/拖动进度；导出 JSON 后重新导入会校验同构建输入重放。

这仍是脚本打法阶段。没有声称完成 Utility AI、节奏导演、四角色、完整 runner 检查点续跑或视频生产。

## 任务与证据

| 任务 | 实现入口 | 验证结果 |
|---|---|---|
| P1-01 | sim/physics/motion、math/geometry、fighter-state | 半隐式积分、四 substep、重力/Jump、真实半径贴地、自驱不截断高速击退、静止落地稳定 |
| P1-02 | sim/physics/motion、sim/fighter | 完全重叠稳定分离、相对扫掠圆、对向高速、角落/墙/地/天花板；边界 4 次预算诊断并停止剩余位移 |
| P1-03 | contracts/fighter、sim/fighter | 请求 ID 去重、回执独立序号、施法优先、接受/完成均保留、S/A/R 与 CD、零前摇、同 tick 致命交换和归一 HP 超时 |
| P1-04 | sim/fighter、contracts/content-schema、content/fighter-phase1.json | 标准四槽实际执行；18/30/42 三连射、首发前后打断、单 hitGroup 去重、实际 HP 伤害计能量、限额失败包 |
| P1-05 | sim/abilities/effective、sim/fighter、RubberRuntime | 橡胶四槽；突进 900、墙弹六 tick 间隔/三层/120 tick 刷新、排除地面、护垫减伤增击退、超弹倍率/240 tick 能量封锁 |
| P1-06 | runner/observation、ai/scripted、runner/fighter | 公共快照 ring 64、标准 9 tick/橡胶 11 tick 延迟、冷启动无敌方信息、事件白名单、回执一次交付、双方读取同一输入前世界 |
| P1-07 | replay/frame、render/canvas、web/main | Canvas 960×960 固定镜头；暂停/单步/倍速、碰撞层；桌面截图和 390px 移动布局检查通过 |
| P1-08 | runner/input-replay、cli/simulate | 同构建/内容/插件检查；输入从头重跑、全部事件/检查点/最终 hash 一致；根事件关联，CLI 失败包和导入导出验证 |
| P1-09 | scripts/verify-phase1、verify-phase1-browser | 冻结 30 配置各两次 + 30 输入重放；逐 tick 世界序列一致；8 个技能全部实际出招；观看清单、报告与 README |

## 复现

```powershell
. .\scripts\use-node.ps1
npm.cmd run verify:phase1
npm.cmd run dev
```

开发页：[竞技场](http://127.0.0.1:5173/)。Node 单场与重放：

```powershell
npm.cmd run simulate -- --a standard --b rubber --seed 17 --output artifacts\phase-1\example.json
npm.cmd run simulate -- --replay artifacts\phase-1\example.json
```

## 实测数据

- 72 项测试全部通过，包含原 Phase 0 的 44 项及 Phase 1 的 28 项；8 个测试文件。
- Node/Web 类型检查和两端构建通过；33 个源文件的模块边界通过，5 个反向依赖/随机源等反例检查仍有效。
- 开发 manifest hash：`d0d1df027f4596c20a8e9011c881f7f2147de39c028d94175f3b0342103f8bb3`，清单未修改。
- Fighter 内容 hash：`3d1813e0c317f53f637dcabcbe4e722e89142588015d615706cf41fb7650a865`。
- 30 个配置、60 次脚本执行、30 次输入重放，分别比较完整逐 tick worldHash 序列；输入、全部事件、检查点、终局一致。记录 RenderFrame 开/关不改变结果。
- 30 个开发配置全部以 KO 结束；另有双 idle、seed 17 的 3600 tick timeout，未改变开发种子选择。此数据用于工程 smoke，不能推定后续 AI 胜率或正式评测已经完成。
- 两次独立 Node CLI 进程，seed 17 的完整回放 JSON 字节一致。
- Chromium 153.0.8010.12 与 Node 24.21.0：seed 17 在 1554 tick 结束，最终 hash `5476d2b700b93d55fe3ca5c300c23b815f3b3075217ba597b687aa34d7ef9123`；seed 18 在 1359 tick 结束，hash `cf4fc348d0a536c01b7eabe598e8c575501b12e56e940b81297e9e83e02e950c`。
- Chromium 验证真实 4× 播放完成、暂停 tick 稳定、精确单步、碰撞层、角色颜色像素、本地字体、回放文件导入导出及 seek；无页面错误。
- 故意创建 33 枚投射物的 CLI 比赛返回 invalid/退出码 2，生成内容/输入/事件/有限状态的失败包，并可输入重放得到相同诊断。
- Phase 0 原始 601 帧序列 hash 与最终 hash 保持原值；其独立进程报告文件 hash 仍为 `25c7931d256fb3b79726fbe904279c2c5cc88dc5b31411cab73a321514170385`。

## 观看清单

运行验收后，完整文件在 `artifacts/phase-1/replays/`；页面“导入回放”可直接选这些 JSON。也可由下列链接按同 seed/脚本生成并播放。

| 样例 | 观看入口 | 可核对内容 |
|---|---|---|
| 两名橡胶的墙弹追击 | [seed 1245564233](http://127.0.0.1:5173/?a=rubber&b=rubber&seed=1245564233&watch=1) | rubber-vs-rubber-0.json；墙弹增长后 180 tick 内同角色再次造成伤害，具体 bounceTick/damageTick 见 evidence |
| 空挥与重新接近 | 同上，按 evidence 的 misses.tick seek | 只将 damage purpose 的未命中施法记为空挥，护垫/增益不误报 |
| 标准对橡胶 KO | [seed 17](http://127.0.0.1:5173/?a=standard&b=rubber&seed=17&watch=1) | 三种标准普通攻击、橡胶突进/护垫与最终 KO；可查看完整事件日志 |
| 精确超时 | [seed 17 / 双静止](http://127.0.0.1:5173/?a=standard&b=rubber&seed=17&controller-a=idle&controller-b=idle&watch=1) | timeout-idle.json，双方 100 HP，3600 tick 判平局 |

固定镜头、身份、前摇、受击数字和调试覆盖层已通过截图检查；自然程度与脚本长期空转的细致观感调参随 Phase 2 继续。G1 不以这些脚本替代最终 AI。

## 文件和后续入口

原始证据：`artifacts/phase-1/unit-tests.json`、`boundaries.json`、`smoke.json`、`browser.json`、`browser.png`、`browser-mobile.png`、`process-a.json`/`process-b.json`、`limit.json.failure.json`。大型输入回放与图片忽略版本控制，摘要和文件 SHA-256 在 phase-1-evidence.json 中保存。

下一任务 **P2-01**：强化延迟观测、噪声与公平边界；入口为 runner/observation.ts、contracts/fighter.ts、ai/scripted.ts。随后增加感知记忆、轻量预测、Utility 评分与可解释执行。世界快照已可恢复，完整 runner 检查点仍属于 P2-10。
