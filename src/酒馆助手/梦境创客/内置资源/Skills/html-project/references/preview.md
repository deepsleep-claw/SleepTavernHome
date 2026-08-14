# 预览与测试

预览不会修改真实聊天。调用者可提供 `inputText` 和不超过1MB的JSON `data`。
预览框默认使用透明背景；若作品需要特定底色，可在 `prepare_render` 里用 `backgroundCss` 提供应用到
`html` 与 `body` 的CSS声明，例如 `background: #101418; color-scheme: dark;`。不要仅为填满预览框而给页面设置固定高度。

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
