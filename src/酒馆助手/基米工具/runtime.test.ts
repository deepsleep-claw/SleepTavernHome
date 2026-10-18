import { afterEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_KEY } from '../../../projects/tool-output-bridge/src/shared/config';
import { encodeEvent, SseDecoder } from '../../../projects/tool-output-bridge/src/shared/sse';
import { SettingsSchema, SETTINGS_KEY, requestConfig } from './config';
import { createHelperFetch } from './fetch';
import { createJimiRuntime } from './runtime';
import { initializeSettings, readSettings, saveSettings } from './settings';
import { installEvents, installVariables } from './test-helpers';

afterEach(() => vi.unstubAllGlobals());

it('persists the switch and complete configuration only in this script variable namespace', () => {
  const variables = installVariables({ other: { value: 7 } });
  const settings = saveSettings({
    enabled: true,
    promptMode: 'user',
    promptDepth: -1,
    api_key: 'not-a-setting',
    googleMode: 'interactions',
  });
  expect(settings).not.toHaveProperty('api_key');
  expect(settings).not.toHaveProperty('googleMode');
  expect(variables.get()).toEqual({ other: { value: 7 }, [SETTINGS_KEY]: settings });
  expect(
    variables.scopes.every(
      scope => JSON.stringify(scope) === JSON.stringify({ type: 'script', script_id: 'jimi-script' }),
    ),
  ).toBe(true);
  variables.set({ ...variables.get(), [SETTINGS_KEY]: { ...settings, enabled: false, promptDepth: 2 } });
  expect(readSettings()).toMatchObject({ enabled: false, promptDepth: 2 });
  const before = variables.get();
  expect(() => saveSettings({ ...settings, promptDepth: 1.5 })).toThrow();
  expect(variables.get()).toEqual(before);
});

it('imports extension settings on first use and keeps existing script variables on subsequent loads', () => {
  const variables = installVariables({ unrelated: 9 });
  const readPreset = vi.fn(() => ({
    prompt: '现有提示词',
    promptMode: 'assistant',
    promptDepth: -1,
    outputPath: 'text',
  }));
  const context = {
    getPresetManager: () => ({ readPresetExtensionField: readPreset }),
    extensionSettings: { [SETTINGS_KEY]: { version: 1, enabled: true, modelNameIncludes: 'gemini-pro' } },
  };
  const imported = initializeSettings(context);
  expect(imported).toMatchObject({
    enabled: true,
    prompt: '现有提示词',
    promptMode: 'assistant',
    promptDepth: -1,
    modelNameIncludes: 'gemini-pro',
  });
  expect(variables.get().unrelated).toBe(9);
  expect(readPreset).toHaveBeenCalledTimes(1);
  saveSettings({ ...imported, prompt: '脚本提示词' });
  expect(initializeSettings(context).prompt).toBe('脚本提示词');
  expect(readPreset).toHaveBeenCalledTimes(1);
});

describe.each(['custom', 'makersuite'])('%s native host requests', source => {
  it.each([false, true])(
    'injects tools and role prompts then collects multiple fields with stream=%s',
    async stream => {
      const events = installEvents();
      const warnings: string[] = [];
      const settings = SettingsSchema.parse({
        enabled: true,
        promptMode: 'user',
        promptDepth: -1,
        prompt: '工具：{{tool_outputs}}',
        tools: [
          {
            name: 'publish_story',
            enabled: true,
            description: '输出',
            parameters: {
              type: 'object',
              properties: { thinking: { type: 'string' }, text: { type: 'string' } },
              required: ['thinking', 'text'],
            },
            outputPaths: ['thinking', 'text'],
          },
        ],
      });
      const variables = installVariables({ [SETTINGS_KEY]: settings });
      const bodyText = '<dream_think>完整前言</dream_think>\n\n正文😀';
      const args = { thinking: '<dream_think>完整前言</dream_think>', text: '正文😀' };
      let sent: Record<string, any> = {};
      const delegate = vi.fn<typeof fetch>(async (_input, options) => {
        sent = JSON.parse(String(options?.body));
        if (!stream)
          return Response.json(
            source === 'custom'
              ? {
                  choices: [
                    {
                      message: {
                        tool_calls: [{ function: { name: 'publish_story', arguments: JSON.stringify(args) } }],
                      },
                    },
                  ],
                }
              : { candidates: [{ content: { parts: [{ functionCall: { name: 'publish_story', args } }] } }] },
          );
        const raw = JSON.stringify(args);
        const frames: unknown[] =
          source === 'custom'
            ? [...raw].map((fragment, index) => ({
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          function: { ...(index === 0 ? { name: 'publish_story' } : {}), arguments: fragment },
                        },
                      ],
                    },
                  },
                ],
              }))
            : [{ candidates: [{ content: { parts: [{ functionCall: { name: 'publish_story', args } }] } }] }];
        return new Response(
          new ReadableStream({
            start(controller) {
              for (const frame of frames) controller.enqueue(encodeEvent(frame));
              controller.enqueue(encodeEvent('[DONE]'));
              controller.close();
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      });
      const host = { fetch: delegate, document: { baseURI: 'http://localhost:8000/' } };
      const runtime = createJimiRuntime({
        host,
        settings: readSettings,
        model: () => ({ model: 'gemini-test', chat_completion_source: source }),
        warning: message => {
          if (message) warnings.push(message);
        },
      });
      try {
        events.fire('GENERATION_STARTED', 'normal');
        const messages = [
          { role: 'user', content: '开场' },
          { role: 'assistant', content: '回应' },
          { role: 'user', content: '继续' },
        ];
        events.fire('CHAT_COMPLETION_PROMPT_READY', { chat: messages, dryRun: false });
        const body = { model: 'gemini-test', chat_completion_source: source, type: 'normal', messages, stream };
        events.fire('CHAT_COMPLETION_SETTINGS_READY', body);
        expect(messages.at(-1)?.content).toBe('继续\n\n工具：publish_story.thinking、publish_story.text');
        // A saved configuration change must not reinterpret an already prepared request.
        variables.set({ [SETTINGS_KEY]: { ...settings, tools: [{ ...settings.tools[0], outputPaths: ['text'] }] } });
        const response = await host.fetch('/api/backends/chat-completions/generate', {
          method: 'POST',
          headers: { 'x-csrf-token': 'csrf' },
          body: JSON.stringify(body),
        });
        expect(delegate.mock.calls[0][0]).toBe('/api/backends/chat-completions/generate');
        expect(delegate.mock.calls[0][1]?.headers).toEqual({ 'x-csrf-token': 'csrf' });
        expect(sent).not.toHaveProperty(REQUEST_KEY);
        expect(sent.tools[0].function.name).toBe('publish_story');
        expect(sent.messages.at(-1).content).toBe(messages.at(-1)?.content);
        expect(warnings).toEqual([]);
        if (stream) {
          const frames = new SseDecoder()
            .push(await response.text(), true)
            .filter(event => event.data !== '[DONE]')
            .map(event => JSON.parse(event.data));
          const result = frames
            .flatMap(frame =>
              source === 'custom'
                ? (frame.choices?.map((choice: any) => choice.delta?.content ?? '') ?? [])
                : (frame.candidates?.flatMap(
                    (candidate: any) => candidate.content?.parts?.map((part: any) => part.text ?? '') ?? [],
                  ) ?? []),
            )
            .join('');
          expect(result).toBe(bodyText);
        } else {
          const result = await response.json();
          expect(result.choices[0].message.content).toBe(bodyText);
        }
      } finally {
        runtime.destroy();
      }
      expect(host.fetch).toBe(delegate);
      expect(events.count()).toBe(0);
    },
  );
});

it('honors direct variable edits, disabled switches, unmatched models, quiet generation and missing role depth', () => {
  const events = installEvents();
  const warnings: string[] = [];
  const settings = SettingsSchema.parse({ enabled: true, promptMode: 'assistant', promptDepth: -2 });
  const variables = installVariables({ [SETTINGS_KEY]: settings });
  const host = { fetch: vi.fn<typeof fetch>(), document: { baseURI: 'http://localhost/' } };
  const runtime = createJimiRuntime({
    host,
    settings: readSettings,
    model: () => ({ model: 'gemini-test', chat_completion_source: 'custom' }),
    warning: message => {
      if (message) warnings.push(message);
    },
  });
  try {
    for (const change of [{ enabled: false }, { modelNameIncludes: 'different' }]) {
      variables.set({ [SETTINGS_KEY]: { ...settings, ...change } });
      const body = {
        model: 'gemini-test',
        chat_completion_source: 'custom',
        messages: [{ role: 'user', content: '继续' }],
      };
      events.fire('CHAT_COMPLETION_SETTINGS_READY', body);
      expect(body).not.toHaveProperty(REQUEST_KEY);
    }
    variables.set({ [SETTINGS_KEY]: settings });
    events.fire('GENERATION_STARTED', 'quiet');
    const quiet = {
      model: 'gemini-test',
      chat_completion_source: 'custom',
      messages: [{ role: 'user', content: '继续' }],
    };
    events.fire('CHAT_COMPLETION_SETTINGS_READY', quiet);
    expect(quiet).not.toHaveProperty(REQUEST_KEY);
    events.fire('GENERATION_STARTED', 'normal');
    const body = { ...quiet, type: 'normal' };
    events.fire('CHAT_COMPLETION_SETTINGS_READY', body);
    events.fire('CHAT_COMPLETION_SETTINGS_READY', body);
    expect(body).toHaveProperty(REQUEST_KEY);
    expect(body.messages).toEqual(quiet.messages);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Assistant.*-2/);
  } finally {
    runtime.destroy();
  }
});

it('keeps later fetch wrappers intact when the script is disabled', async () => {
  const events = installEvents();
  const delegate = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
  const host = { fetch: delegate as typeof fetch, document: { baseURI: 'http://localhost/' } };
  const runtime = createJimiRuntime({
    host,
    settings: () => SettingsSchema.parse({}),
    model: () => ({ model: 'gemini-test', chat_completion_source: 'custom' }),
    warning: () => {},
  });
  const helper = host.fetch;
  const later: typeof fetch = (input, init) => helper(input, init);
  host.fetch = later;
  runtime.destroy();
  expect(host.fetch).toBe(later);
  expect(events.count()).toBe(0);
  expect(await (await host.fetch('/unrelated')).json()).toEqual({ ok: true });
  expect(delegate).toHaveBeenCalledTimes(1);
});

it('preserves Request properties across iframe constructors and forwards aborts', async () => {
  const controller = new AbortController();
  const request = new Request('http://localhost/api/backends/chat-completions/generate', {
    method: 'POST',
    headers: { 'x-csrf-token': 'csrf' },
    signal: controller.signal,
    body: JSON.stringify({
      [REQUEST_KEY]: requestConfig(SettingsSchema.parse({ enabled: true })),
      model: 'gemini-test',
      chat_completion_source: 'custom',
      messages: [],
      stream: false,
    }),
  });
  const foreign = Object.fromEntries(
    [
      'url',
      'method',
      'headers',
      'signal',
      'credentials',
      'cache',
      'redirect',
      'mode',
      'integrity',
      'referrer',
      'referrerPolicy',
    ].map(key => [key, (request as any)[key]]),
  );
  foreign.clone = () => request.clone();
  expect(foreign instanceof Request).toBe(false);
  const delegate = vi.fn<typeof fetch>(async (_input, options) => {
    expect(new Headers(options?.headers).get('x-csrf-token')).toBe('csrf');
    expect(options?.signal).toBe(request.signal);
    expect(JSON.parse(String(options?.body))).not.toHaveProperty(REQUEST_KEY);
    return Response.json({
      choices: [{ message: { tool_calls: [{ function: { name: 'publish_story', arguments: '{"text":"正文"}' } }] } }],
    });
  });
  const fetch = createHelperFetch(delegate, 'http://localhost/');
  const response = await fetch(foreign as unknown as Request);
  expect((await response.json()).choices[0].message.content).toBe('正文');
  controller.abort();
  expect(delegate.mock.calls[0][1]?.signal?.aborted).toBe(true);
});
