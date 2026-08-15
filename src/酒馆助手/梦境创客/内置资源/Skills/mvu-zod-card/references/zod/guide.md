# MVU Zod安装与维护

Zod是新建MVU角色卡的默认方案。它由MVU运行时、变量Schema注册、世界书协议和核心提示词隔离正则共同组成；缺一项都不能视为完整安装。

## 安装前检查

1. 读取 `/context/environment.md`，确认已经打开目标角色。
2. 递归列出 `/scripts/character/`，搜索 `MagVarUpdate`、`registerMvuSchema` 和 `mvu_zod`。
3. 搜索 `/regexes/character/` 中处理 `<update>` 或 `<UpdateVariable>` 的正则。
4. 列出当前 `/worldbooks/`，搜索 `[initvar]`、`[mvu_update]` 和 `变量列表`。
5. 如果没有绑定世界书，使用 `manage_worldbook` 创建并绑定；不要自行编造世界书目录或资源ID。

如果发现旧版三参数 `_.set(path, old, new)` 与成对数组式initvar，返回主Skill并走旧版路由。若新旧特征同时存在，停止写入并询问用户。

## 两个角色脚本

### MVU运行时

读取：

- `templates/zod/mvu-runtime/info.yaml`
- `templates/zod/mvu-runtime/script.js`

如果当前角色已经有导入MagVarUpdate的启用脚本，直接复用，不替换URL、不重复创建。

### 变量结构

读取：

- `templates/zod/schema-registration/info.yaml`
- `templates/zod/schema-registration/script.js`
- `references/zod/schema.md`

Schema直接写在变量结构脚本中并调用 `registerMvuSchema(Schema)`。不要只把Schema源码保存在 `/character/files/`；那里不是执行环境。

创建每个脚本时先写 `info.yaml`，等工具返回成功后重新列出 `/scripts/character/scripts/`，找到规范化后的真实目录，再写 `script.js`。最后读取 `tree.yaml`，保持其他项目不变，并确保MVU运行时排在变量结构脚本之前。

## 世界书协议

读取 `references/zod/worldbook.md` 及 `templates/zod/worldbook/`。仅创建缺失条目，不覆盖已有同用途自定义条目。

- initvar与Schema输入结构一致。
- 变量更新规则与用户要求、Schema边界一致。
- 变量列表和输出格式是固定协议，已有兼容版本时优先保留。
- 世界书文件必须遵循内置文件读写规则中的Frontmatter格式；`position`、`strategy`、`recursion`、`effect` 不能写成字符串。

## 核心正则

搜索同作用正则；如果没有，再读取 `templates/zod/core-prompt-filter.regex.yaml` 创建角色正则。它只负责让历史更新块不再进入模型提示词，不删除聊天原文，也不代替可选的显示折叠正则。

## 验收

1. 重新读取两个脚本和 `tree.yaml`，确认启用状态与顺序。
2. 重新搜索四个世界书条目并核对Schema字段。
3. 重新读取核心正则，确认 `destination.prompt: true`、`destination.display: false`。
4. 新建或使用测试聊天，让MVU初始化 `stat_data`。
5. 生成一次合法更新并核对写回；再用边界值确认Schema的转换或拒绝行为。
6. 任何一步失败都向用户报告真实错误，不伪造“安装完成”。
