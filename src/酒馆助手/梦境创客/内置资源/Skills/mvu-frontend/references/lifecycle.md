# MVU前端生命周期

建议入口维护一个全局实例槽：再次挂载先调用旧实例的 `dispose()`。`dispose()`至少清理事件监听、订阅、interval/timeout、observer、未完成fetch及DOM节点。

预览分支必须独立：存在 `window.__DREAM_CREATOR_RENDER_ENV__?.preview` 时，不等待真实MVU初始化，不向角色变量写回，只使用注入的 `data` 和 `inputText`。
