import { vi } from 'vitest';

export function installVariables(initial: Record<string, any> = {}) {
  let variables = structuredClone(initial);
  const scopes: unknown[] = [];
  vi.stubGlobal('getScriptId', () => 'jimi-script');
  vi.stubGlobal('getVariables', (scope: unknown) => {
    scopes.push(scope);
    return structuredClone(variables);
  });
  vi.stubGlobal(
    'updateVariablesWith',
    (update: (value: Record<string, any>) => Record<string, any>, scope: unknown) => {
      scopes.push(scope);
      variables = structuredClone(update(structuredClone(variables)));
      return structuredClone(variables);
    },
  );
  return {
    get: () => structuredClone(variables),
    set: (value: Record<string, any>) => {
      variables = structuredClone(value);
    },
    scopes,
  };
}

export function installEvents() {
  const types = Object.fromEntries(
    [
      'GENERATION_STARTED',
      'GENERATION_ENDED',
      'GENERATION_STOPPED',
      'CHAT_COMPLETION_PROMPT_READY',
      'CHAT_COMPLETION_SETTINGS_READY',
    ].map(name => [name, name]),
  );
  const handlers = new Map<string, Set<(...args: any[]) => void>>();
  const on = (type: string, listener: (...args: any[]) => void) => {
    const listeners = handlers.get(type) ?? new Set();
    listeners.add(listener);
    handlers.set(type, listeners);
    return {
      stop: () => {
        listeners.delete(listener);
      },
    };
  };
  vi.stubGlobal('tavern_events', types);
  vi.stubGlobal('eventOn', on);
  vi.stubGlobal('eventMakeLast', on);
  return {
    fire: (type: string, ...args: any[]) => {
      handlers.get(type)?.forEach(handler => handler(...args));
    },
    count: () => [...handlers.values()].reduce((count, listeners) => count + listeners.size, 0),
  };
}
