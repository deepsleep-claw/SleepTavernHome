# 开场白文件格式参考

`/greetings/*.md` 的正文就是开场白内容，不需要 Frontmatter。直接新建文件时会自动追加到末尾。

需要精确控制名称或顺序时，再编辑 `/greetings/index.yaml`：

```yaml
greetings:
  - id: greeting-existing-id
    name: 初见
    file: 001-初见.md
  - id: greeting-new-id
    name: 夜谈
    file: 002-夜谈.md
```

- 已有项的 `id` 必须从当前索引原样保留，不能编造或复用。
- 新文件通常无需手填索引；若必须显式索引，先读取创建后文件的实际资源信息。
- `file` 必须对应同目录真实文件，同一文件不能重复引用。
- 删除一条开场白时同时检查索引；清空全部开场白属于高风险修改。
