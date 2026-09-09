# MVU 版本与使用形态识别

MVU 指 MagVarUpdate 框架。角色卡中常见的“旧版”“新版”“Zod版”不总是框架的精确发布版本：还可能指模型更新协议和是否接入 Schema。识别结果应分别记录运行时来源、协议和 Schema，而不是凭一个名称推断全部。

## 可识别的形态

| 形态 | 主要证据 | 维护资料 |
| --- | --- | --- |
| 传统命令型 MVU（旧卡常见） | 生效的提示词要求 `_.set('路径', 旧值, 新值)` 等命令；初始值可能为 `[值, 说明]` | `references/legacy/guide.md` |
| JSON Patch 基础 MVU | 生效的协议使用 `<JSONPatch>` 和 op/path/value；没有启用的 Schema 注册 | `references/json-patch/guide.md` |
| Zod 校验型 MVU | 启用脚本实际定义 Schema 并调用 `registerMvuSchema`，通常配合 JSON Patch | `references/zod/guide.md`、`references/zod/schema.md` |
| 尚未安装 | 没有运行时、初始化条目或更新协议证据 | 用户要求新建 MVU 卡时读取 `references/installation.md`，采用 Zod |
| 状态不明确 | 有脚本但未加载、有协议但没有变量，或多套生效规则互相矛盾 | 先按下方顺序诊断，不执行迁移 |

同一个框架运行时可能兼容不止一种命令语法；Zod 是校验层，并不等于另一套 MagVarUpdate 产品。精确版本只能来自已安装脚本的固定 tag/commit、明确版本声明或可信运行时信息。没有这些证据时写“框架精确版本未确认”，保留当前 URL。

## 读取角色卡时的检查顺序

1. `read_file /context/environment.md` 确认目标角色。
2. 列出 `/scripts/character/`，读取 `tree.yaml` 和候选脚本的 `info.yaml`、`script.js`。检查脚本及所在文件夹是否启用，记录导入地址。禁用的备份脚本不算生效证据。
3. 读取 `/worldbooks/bindings.yaml`，在实际绑定书中定位 InitVar、变量列表、输出格式、更新规则。名称只是线索，应读取正文及启用状态。InitVar 通常禁用但仍供初始化使用。
4. 读取输出命令：点路径 `_.set('队员.体力', 20, 18)` 属于传统命令；`{"op":"replace","path":"/队员/体力","value":18}` 属于 JSON Patch。外层 `<UpdateVariable>` 两者都可使用。
5. 搜索实际 `registerMvuSchema(...)` 调用，读取完整 Schema。仅导入库、注释提到 Zod、文件名叫 schema，都不等于注册成功。
6. 如获准读取真实聊天，检查消息变量 `stat_data` 的实际形状。变量可能来自旧聊天，不能只凭 InitVar 文件推断当前值。两元素数组也可能是合法业务列表，应与该字段的初始化说明对应。
7. 记录结论后选择上表的维护资料。需要界面时再结合 `mvu-frontend` 或 `tavern-helper-regex`；需要查签名时读取 `tavern-helper-api`。这些 Skill 不能代替版本识别。

## 证据冲突

先排除禁用脚本、未绑定世界书、注释和历史样例。只有两套实际生效的协议要求相互冲突，才按混合状态处理。报告冲突文件、字段形状和预期更新语法，请用户确定维护基线。

维护旧卡时，新增字段不自动升级框架；维护 JSON Patch 基础卡不自动接入 Zod。迁移须覆盖初始化、全部使用路径、输出协议、前端和旧聊天状态，不是替换一条 import。

接口依据可查 `tavern-helper-api/references/types/iframe/exported.mvu.d.ts`；上游框架说明见 https://github.com/MagicalAstrogy/MagVarUpdate 。URL 中的分支名只能作为来源线索，实际协议仍以卡内资源为准。
