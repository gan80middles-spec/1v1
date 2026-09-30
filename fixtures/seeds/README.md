# 冻结种子清单 v1

生成定义：src/runner/datasets.ts；编码算法：fixtures/random-v1.json 与 src/math/random.ts。

| 文件 | 配置数 | 用途 |
|---|---:|---|
| dev-smoke.json | 30 | 标准/橡胶三组对阵，每组 10 seed |
| correctness-v1.json | 200 | 四角色十组，每组 20 seed，各重复两次，共 400 次执行 |
| ai-baseline-v1.json | 800 | 四角色×两基线×50 seed×换边；400 训练/400 留出，导演 off |
| pacing-pairs-v1.json | 200 | 使用相同正确性配置，off/pace 成对执行，共 400 次 |
| performance-v1.json | 110 | 预热 10、测量 100；2700 tick 固定工作量、不提前终止 |

这些文件冻结未来评测输入，不表示上述比赛已运行。Phase 0 只运行中立夹具。

每个 datasetHash 是移除 datasetHash 字段后，按 canonical serialization 编码的 SHA-256。sampleIndex 定义训练/留出分组；基线换边的两次执行使用相同 match seed，AI seed 跟随 utility/baseline participantId，不随 A/B 位置变化。

验证：先构建，再运行 `node scripts/create-seed-manifests.mjs --check`。首次生成不允许覆盖文件；改变数据定义需提升版本、保留失败 seed 并明确记录原因。`--replace` 仅用于已记录的清单版本变更。
