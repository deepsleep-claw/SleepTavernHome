export const JAVASCRIPT_TAVERN_APIS = {
  getVariables: true,
  getChatMessages: true,
  getLastMessageId: true,
  getWorldbook: true,
  getWorldbookNames: true,
  getCharWorldbookNames: true,
  getChatWorldbookName: true,
  getTavernRegexes: true,
  getScriptTrees: true,
  getTavernHelperVersion: true,
  getSillyTavernVersion: true,
  'Mvu.getMvuData': true,
  'Mvu.parseMessage': true,
  'SillyTavern.getCurrentChatId': true,
  replaceVariables: false,
  insertOrAssignVariables: false,
  setChatMessages: false,
  createChatMessages: false,
  replaceWorldbook: false,
} as const;

export function javascriptTavernApiReadonly(name: string): boolean {
  if (!Object.hasOwn(JAVASCRIPT_TAVERN_APIS, name))
    throw new Error(`JS 酒馆接口桥没有开放 ${name}。请使用专用工作区工具。`);
  return JAVASCRIPT_TAVERN_APIS[name as keyof typeof JAVASCRIPT_TAVERN_APIS];
}

export async function callJavascriptTavernApi(name: string, args: unknown[]): Promise<unknown> {
  javascriptTavernApiReadonly(name);
  const globals = window as unknown as Record<string, unknown>;
  const helper = (globals.TavernHelper ?? (window.parent as unknown as Record<string, unknown>).TavernHelper) as
    Record<string, unknown> | undefined;
  let owner: Record<string, unknown> = globals;
  let method = name;
  if (name.includes('.')) {
    const [group, member] = name.split('.');
    owner = globals[group] as Record<string, unknown>;
    method = member;
  } else if (typeof globals[name] !== 'function' && helper) owner = helper;
  const callable = owner?.[method];
  if (typeof callable !== 'function') throw new Error(`酒馆接口 ${name} 尚未就绪或当前版本不提供此接口。`);
  return await Reflect.apply(callable, owner, args);
}
