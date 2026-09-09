# 旧版MVU角色卡维护

本参考只用于维护已经存在的旧版MVU卡，禁止用它创建新卡。

## 识别特征

- 模型输出使用 `<UpdateVariable>...</UpdateVariable>`。
- 更新命令常见为 `_.set('路径', 旧值, 新值); // 原因`。
- `[InitVar]`或`[initvar]`正文把变量写成 `[初始值, 更新条件]` 成对数组。
- `stat_data`中的字段可能保留上述成对数组，`display_data`记录本轮变化。
- 没有 `registerMvuSchema` 变量结构脚本，也没有Zod JSON Patch输出协议。

单独出现标签名不足以判断版本；必须结合更新命令、initvar结构和脚本一起判断。

## 维护规则

### 维护前读取清单

先读 `references/versions.md`，确认当前使用传统命令协议。列出并读取：运行时 `info.yaml`/`script.js`、脚本树、绑定书中的 InitVar 与输出协议、显示和提示词正则、状态栏源码，以及获准查看的消息变量。记录每个目标的真实路径、启用状态和导入来源。

当前世界书里可能混有禁用的新版测试条目。只有启用且实际绑定的协议才决定本次维护方式；不能因为搜到一段 JSON Patch 示例就擅自改写旧卡。

1. 先读取当前卡已有MVU脚本、变量正则、InitVar和输出协议，沿用现有命名、标签大小写与导入URL。
2. 修改变量时同步检查InitVar、变量说明、更新规则、状态栏读取路径和相关正则。
3. 保持三参数 `_.set(path, old, new)` 与旧版变量形状，不引入 `registerMvuSchema`、Zod默认值或JSON Patch。
4. 前端读取数组值或直接值时沿用现有安全取值逻辑，不擅自改造全部历史状态。
5. 只做用户要求的局部修改；不要借维护任务自动升级框架。

### 初始值和真实状态

旧卡常见初始结构如下，正文可能使用 JSON、JSON5 或某个版本支持的 YAML；沿用原卡实际可解析的格式：

```json
{
  "队员": {
    "体力": [20, "取值0到20；行动消耗，休息恢复"],
    "地点": ["营地", "发生移动后更新"]
  }
}
```

两项分别是值和说明。维护体力规则时同时检查原卡的更新幅度、前端读取路径和条件判断。真实业务列表也可能有两个元素，不能按数组长度批量“解包”。

InitVar 是初始化来源，不是所有聊天的实时存档。修改 InitVar 后，已有聊天的 `stat_data` 仍可能是旧值；新建测试聊天与修复已有聊天是两项不同操作。

一次性 JS 的只读检查示例：

```js
const id = await TavernHelper.getLastMessageId();
if (id < 0) return { ready: false, reason: '当前聊天没有消息' };
const data = await TavernHelper.getVariables({ type: 'message', message_id: id });
return { messageId: id, stat_data: data.stat_data, display_data: data.display_data };
```

这段代码用于 `run_javascript` 的 `environment: "tavern"`。老运行时可能不提供 `Mvu` 命名空间，此时优先读消息变量，不等待一个不存在的全局对象。

### 更新命令与语义

```text
<UpdateVariable>
<Analysis>行动消耗体力，地点保持不变。</Analysis>
_.set('队员.体力', 20, 18); // 行动消耗2点
</UpdateVariable>
```

这里的 `_.set` 是 MVU 从回复文本解析的命令，不是在浏览器直接运行的 lodash 调用。不能把这段命令送入 JS 求值器来冒充变量更新。命令的路径通常直接写字段路径；是否需要 `.0` 应以原卡已有协议和运行时为准，不根据前端的数组取值方式推断。

部分后续运行时还支持两参数 set、add、insert、delete、move；接口类型可查询 `/skills/builtin/tavern-helper-api/references/types/iframe/exported.mvu.d.ts`。类型定义描述当前接口，不证明安装的历史运行时拥有全部操作。维护古老版本时只使用已经证实支持的命令。

三参数命令中的旧值不应当作可靠的并发锁：有的版本忽略它，有的版本用于显示变更说明。写入前仍需读取当前消息状态，不能把旧值匹配当作安全校验。

### 状态栏取值

`stat_data` 用于真实值和计算；`display_data` 可能保存“旧值→新值（原因）”这样的显示字符串，不能拿它参与数值运算。

```js
function readLegacyField(value, isPairedField) {
  return isPairedField && Array.isArray(value) ? value[0] : value;
}
```

`isPairedField` 来自该字段的 InitVar/结构约定，而不是“任何数组都取第一个”。给 UI 写文本时用 `textContent`；保留业务列表、空值、零值和 false 的区别，不用 `value || 默认值` 覆盖合法零值。

### 常见维护任务

- **新增字段**：在 InitVar 增加字段及说明，补充更新规则和状态栏；说明旧聊天是否需要单独补值。
- **修改规则或上限**：改说明与生效条件，核对已有校验/回调；文字规则不会自动变成运行时硬约束。
- **字段改名**：先搜索全部点路径、前端读取、开场白更新块和阶段条件；迁移已有聊天需用户授权并保留备份，不能只改 InitVar 名称。
- **更新失效**：先看原始消息是否存在合法更新块，再检查脚本启用与日志、路径是否存在、值类型及实际楼层；不要先重装框架。
- **显示异常**：分别检查 `stat_data` 和 `display_data`、数组取值、捕获正则和 HTML 是否匹配，不能把“没有显示”直接当成“没有写入”。
- **首条消息异常**：检查初始化条目是否被实际绑定、原卡命名是否匹配、开场白是否又覆盖初始值。保留原有初始化顺序。

### 验收

使用专用测试聊天或用户明确允许的楼层。先记录旧状态，发送一个当前协议支持的最小更新，确认目标字段变化、说明项保留、无关字段不变、状态栏显示正常。测试解析结果与真实楼层写回分别记录。不要反复生成整段剧情来试错，也不要清空旧聊天。

写入失败应按路径、序列化格式、命令语法、脚本加载、初始化、显示六个环节定位。若旧版本接口或命令没有证据，报告不确定项，不拿新版用法硬套。

历史协议背景可查上游教程：https://github.com/MagicalAstrogy/MagVarUpdate/blob/master/doc/tutorial.md 。实际维护以当前卡中可运行的脚本和数据为准。

## 迁移边界

只有用户明确要求迁移到Zod时，才读取 `references/zod/` 并先给出迁移方案。迁移至少涉及脚本、InitVar、更新协议、正则、前端取值和已有聊天数据，不能当作普通格式替换。

如果同时检测到旧版和Zod核心设施，返回主Skill的“混合状态”规则，停止修改并询问用户。
