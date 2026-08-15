# Zod变量Schema

Schema是MVU运行时真正执行的变量契约，不只是给模型阅读的说明。`registerMvuSchema(Schema)`会把它用于变量初始化、类型校验、默认值、边界转换和更新后的数据检查。

## 编写原则

- Schema必须能反复解析自己的输出：尽量满足 `Schema.parse(Schema.parse(value))` 与第一次结果一致。
- 固定字段使用 `z.object`；动态键使用 `z.record`；有限键集合优先使用枚举。
- 给可能缺失的字段提供明确默认值或 `prefault`，但不要用默认值掩盖真正的数据错误。
- 数值可使用 `z.coerce.number()` 后再通过 `transform` 或边界函数归一化。
- 可增长数组应设置合理上限；不要让聊天数据无限膨胀。
- `_` 开头字段视为只读派生字段，不要求模型更新。
- `transform`必须幂等，不得每次解析都累加、随机生成或依赖当前时间。
- 修改旧Schema前先读取现有 `stat_data` 形状；新增字段、改名和类型变化要考虑旧数据迁移。
- 不静默删除未知数据。确需收紧结构时先向用户说明影响。

## 与其他文件同步

- `initvar`提供Schema可接受的初始输入。
- `变量更新规则`告诉模型何时、以什么范围修改字段。
- `变量输出格式`规定模型输出JSON Patch更新命令。
- 前端只消费Schema输出，不把DOM或界面临时值当成数据源。

直接角色脚本的基本形状见 `templates/zod/schema-registration/script.js`。替换其中的示例字段，而不是把示例字段带进用户角色卡。
