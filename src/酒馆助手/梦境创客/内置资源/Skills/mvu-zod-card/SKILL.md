---
id: mvu-zod-card
name: MVU角色卡
description: 识别并维护MVU Zod或旧版角色卡；新建角色卡默认采用Zod方案。
loading: on-demand
---
# MVU角色卡

本Skill提供MVU角色卡的版本识别、核心安装模板和维护规则。Skill里的文件只是参考模板，不会自行安装；只有用户要求创建或修改MVU卡时，才通过文件工具把资源写入当前角色作用域，并遵循当前审批模式。

## 先识别版本

先查看当前角色的 `/scripts/character/`、`/regexes/character/` 和已挂载 `/worldbooks/`，不要扫描全局或当前预设作用域，除非用户明确要求。

- **Zod方案**：存在 `registerMvuSchema`、`[mvu_update]` 条目，或JSON Patch形式的变量输出协议。读取 `references/zod/guide.md`，再按需读取同目录其他资料。
- **旧版方案**：存在 `<UpdateVariable>`、三参数 `_.set(path, old, new)`、成对的 `[初始值, 更新说明]`，且没有Zod注册脚本。读取 `references/legacy/guide.md`。
- **新卡**：没有任何MVU设施，而用户要求创建MVU卡。直接采用Zod方案，不额外询问版本。
- **混合状态**：同时存在明显的新旧协议。停止修改，列出识别依据并询问用户；不要猜测或混用。

旧版卡只按原协议维护。除非用户明确要求迁移，否则禁止把旧版卡改成Zod，也不要用旧版协议创建新卡。

## Zod完整交付

创建或补全Zod卡时，核心链必须同时成立：

1. 角色MVU运行时脚本已启用，并位于变量结构脚本之前。
2. 角色变量结构脚本直接定义Schema并调用 `registerMvuSchema(Schema)`。
3. 绑定世界书包含 `[initvar]变量初始化勿开`、`变量列表`、`[mvu_update]变量更新规则`、`[mvu_update]变量输出格式`。
4. 角色作用域存在防止历史变量更新块重新进入提示词的核心正则。
5. 在真实聊天中验证 `stat_data` 完成初始化，合法更新能通过Schema，非法更新会被拒绝或修正。

不要把Schema只写进 `/character/files/`：普通文件不会执行。也不要用 `manage_html_project compile` 安装变量结构；HTML工程只编译正则。第一版Schema直接写入角色酒馆助手 `script.js`。

## 创建与修改原则

- 写入前先搜索同用途脚本、正则和条目；存在时复用，不按名称盲目重复创建。
- 已有卡保留其MVU导入地址和版本。新卡使用本Skill模板中的当前默认地址。
- 创建脚本时先写 `info.yaml`，随后重新列出目录，使用系统返回的规范化路径写 `script.js`；不要猜测创建后的目录名。
- 检查 `/scripts/character/tree.yaml`，确保MVU运行时位于变量结构脚本之前，同时保留其他脚本与文件夹。
- Schema、initvar、变量更新规则必须描述同一套字段。任何一处变更后都检查另外两处是否需要同步。
- 核心正则由AI在任务中创建；`templates/`里的YAML和JS只是可读取的模板，不是已经安装的角色资源。
- 折叠变量更新、状态栏和其他显示正则属于可选界面。需要界面时再读取MVU前端与HTML工程Skill。
- 修改旧卡时保留未知字段，Schema迁移必须可重复执行，不能静默丢弃已有 `stat_data`。

只做知识说明时不要写入任何资源。真正创建或修改后，重新读取关键文件并完成真实聊天验收，不能只凭文件存在宣称完成。
