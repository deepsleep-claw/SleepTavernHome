# MVU 安装操作手册

所有路径均为梦境创客 VFS 路径。永久运行的 MVU 安装在酒馆助手角色脚本库；一次性 `run_javascript` 用于计算、读取和验收，不承载永久 MVU 实例。

仅安装运行时时，完成资源识别、运行时模板写入后即可启用运行时脚本并检查加载结果。下面的 Schema、世界书和变量验收用于完整变量系统，不是单独安装框架的前置条件。

## 1. 确认当前资源

依次执行：

```json
{"path":"/context/environment.md"}
```

上面是 `read_file` 参数。然后用 `list_path`：

```json
{"path":"/scripts/character","recursive":true,"depth":3}
```

检查 `_scope.yaml` 的可用性、`tree.yaml` 和已有脚本代码。存在 `_unavailable.md` 时先解决酒馆助手或角色作用域问题。确认当前角色主世界书、附加世界书和聊天世界书：读取 `/worldbooks/bindings.yaml`，再列出实际挂载目录。

已有 MVU 运行时和兼容 Schema 时复用它们。已有卡的导入地址、版本和自定义字段是维护基线；不能仅因为模板不同就替换。

## 2. 读取模板并准备完整数据

模板根目录为 `/skills/builtin/mvu-zod-card/templates/zod/`，一次安装涉及：

- `mvu-runtime/info.yaml`、`mvu-runtime/script.js`
- `schema-registration/info.yaml`、`schema-registration/script.js`
- `worldbook/initvar.entry.md`
- `worldbook/variables-list.entry.md`
- `worldbook/update-rules.entry.md`
- `worldbook/output-format.entry.md`
- `core-prompt-filter.regex.yaml`

模板中的占位 ID 要换成唯一稳定 ID，例如由 `run_javascript` 的 `crypto.randomUUID()` 返回。Schema、初始 YAML、更新规则要使用同一套字段。Schema 是普通 JavaScript，酒馆助手提供 Zod 4 的全局 `z`；不要直接放入 TypeScript 类型标注或裸 npm 导入。

## 3. 创建角色脚本

模板默认禁用，使脚本在代码和协议齐全后再启用。以运行时为例，`write_file`：

```json
{"path":"/scripts/character/scripts/mvu-runtime/info.yaml","content":"id: mvu-runtime-demo\nname: MVU运行时\nenabled: false\nbutton:\n  enabled: false\n  buttons: []\nexport_with:\n  button: false\n  data: false\n"}
```

其中示例 ID 也需换成刚生成的实际 ID。创建后立即重新 `list_path /scripts/character/scripts`，定位这个 ID 对应的目录。系统会按名字和身份规范化目录，后续 `script.js`、`info.yaml` 必须使用返回的完整路径。`script.js` 通常已作为空文件存在，所以写入代码使用 `overwrite: true`。

将模板 `mvu-runtime/script.js` 的原始代码作为文件内容写入，不要写入 Markdown 代码围栏，也不要把导入语句放进 `run_javascript`。变量结构脚本同理：先创建禁用的 `info.yaml`，重新列目录，再覆盖该目录的 `script.js`。

变量结构入口应为：

```js
import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';
const Schema = z.object({ 世界: z.object({ 当前时间: z.string().prefault('待初始化') }) });
$(async () => {
  await waitGlobalInitialized('Mvu');
  registerMvuSchema(Schema);
});
```

这是最小可验证结构；真实字段按角色需求设计。`waitGlobalInitialized` 解决异步下载顺序，不能只依靠脚本在列表中的排列。

## 4. 创建或复用主世界书

`manage_worldbook` 的 `create` 不等于绑定。没有主世界书时：

```json
{"action":"create","name":"角色名-MVU"}
```

再读取当前绑定，保留原有附加、聊天绑定，把主世界书设为刚创建的名字。`set_binding` 的数据放在 `binding` 对象内：

```json
{"action":"set_binding","binding":{"primary":"角色名-MVU","additional":[],"chat":null}}
```

上面的空数组和 null 仅适用于原来没有相应绑定的情况。已有主世界书时优先在原书补齐条目。写条目前读取 `/skills/builtin/card-workspace-io/references/worldbooks.md`，随后向工具返回的书目录 `entries/` 写入四个模板。新文件名只需不重名；成功后重新列目录使用正式路径。

每个条目包含 YAML Frontmatter 和正文。`position`、`strategy`、`recursion`、`effect` 是对象。`[initvar]变量初始化勿开` 保持 `enabled: false`，其正文只有初始 YAML；其他三个条目启用。变量列表使用 `{{format_message_variable::stat_data}}`，不要把它改成需要其他插件的模板语法。

## 5. 正则、顺序与启用

若不存在同用途角色正则，将 `core-prompt-filter.regex.yaml` 写入 `/regexes/character/` 中的新 YAML 文件。它处理提示词，不负责显示折叠；模板的 `max_depth: 3` 只处理最近相应深度，不等于清理整段聊天历史。

脚本顺序使用 `/scripts/character/tree.yaml`。只调整目标脚本，保留其他根项目、文件夹、ID 与启用状态：

```yaml
trees:
  - type: script
    id: 实际MVU运行时ID
  - type: script
    id: 实际变量结构ID
```

上面展示两个节点的形状，不是让你覆盖整棵已有树。确认两个脚本代码完整、世界书绑定及四个条目齐全后，分别把两个 `info.yaml` 改为 `enabled: true`。文件夹本身也必须启用。

## 6. 验收和排错

先读回文件确认代码、身份和绑定，再在获准的测试聊天验收。旧聊天已有变量，不会因为修改 initvar 自动重置；需要初始化验证时新建专用测试聊天，不覆盖用户已有聊天。

`run_javascript` 的 tavern 环境使用异步接口桥：

```js
const latest = await TavernHelper.getLastMessageId();
if (latest < 0) return { ready: false, reason: '当前聊天还没有消息楼层' };
const data = await TavernHelper.getVariables({ type: 'message', message_id: latest });
return { messageId: latest, initialized: data.stat_data !== undefined, stat_data: data.stat_data };
```

真实聊天的 `stat_data` 存在后，再验证 Schema 边界及合法更新。`Mvu.parseMessage` 返回解析结果，不会自动写回楼层；只读试算不能当作真实写回成功。`run_javascript` 的全局与安装在角色脚本里的全局不同，后者可以直接调用酒馆助手函数，前者必须等待桥接 Promise。

常见错误定位：

- 找不到 `info.yaml` 或脚本目录：重新列目录，核对规范路径；不要继续沿用新建前的临时名称。
- `Cannot use import statement outside a module`：把模块代码放到角色脚本 `script.js`，不是一次性函数体。
- `Mvu` 未初始化：检查运行时启用、文件夹启用、下载地址、酒馆助手脚本日志；检查 Schema 的等待逻辑。
- `z` 或 `prefault` 不可用：核对酒馆助手环境和 Zod 4，不把 Zod 3 的示例混入。
- `stat_data` 为空：检查主世界书绑定、initvar 名称和 YAML、是否已有消息、是否在旧聊天中验收。
- Schema 拒绝：报告实际字段和错误；让初始值与规则匹配 Schema，不用直接覆盖变量来伪装初始化成功。

报告时区分“资源已写入”“脚本已加载”“变量已初始化”“真实更新已通过”。未完成的验收应明确指出。
