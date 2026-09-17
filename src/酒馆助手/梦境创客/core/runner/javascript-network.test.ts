import { describe, expect, it, vi } from 'vitest';
import { createJavascriptNetwork } from './javascript-network';

function setup(mode: 'manual' | 'yolo' | 'full' = 'yolo', allowNetwork = true, accepted = true) {
  const controller = new AbortController();
  const requestApproval = vi.fn(async () => accepted);
  const fetch = vi.fn(
    async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  const broker = createJavascriptNetwork({
    allowNetwork,
    approvalMode: () => mode,
    baseUrl: 'https://tavern.example/',
    signal: controller.signal,
    toolCallId: 'js-1',
    requestApproval,
    fetch,
  });
  return { broker, fetch, requestApproval, controller };
}

describe('JavaScript network permissions', () => {
  it('默认权限关闭时任何请求都不发送', async () => {
    const { broker, fetch } = setup('full', false);
    await expect(broker.request({ url: 'https://api.example/data' })).rejects.toThrow('allowNetwork');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('YOLO GET 自动放行，使用无凭据且禁止重定向的请求', async () => {
    const { broker, fetch, requestApproval } = setup();
    const result = await broker.request({ url: 'https://api.example/data', method: 'get' });
    expect(new TextDecoder().decode(result.body)).toBe('{"ok":true}');
    expect(requestApproval).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example/data',
      expect.objectContaining({ method: 'GET', credentials: 'omit', redirect: 'error', mode: 'cors' }),
    );
  });
  it.each(['POST', 'HEAD'])('YOLO %s 需要逐次审批，拒绝后不发送', async method => {
    const { broker, fetch, requestApproval } = setup('yolo', true, false);
    await expect(broker.request({ url: 'https://api.example/data', method })).rejects.toThrow('用户拒绝');
    expect(requestApproval).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('手动模式 GET 也审批，完全权限模式不重复审批', async () => {
    const manual = setup('manual');
    await manual.broker.request({ url: '/data' });
    expect(manual.requestApproval).toHaveBeenCalledOnce();
    const full = setup('full');
    await full.broker.request({ url: '/data', method: 'POST' });
    expect(full.requestApproval).not.toHaveBeenCalled();
  });
  it('审批前中止不发请求', async () => {
    const { broker, controller, fetch, requestApproval } = setup();
    controller.abort();
    await expect(broker.request({ url: '/data', method: 'POST' })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(requestApproval).not.toHaveBeenCalled();
  });
  it('审批中的并发请求排队，不同时弹出确认', async () => {
    const { broker, requestApproval } = setup();
    let approve!: (value: boolean) => void;
    requestApproval.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          approve = resolve;
        }),
    );
    const first = broker.request({ url: '/one', method: 'POST' });
    const second = broker.request({ url: '/two', method: 'POST' });
    await Promise.resolve();
    await Promise.resolve();
    expect(requestApproval).toHaveBeenCalledOnce();
    approve(true);
    await first;
    await second;
    expect(requestApproval).toHaveBeenCalledTimes(2);
  });
  it.each(['file:///etc/test', 'https://user:password@api.example/'])('拒绝危险 URL %s', async url => {
    const { broker, fetch } = setup();
    await expect(broker.request({ url })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
