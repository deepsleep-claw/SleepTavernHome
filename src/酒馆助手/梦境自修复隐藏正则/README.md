# 梦境自修复隐藏正则

使用与梦境自修复美化正则相同的匹配范围，在组装发送给 AI 的聊天记录时移除完整 `<dream_self_check>` 块。

该正则只作用于提示词，不影响聊天楼层中自检报告的显示。

## 构建

```bash
node util/build_tavern_regexes.mjs src/酒馆助手/梦境自修复隐藏正则
```

输出文件：

```text
dist/酒馆助手/梦境自修复隐藏正则/梦境自修复隐藏正则.json
```
