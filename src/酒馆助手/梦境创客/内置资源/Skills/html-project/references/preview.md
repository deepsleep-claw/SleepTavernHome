# 预览与测试

预览不会修改真实聊天。调用者可提供 `inputText` 和不超过1MB的JSON `data`。

预览环境会注入只读对象：

```js
window.__DREAM_CREATOR_RENDER_ENV__ = Object.freeze({
  preview: true,
  renderId,
  sourceType,
  inputText,
  data,
});
```

MVU界面应先检查这个对象；真实酒馆环境再等待 `waitGlobalInitialized`，不要在预览里假定MVU变量已经存在。
