# MVU前端生命周期

建议入口维护一个全局实例槽：再次挂载先调用旧实例的 `dispose()`。`dispose()`至少清理事件监听、订阅、interval/timeout、observer、未完成fetch及DOM节点。

预览分支必须独立：存在 `window.__DREAM_CREATOR_RENDER_ENV__?.preview` 时，不等待真实MVU初始化，不向角色变量写回，只使用注入的 `data` 和 `inputText`。

## 读取当前楼层

真实酒馆界面的初始化流程：

```js
$(async () => {
  const preview = window.__DREAM_CREATOR_RENDER_ENV__;
  if (preview?.preview) {
    render(preview.data ?? {});
    return;
  }
  await waitGlobalInitialized('Mvu');
  const messageId = getCurrentMessageId();
  const data = Mvu.getMvuData({ type: 'message', message_id: messageId });
  if (!data?.stat_data) {
    render({});
    return;
  }
  render(data.stat_data);
});
```

`render` 是工程自己的渲染函数。先定义它，并用 `textContent` 等方式展示数据；初始化未完成时给出可识别的等待状态。旧版运行时若没有 `Mvu` 接口，则按旧版维护资料通过消息变量读取。

## 订阅和写回

事件名称与回调参数按当前 `exported.mvu.d.ts` 和已有代码确认。`eventOn` 的返回对象调用 `stop()` 清理；监听器要绑定当前楼层，不能把下一楼的数据无条件显示到旧楼界面。

`Mvu.parseMessage(text, oldData)` 用于试算并返回新数据；如确实要写回，使用 `Mvu.replaceMvuData(newData, { type: 'message', message_id })`。写回前重新读取当前数据，处理 Schema 校验错误，避免拿初始化时的旧快照覆盖后续变化。

切换聊天、卸载界面或重复挂载时，调用原实例的清理函数。异步等待完成后检查实例是否仍有效，避免已卸载界面再次写 DOM。预览验收和真实聊天验收分别进行。
