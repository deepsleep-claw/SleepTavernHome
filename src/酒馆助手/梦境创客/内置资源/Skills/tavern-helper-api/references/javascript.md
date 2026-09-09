# 梦境创客一次性 JS 调用

角色脚本和一次性执行器是不同环境。`.d.ts` 中的酒馆助手签名适用于真实脚本；`run_javascript` 中通过异步桥调用数据接口。

返回异步计算结果：

```json
{"intent":"验证异步计算结果并返回数值","code":"const value = await Promise.resolve(42); return { value };","environment":"sandbox"}
```

以下代码也会返回 42，而不是把 Promise 当结果：

```js
async function main() { return 42; }
main();
```

代码是函数体，支持顶层 await。末尾表达式会成为完成值；只有声明或只有 console 输出时没有返回值。需要后台定时器完成的工作应自行 await Promise；执行结束会销毁环境并取消仍在进行的请求。

读取数据：

```json
{"intent":"读取当前聊天最新楼层的变量以检查初始化结果","environment":"tavern","code":"const id = await TavernHelper.getLastMessageId(); return await TavernHelper.getVariables({ type: 'message', message_id: id });"}
```

用 `return tavern.apis` 查看可用桥接接口。`TavernHelper` 包装里的方法都需要 await，即使原 `.d.ts` 签名是同步。需要长期运行的脚本时使用角色脚本文件。

联网：

```json
{"intent":"获取任务所需的远程 JSON 数据","environment":"sandbox","allowNetwork":true,"code":"const response = await fetch('https://example.com/data.json'); if (!response.ok) throw new Error('HTTP ' + response.status); return await response.json();","timeoutSeconds":30}
```

示例 URL 应替换为任务实际来源。请求失败会拒绝 Promise，用 `try/catch` 处理实际错误。

使用 `Response.text()`、`json()` 或 `arrayBuffer()` 读取正文，使用 `response.ok` 和 `response.status` 检查 HTTP 结果。

工具返回包括 `hasResult`、`result`、`console`、`durationMs` 和 `cleanup`。函数、循环引用、BigInt 等值会转换为可传输表示，大结果会标记截断；需要原始二进制文件时使用工作区文件工具。

写入接口发生超时或连接错误后，先读回真实资源确认结果，再决定是否重试。
