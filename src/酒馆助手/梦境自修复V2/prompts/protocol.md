本次任务仅返回所启用模块的结果，不继续发展剧情。格式补全输出：<dream_append_format>需要追加的格式内容</dream_append_format>。内容修复输出：<dream_self_check><review>逐项结论与补丁编号</review><patch>补丁</patch></dream_self_check>。每种结果标签只输出一组，并完整闭合。检查报告中的原文引用不属于待修复目标。

补丁可采用以下格式，字段各占一行，多个补丁之间用空行分隔：

```text
FIND: 完整原文段落
REPLACE: 完整修正段落

HEAD: 原文段首文本
TAIL: 原文段尾文本
REPLACE: 完整修正段落

HEAD: 跨行原文块的起始文本
TAIL: 跨行原文块的结束文本
<REPLACE_BLOCK>
完整替换内容，可包含多行，保留所需缩进
</REPLACE_BLOCK>
```

将补丁直接写入 patch 标签，代码围栏仅用于展示协议示例。

普通段落按非空文本行划分。FIND 匹配整段；普通 HEAD/TAIL 匹配段首与段尾，并替换整段。REPLACE_BLOCK 的 HEAD/TAIL 可以跨行，替换范围包含首尾文本；FIND 也可以配合 REPLACE_BLOCK 使用。匹配文本首尾的空白可忽略，内部字符按字面匹配。使用原文片段，选取足以准确定位的首尾文本。同一补丁的多个匹配位置会全部替换。所有定位均以待修复原文为依据，不依赖其他补丁；同一区域的问题合并为一个补丁。REPLACE_BLOCK 标签独占一行，内部换行与缩进原样写入。空 REPLACE 或空 REPLACE_BLOCK 表示删除。
