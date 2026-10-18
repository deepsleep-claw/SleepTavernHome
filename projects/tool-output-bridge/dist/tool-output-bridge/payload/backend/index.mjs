// src/server/index.ts
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// src/shared/config.ts
var PLUGIN_ID = "tool-output-bridge";
var VERSION = "0.2.0";
var REQUEST_KEY = "__tool_output_bridge";
var DEFAULT_GLOBAL_CONFIG = { version: 1, enabled: false, modelNameIncludes: "Gemini" };
var DEFAULT_CONFIG = {
  version: 1,
  enabled: false,
  modelNameIncludes: "Gemini",
  keepOriginalText: false,
  promptMode: "system_prompt",
  promptDepth: 0,
  prompt: "\u8BF7\u901A\u8FC7\u4EE5\u4E0B\u5DE5\u5177\u63D0\u4EA4\u672C\u8F6E\u56DE\u590D\uFF1A{{tool_names}}\u3002\u5C06\u672C\u8F6E\u9700\u8981\u5C55\u793A\u7684\u5168\u90E8\u5185\u5BB9\u6309\u7528\u9014\u5199\u5165\u5BF9\u5E94\u5B57\u6BB5\uFF08{{tool_outputs}}\uFF09\uFF0C\u6309\u6240\u5217\u5B57\u6BB5\u987A\u5E8F\u586B\u5199\uFF0C\u4FDD\u7559\u539F\u6709\u7684 Markdown\u3001\u6807\u7B7E\u4E0E\u6362\u884C\u3002\u5168\u90E8\u5B57\u6BB5\u63D0\u4EA4\u5B8C\u6210\u540E\u7ED3\u675F\u672C\u8F6E\u56DE\u590D\u3002",
  forceMode: "named",
  forcedTool: "publish_story",
  googleMode: "auto",
  streamArguments: true,
  separator: "\n\n",
  tools: [{
    name: "publish_story",
    description: "\u5C06\u672C\u8F6E\u6545\u4E8B\u6B63\u6587\u53D1\u5E03\u5230\u804A\u5929\u6D88\u606F\u3002",
    parameters: { type: "object", properties: { text: { type: "string", description: "\u5B8C\u6574\u7684\u804A\u5929\u6B63\u6587\uFF0C\u4FDD\u7559\u683C\u5F0F\u4E0E\u6362\u884C\u3002" } }, required: ["text"] },
    outputPath: "text",
    enabled: true
  }]
};
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function pathSegments(path) {
  const value = path.replace(/^\$\.?/, "");
  const parts = value.startsWith("/") ? value.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~")) : value.replace(/\[(\d+)\]/g, ".$1").split(".");
  if (!parts.length || parts.some((part) => !part || ["__proto__", "constructor", "prototype"].includes(part))) {
    throw new Error("\u6B63\u6587\u5B57\u6BB5\u8DEF\u5F84\u65E0\u6548\u3002");
  }
  return parts;
}
function outputValue(args, path) {
  let value = args;
  for (const part of pathSegments(path)) value = value != null && Object.hasOwn(value, part) ? value[part] : void 0;
  if (typeof value !== "string") throw new Error(`\u5DE5\u5177\u6B63\u6587 ${path} \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u3002`);
  return value;
}
function toolOutputPaths(tool) {
  return tool.outputPaths ?? [tool.outputPath];
}
function collectOutput(args, tool, separator) {
  return toolOutputPaths(tool).map((path) => outputValue(args, path)).filter(Boolean).join(separator);
}
function renderPrompt(config) {
  if (config.promptMode === "none" || !config.prompt.trim()) return "";
  const active = config.tools.filter((tool) => tool.enabled);
  return config.prompt.replaceAll("{{tool_names}}", active.map((tool) => tool.name).join("\u3001")).replaceAll("{{tool_outputs}}", active.flatMap((tool) => toolOutputPaths(tool).map((path) => `${tool.name}.${path}`)).join("\u3001"));
}
function containsPrompt(message, content) {
  return typeof message.content === "string" ? message.content.includes(content) : Array.isArray(message.content) && message.content.some((part) => part?.type === "text" && typeof part.text === "string" && part.text.includes(content));
}
function injectPrompt(messages, config) {
  const content = renderPrompt(config);
  if (!content) return;
  if (config.promptMode === "system_prompt") {
    if (!messages.some((message) => message.role === "system" && containsPrompt(message, content))) messages.unshift({ role: "system", content });
    return;
  }
  const matches = messages.filter((message) => message.role === config.promptMode);
  const index = config.promptDepth < 0 ? matches.length + config.promptDepth : config.promptDepth;
  const target = matches[index];
  const role = { user: "User", assistant: "Assistant", system: "System", none: "" }[config.promptMode];
  if (!target) return `\u627E\u4E0D\u5230 ${role} \u6DF1\u5EA6 ${config.promptDepth} \u7684\u6D88\u606F\uFF0C\u5F53\u524D\u5171\u6709 ${matches.length} \u6761 ${role} \u6D88\u606F\u3002\u63D0\u793A\u8BCD\u672A\u6CE8\u5165\u3002`;
  if (containsPrompt(target, content)) return;
  if (typeof target.content === "string" || target.content == null) {
    target.content = target.content ? `${target.content}

${content}` : content;
  } else if (Array.isArray(target.content)) {
    target.content.push({ type: "text", text: content });
  } else {
    return `${role} \u6DF1\u5EA6 ${config.promptDepth} \u7684\u6D88\u606F\u5185\u5BB9\u65E0\u6CD5\u8FFD\u52A0\u6587\u672C\u3002\u63D0\u793A\u8BCD\u672A\u6CE8\u5165\u3002`;
  }
}
function validateConfig(input) {
  if (!isRecord(input)) throw new Error("\u63D2\u4EF6\u914D\u7F6E\u5FC5\u987B\u662F\u5BF9\u8C61\u3002");
  if (input.version !== void 0 && input.version !== 1) throw new Error("\u8BF7\u66F4\u65B0\u57FA\u7C73\u5DE5\u5177\u4EE5\u8BFB\u53D6\u6B64\u914D\u7F6E\u7248\u672C\u3002");
  const { promptEnabled, ...settings } = input;
  if (promptEnabled !== void 0 && typeof promptEnabled !== "boolean") throw new Error("\u914D\u7F6E promptEnabled \u5FC5\u987B\u4E3A\u5E03\u5C14\u503C\u3002");
  const config = { ...structuredClone(DEFAULT_CONFIG), ...settings };
  if (input.promptMode === void 0) config.promptMode = promptEnabled === false ? "none" : "system_prompt";
  for (const key of ["enabled", "keepOriginalText", "streamArguments"]) {
    if (typeof config[key] !== "boolean") throw new Error(`\u914D\u7F6E ${key} \u5FC5\u987B\u4E3A\u5E03\u5C14\u503C\u3002`);
  }
  if (!["none", "system_prompt", "user", "assistant", "system"].includes(config.promptMode)) throw new Error("\u63D0\u793A\u8BCD\u6CE8\u5165\u65B9\u5F0F\u65E0\u6548\u3002");
  if (!Number.isSafeInteger(config.promptDepth)) throw new Error("\u63D0\u793A\u8BCD\u6CE8\u5165\u6DF1\u5EA6\u5FC5\u987B\u662F\u6574\u6570\u3002");
  if (!["auto", "required", "named"].includes(config.forceMode)) throw new Error("\u5DE5\u5177\u9009\u62E9\u6A21\u5F0F\u65E0\u6548\u3002");
  if (!["auto", "native", "interactions"].includes(config.googleMode)) throw new Error("\u63A5\u53E3\u6A21\u5F0F\u65E0\u6548\u3002");
  config.modelNameIncludes = globalConfigFromSettings(config).modelNameIncludes;
  if (typeof config.prompt !== "string" || config.prompt.length > 65536) throw new Error("\u63D0\u793A\u8BCD\u957F\u5EA6\u987B\u5C0F\u4E8E 65536 \u5B57\u7B26\u3002");
  if (typeof config.separator !== "string" || config.separator.length > 1e3) throw new Error("\u6B63\u6587\u5206\u9694\u7B26\u8FC7\u957F\u3002");
  if (!Array.isArray(config.tools) || config.tools.length > 32) throw new Error("\u5DE5\u5177\u6570\u91CF\u987B\u4E3A 0 \u81F3 32 \u4E2A\u3002");
  const names = /* @__PURE__ */ new Set();
  config.tools = config.tools.map((tool, index) => {
    if (!isRecord(tool)) throw new Error(`\u7B2C ${index + 1} \u4E2A\u5DE5\u5177\u683C\u5F0F\u65E0\u6548\u3002`);
    if (typeof tool.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(tool.name)) throw new Error("\u5DE5\u5177\u540D\u79F0\u987B\u4E3A 1 \u81F3 64 \u4E2A\u82F1\u6587\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\u6216\u8FDE\u5B57\u7B26\uFF0C\u4E14\u4EE5\u5B57\u6BCD\u6216\u4E0B\u5212\u7EBF\u5F00\u5934\u3002");
    if (names.has(tool.name)) throw new Error(`\u5DE5\u5177\u540D\u79F0\u91CD\u590D\uFF1A${tool.name}`);
    names.add(tool.name);
    if (typeof tool.description !== "string" || tool.description.length > 16384) throw new Error(`\u5DE5\u5177 ${tool.name} \u7684\u8BF4\u660E\u65E0\u6548\u3002`);
    if (typeof tool.enabled !== "boolean") throw new Error(`\u5DE5\u5177 ${tool.name} \u7684\u542F\u7528\u72B6\u6001\u65E0\u6548\u3002`);
    if (!isRecord(tool.parameters) || tool.parameters.type !== "object") throw new Error(`\u5DE5\u5177 ${tool.name} \u7684\u53C2\u6570\u987B\u4E3A object \u7C7B\u578B\u7684 JSON Schema\u3002`);
    if (JSON.stringify(tool.parameters).length > 65536) throw new Error(`\u5DE5\u5177 ${tool.name} \u7684\u53C2\u6570\u5B9A\u4E49\u8FC7\u957F\u3002`);
    const paths = tool.outputPaths ?? [tool.outputPath];
    if (!Array.isArray(paths) || !paths.length || paths.length > 32) throw new Error(`\u5DE5\u5177 ${tool.name} \u987B\u914D\u7F6E 1 \u81F3 32 \u4E2A\u6B63\u6587\u5B57\u6BB5\u8DEF\u5F84\u3002`);
    const targets = /* @__PURE__ */ new Set();
    for (const path of paths) {
      if (typeof path !== "string") throw new Error(`\u5DE5\u5177 ${tool.name} \u7684\u6B63\u6587\u5B57\u6BB5\u8DEF\u5F84\u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u3002`);
      const target = JSON.stringify(pathSegments(path));
      if (targets.has(target)) throw new Error(`\u5DE5\u5177 ${tool.name} \u7684\u6B63\u6587\u5B57\u6BB5\u8DEF\u5F84\u91CD\u590D\u3002`);
      targets.add(target);
    }
    return { ...structuredClone(tool), outputPath: paths[0] };
  });
  const active = config.tools.filter((tool) => tool.enabled);
  if (config.enabled && !active.length) throw new Error("\u8BF7\u81F3\u5C11\u542F\u7528\u4E00\u4E2A\u6B63\u6587\u5DE5\u5177\u3002");
  if (config.enabled && config.forceMode === "named" && !active.some((tool) => tool.name === config.forcedTool)) throw new Error("\u6307\u5B9A\u8C03\u7528\u7684\u5DE5\u5177\u5FC5\u987B\u5904\u4E8E\u542F\u7528\u72B6\u6001\u3002");
  return config;
}
function globalConfigFromSettings(value) {
  const config = { ...DEFAULT_GLOBAL_CONFIG, ...isRecord(value) ? value : {} };
  if (config.version !== 1 || typeof config.enabled !== "boolean") throw new Error("\u5168\u5C40\u8BBE\u7F6E\u683C\u5F0F\u65E0\u6548\u3002");
  if (typeof config.modelNameIncludes !== "string" || !config.modelNameIncludes.trim() || config.modelNameIncludes.length > 128) throw new Error("\u8BF7\u586B\u5199 1 \u81F3 128 \u4E2A\u5B57\u7B26\u7684\u6A21\u578B\u540D\u79F0\u5173\u952E\u8BCD\u3002");
  return { version: 1, enabled: config.enabled, modelNameIncludes: config.modelNameIncludes.trim() };
}
function modelMatches(model, keyword) {
  return typeof model === "string" && !!keyword.trim() && model.toLowerCase().includes(keyword.trim().toLowerCase());
}
function shouldActivate(body, config) {
  return config.enabled && modelMatches(body.model, config.modelNameIncludes) && !["quiet", "impersonate"].includes(body.type) && supportedSource(body.chat_completion_source);
}
function resolveProtocol(source, mode = "auto") {
  if (source === "makersuite") return mode === "interactions" ? "interactions" : "gemini";
  if (source === "vertexai") return "vertex";
  return supportedSource(source) ? "openai" : null;
}
function supportedSource(source) {
  return ["openai", "custom", "openrouter", "makersuite", "vertexai", "deepseek", "groq", "moonshot", "mistralai", "siliconflow", "nanogpt", "zai", "chutes", "cometapi"].includes(String(source));
}
function injectRequest(request, config, warn) {
  const body = structuredClone(request);
  delete body[REQUEST_KEY];
  const active = config.tools.filter((tool) => tool.enabled);
  const own = new Set(active.map((tool) => tool.name));
  body.tools = [
    ...Array.isArray(body.tools) ? body.tools.filter((tool) => !own.has(tool?.function?.name)) : [],
    ...active.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }))
  ];
  body.tool_choice = config.forceMode === "named" ? { type: "function", function: { name: config.forcedTool } } : config.forceMode === "required" ? "required" : "auto";
  body.messages ??= [];
  const warning = injectPrompt(body.messages, config);
  if (warning) warn?.(warning);
  return body;
}

// src/shared/partial-json.ts
var PartialJsonFields = class {
  raw = "";
  stack = [];
  inString = false;
  isKey = false;
  target;
  stringValue = "";
  escaped = false;
  unicode = null;
  pendingSurrogate = "";
  targets;
  fields;
  constructor(paths) {
    this.fields = paths.map((path) => ({ path, text: "", seen: false, complete: false }));
    this.targets = new Map(this.fields.map((field) => [JSON.stringify(pathSegments(field.path)), field]));
  }
  valuePath() {
    const parent = this.stack.at(-1);
    return !parent ? [] : [...parent.path, parent.type === "object" ? parent.key : String(parent.index)];
  }
  decoded(char) {
    if (this.isKey) this.stringValue += char;
    if (!this.target) return;
    if (this.pendingSurrogate) {
      this.target.text += this.pendingSurrogate + char;
      this.pendingSurrogate = "";
    } else if (char.length === 1 && /[\uD800-\uDBFF]/.test(char)) this.pendingSurrogate = char;
    else this.target.text += char;
  }
  push(fragment) {
    this.raw += fragment;
    if (this.raw.length > 8 * 1024 * 1024) throw new Error("\u5DE5\u5177\u53C2\u6570\u8D85\u8FC7 8 MiB\u3002");
    for (const char of fragment) {
      if (this.inString) {
        if (this.unicode !== null) {
          if (!/[0-9a-f]/i.test(char)) throw new Error("\u5DE5\u5177\u53C2\u6570\u5305\u542B\u65E0\u6548 Unicode \u8F6C\u4E49\u3002");
          this.unicode += char;
          if (this.unicode.length === 4) {
            this.decoded(String.fromCharCode(parseInt(this.unicode, 16)));
            this.unicode = null;
          }
        } else if (this.escaped) {
          this.escaped = false;
          if (char === "u") this.unicode = "";
          else {
            const values = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "	" };
            if (!(char in values)) throw new Error("\u5DE5\u5177\u53C2\u6570\u5305\u542B\u65E0\u6548 JSON \u8F6C\u4E49\u3002");
            this.decoded(values[char]);
          }
        } else if (char === "\\") this.escaped = true;
        else if (char === '"') {
          this.inString = false;
          if (this.isKey) {
            const parent2 = this.stack.at(-1);
            parent2.key = this.stringValue;
            parent2.expectsKey = false;
          }
          if (this.target) {
            this.target.text += this.pendingSurrogate;
            this.pendingSurrogate = "";
            this.target.complete = true;
          }
        } else {
          if (char.charCodeAt(0) < 32) throw new Error("\u5DE5\u5177\u53C2\u6570\u5B57\u7B26\u4E32\u5305\u542B\u672A\u8F6C\u4E49\u7684\u63A7\u5236\u5B57\u7B26\u3002");
          this.decoded(char);
        }
        continue;
      }
      const parent = this.stack.at(-1);
      if (char === '"') {
        this.inString = true;
        this.isKey = parent?.type === "object" && parent.expectsKey;
        this.stringValue = "";
        this.target = this.isKey ? void 0 : this.targets.get(JSON.stringify(this.valuePath()));
        if (this.target) {
          if (this.target.seen) throw new Error("\u5DE5\u5177\u53C2\u6570\u91CD\u590D\u5B9A\u4E49\u4E86\u6B63\u6587\u5B57\u6BB5\u3002");
          this.target.seen = true;
        }
      } else if (char === "{" || char === "[") this.stack.push({ type: char === "{" ? "object" : "array", path: this.valuePath(), key: "", index: 0, expectsKey: char === "{" });
      else if (char === "}" || char === "]") this.stack.pop();
      else if (char === "," && parent) {
        if (parent.type === "array") parent.index++;
        else parent.expectsKey = true;
      }
    }
  }
  finish() {
    const args = JSON.parse(this.raw);
    for (const field of this.fields) {
      if (outputValue(args, field.path) !== field.text) throw new Error("\u5DE5\u5177\u6B63\u6587\u4E0E\u5B8C\u6574\u53C2\u6570\u4E0D\u4E00\u81F4\u3002");
    }
  }
};

// src/shared/output-collector.ts
var OutputCollector = class {
  constructor(tool, separator) {
    this.separator = separator;
    this.parser = new PartialJsonFields(toolOutputPaths(tool));
  }
  separator;
  parser;
  hasJson = false;
  current = 0;
  emitted = 0;
  started = false;
  push(fragment) {
    if (fragment) this.hasJson = true;
    this.parser.push(fragment);
  }
  snapshot(args, final) {
    for (const field of this.parser.fields) {
      let value = args;
      for (const key of pathSegments(field.path)) value = value != null && Object.hasOwn(value, key) ? value[key] : void 0;
      if (value === void 0 && !final) continue;
      if (typeof value !== "string") throw new Error(`\u5DE5\u5177\u6B63\u6587 ${field.path} \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u3002`);
      if (!value.startsWith(field.text)) throw new Error(`\u5DE5\u5177\u6B63\u6587 ${field.path} \u7684\u5206\u7247\u4E0E\u5B8C\u6574\u6B63\u6587\u4E0D\u4E00\u81F4\u3002`);
      field.text = value;
      field.seen = true;
      if (final) field.complete = true;
    }
  }
  append(path, value, continuing) {
    const target = JSON.stringify(pathSegments(path));
    const field = this.parser.fields.find((field2) => JSON.stringify(pathSegments(field2.path)) === target);
    if (!field) return;
    if (typeof value !== "string") throw new Error("\u6B63\u6587\u53C2\u6570\u7247\u6BB5\u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u3002");
    field.text += value;
    field.seen = true;
    field.complete = !continuing;
  }
  finish(validate = true) {
    if (validate) {
      if (this.hasJson) this.parser.finish();
      else for (const field of this.parser.fields) {
        if (!field.seen) outputValue({}, field.path);
      }
    }
    for (const field of this.parser.fields) field.complete = true;
  }
  drain() {
    let text = "";
    while (this.current < this.parser.fields.length) {
      const field = this.parser.fields[this.current];
      const delta = field.text.slice(this.emitted);
      if (delta) {
        if (!this.emitted && this.started) text += this.separator;
        text += delta;
        this.emitted = field.text.length;
        this.started = true;
      }
      if (!field.complete) break;
      this.current++;
      this.emitted = 0;
    }
    return text;
  }
};

// src/shared/sse.ts
function streamCacheControl(value) {
  const directives = (value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  for (const required of ["no-cache", "no-transform"]) {
    if (!directives.some((part) => part.toLowerCase() === required)) directives.push(required);
  }
  return directives.join(", ");
}
var SseDecoder = class {
  decoder = new TextDecoder();
  buffer = "";
  push(chunk, final = false) {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: !final });
    if (final) this.buffer += this.decoder.decode();
    if (this.buffer.length > 16 * 1024 * 1024) throw new Error("\u5355\u4E2A\u6D41\u4E8B\u4EF6\u8D85\u8FC7 16 MiB\u3002");
    const events = [];
    let match;
    while (match = /\r\n\r\n|\n\n|\r\r/.exec(this.buffer)) {
      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const event = this.parse(block);
      if (event) events.push(event);
    }
    if (final && this.buffer.trim()) {
      const event = this.parse(this.buffer);
      if (event) events.push(event);
      this.buffer = "";
    }
    return events;
  }
  parse(block) {
    const data = [];
    let event = "";
    let id;
    for (const line of block.split(/\r\n|\n|\r/)) {
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "data") data.push(value);
      else if (field === "event") event = value;
      else if (field === "id") id = value;
    }
    return data.length ? { event, data: data.join("\n"), id } : void 0;
  }
};
function encodeEvent(data) {
  return new TextEncoder().encode(`data: ${typeof data === "string" ? data : JSON.stringify(data)}

`);
}

// src/shared/transform.ts
var OutputTransformer = class {
  constructor(config, source, diagnostics) {
    this.config = config;
    this.source = source;
    this.diagnostics = diagnostics;
    this.tools = new Map(config.tools.filter((tool) => tool.enabled).map((tool) => [tool.name, tool]));
  }
  config;
  source;
  diagnostics;
  tools;
  calls = /* @__PURE__ */ new Map();
  queues = /* @__PURE__ */ new Map();
  outputStarted = /* @__PURE__ */ new Set();
  otherCalls = /* @__PURE__ */ new Set();
  nativeActive = /* @__PURE__ */ new Map();
  serial = 0;
  ended = false;
  suppressedText = false;
  thoughtSignatures = /* @__PURE__ */ new Map();
  call(key, choice = 0) {
    let call = this.calls.get(key);
    if (!call) {
      call = { key, choice, name: "", raw: "", done: false, started: false, decision: "pending", pending: [] };
      this.calls.set(key, call);
      const queue = this.queues.get(choice) ?? [];
      queue.push(call);
      this.queues.set(choice, queue);
    }
    return call;
  }
  decide(call, final = false) {
    if (call.decision !== "pending") return;
    const tool = this.tools.get(call.name);
    if (tool) {
      call.decision = "own";
      call.collector = new OutputCollector(tool, this.config.separator);
      if (call.raw) call.collector.push(call.raw);
      call.pending = [];
    } else if (final || call.name && ![...this.tools.keys()].some((name) => name.startsWith(call.name))) {
      call.decision = "other";
      this.otherCalls.add(call.choice);
    }
  }
  arguments(call, fragment) {
    if (call.raw.length + fragment.length > 8 * 1024 * 1024) throw new Error("\u5DE5\u5177\u53C2\u6570\u8D85\u8FC7 8 MiB\u3002");
    this.decide(call);
    call.raw += fragment;
    if (call.decision === "own") call.collector.push(fragment);
  }
  complete(call, validate = true) {
    if (call.done) return;
    this.decide(call, true);
    if (call.decision === "own") call.collector.finish(validate);
    call.done = true;
  }
  drain(choice) {
    const queue = this.queues.get(choice) ?? [];
    let text = "";
    while (queue.length) {
      const call = queue[0];
      if (call.decision === "pending") break;
      if (call.decision === "other") {
        queue.shift();
        continue;
      }
      const delta = call.collector.drain();
      if (delta) {
        if (!call.started && this.outputStarted.has(choice)) text += this.config.separator;
        call.started = true;
        this.outputStarted.add(choice);
        text += delta;
      }
      if (!call.done) break;
      queue.shift();
    }
    return text;
  }
  original(text, choice) {
    if (Array.isArray(text)) text = text.map((part) => typeof part?.text === "string" ? part.text : "").join("");
    if (!this.config.keepOriginalText && typeof text === "string" && text.trim()) this.suppressedText = true;
    const value = this.config.keepOriginalText && typeof text === "string" ? text : "";
    if (value) this.outputStarted.add(choice);
    return value;
  }
  textFrame(text, choice = 0, thought = false) {
    return ["makersuite", "vertexai"].includes(this.source) ? { candidates: [{ index: choice, content: { role: "model", parts: [{ text, ...thought ? { thought: true } : {} }] } }] } : { choices: [{ index: choice, delta: thought ? { reasoning_content: text } : { content: text } }] };
  }
  openai(frame) {
    const result = structuredClone(frame);
    for (const choice of result.choices) {
      const index = choice.index ?? 0;
      const delta = choice.delta ?? {};
      let text = this.original(delta.content, index);
      if ("content" in delta) delta.content = text;
      const remaining = [];
      for (const part of delta.tool_calls ?? []) {
        const call = this.call(`openai:${index}:${part.index ?? part.id ?? 0}`, index);
        if (call.decision === "pending") call.pending.push(structuredClone(part));
        const name = part.function?.name;
        if (typeof name === "string" && name && call.name !== name) call.name += name;
        this.decide(call);
        if (typeof part.function?.arguments === "string") this.arguments(call, part.function.arguments);
        if (call.decision === "other") {
          if (call.pending.length) remaining.push(...call.pending.splice(0));
          else remaining.push(part);
        }
      }
      if (delta.tool_calls) {
        if (remaining.length) delta.tool_calls = remaining;
        else delete delta.tool_calls;
      }
      if (choice.finish_reason) {
        for (const call of this.calls.values()) if (call.choice === index && call.key.startsWith("openai:")) {
          this.complete(call, choice.finish_reason !== "length");
          if (call.decision === "other" && call.pending.length) {
            delta.tool_calls = [...delta.tool_calls ?? [], ...call.pending.splice(0)];
          }
        }
        if (choice.finish_reason === "tool_calls" && !this.otherCalls.has(index)) choice.finish_reason = "stop";
      }
      text += this.drain(index);
      if (text) delta.content = text;
      choice.delta = delta;
    }
    return result;
  }
  google(frame) {
    const result = structuredClone(frame);
    for (const candidate of result.candidates) {
      if (candidate.finishReason && !["STOP", "MAX_TOKENS", "FINISH_REASON_UNSPECIFIED"].includes(candidate.finishReason)) {
        throw new Error(`Gemini \u7ED3\u675F\u4E86\u751F\u6210\uFF1A${candidate.finishReason}`);
      }
      const index = candidate.index ?? 0;
      const parts = [];
      let text = "";
      for (const part of candidate.content?.parts ?? []) {
        if (part.thought) {
          parts.push(part);
          continue;
        }
        if (typeof part.text === "string") {
          text += this.original(part.text, index);
          continue;
        }
        if (!part.functionCall) {
          parts.push(part);
          continue;
        }
        const fc = part.functionCall;
        let key = fc.id ? `google:${index}:${fc.id}` : this.nativeActive.get(index);
        if (!key || fc.name && this.calls.get(key)?.done) key = `google:${index}:${++this.serial}`;
        const call = this.call(key, index);
        if (fc.name) call.name = fc.name;
        this.decide(call, true);
        this.nativeActive.set(index, key);
        if (call.decision === "other") {
          parts.push(part);
          if (!fc.willContinue) call.done = true;
          continue;
        }
        for (const arg of fc.partialArgs ?? []) {
          if (typeof arg.jsonPath === "string" && arg.stringValue !== void 0) {
            call.collector.append(arg.jsonPath, arg.stringValue, Boolean(arg.willContinue ?? fc.willContinue));
          }
        }
        if (isRecord(fc.args) && Object.keys(fc.args).length) call.collector.snapshot(fc.args, !fc.willContinue);
        if (!fc.willContinue) this.complete(call);
        text += this.drain(index);
      }
      if (candidate.finishReason) {
        for (const call of this.calls.values()) if (call.choice === index && call.key.startsWith("google:")) this.complete(call, candidate.finishReason !== "MAX_TOKENS");
        text += this.drain(index);
      }
      if (text) parts.unshift({ text });
      if (candidate.content) candidate.content.parts = parts;
    }
    return result;
  }
  interactions(frame) {
    const type = frame.event_type ?? frame.type;
    const result = [];
    if (type === "step.start" && frame.step?.type === "function_call") {
      const call = this.call(`interaction:${frame.index}`);
      call.name = frame.step.name ?? "";
      call.id = frame.step.id;
      this.decide(call, true);
      const args = frame.step.arguments;
      if (typeof args === "string") this.arguments(call, args);
      else if (isRecord(args) && Object.keys(args).length) this.arguments(call, JSON.stringify(args));
      const text = this.drain(0);
      if (text) result.push(this.textFrame(text));
    } else if (type === "step.start" && frame.step?.type === "thought" && frame.step.signature) {
      this.thoughtSignatures.set(frame.index, frame.step.signature);
    } else if (type === "step.delta") {
      const delta = frame.delta ?? {};
      if (["arguments_delta", "arguments"].includes(delta.type)) {
        const call = this.calls.get(`interaction:${frame.index}`);
        if (!call) throw new Error("\u5DE5\u5177\u53C2\u6570\u6D41\u7F3A\u5C11\u8C03\u7528\u8D77\u59CB\u4E8B\u4EF6\u3002");
        this.arguments(call, delta.arguments ?? delta.partial_arguments ?? "");
        const text = this.drain(0);
        if (text) result.push(this.textFrame(text));
      } else if (delta.type === "text") {
        const text = this.original(delta.text, 0);
        if (text) result.push(this.textFrame(text));
      } else if (delta.type === "thought_summary") {
        const text = delta.content?.text ?? delta.text;
        if (typeof text === "string") result.push(this.textFrame(text, 0, true));
      } else if (delta.type === "thought_signature" && typeof delta.signature === "string") {
        this.thoughtSignatures.set(frame.index, (this.thoughtSignatures.get(frame.index) ?? "") + delta.signature);
      }
    } else if (type === "step.stop") {
      const call = this.calls.get(`interaction:${frame.index}`);
      if (call) {
        this.complete(call);
        const text = this.drain(0);
        if (text) result.push(this.textFrame(text));
        if (call.decision === "other") {
          const signature = [...this.thoughtSignatures.entries()].filter(([index]) => index < frame.index).at(-1)?.[1];
          result.push({ candidates: [{ content: { parts: [{ functionCall: { id: call.id, name: call.name, args: JSON.parse(call.raw || "{}") }, ...signature ? { thoughtSignature: signature } : {} }] } }] });
        }
      }
    } else if (type === "interaction.completed" || type === "interaction.complete") {
      const interaction = frame.interaction ?? {};
      if (["failed", "cancelled", "incomplete"].includes(interaction.status)) throw new Error(`\u751F\u6210\u7ED3\u675F\u72B6\u6001\uFF1A${interaction.status}`);
      const usage = interaction.usage ?? {};
      result.push({ usageMetadata: this.interactionUsage(usage) });
    } else if (type === "error" || type === "interaction.failed") throw new Error(frame.error?.message ?? "\u4E0A\u6E38\u6D41\u8FD4\u56DE\u9519\u8BEF\u3002");
    return result;
  }
  event(event) {
    if (event.data === "[DONE]") return this.finish();
    const frame = JSON.parse(event.data);
    this.diagnostics?.input(frame);
    if (frame.error) {
      this.ended = true;
      return [frame];
    }
    if (frame.promptFeedback?.blockReason) throw new Error(`Gemini \u672A\u751F\u6210\u6B63\u6587\uFF1A${frame.promptFeedback.blockReason}`);
    if (Array.isArray(frame.choices)) return [this.openai(frame)];
    if (Array.isArray(frame.candidates)) return [this.google(frame)];
    if (frame.event_type || event.event.startsWith("step.") || event.event.startsWith("interaction.")) return this.interactions({ ...frame, event_type: frame.event_type ?? event.event });
    return [frame];
  }
  finish() {
    if (this.ended) return [];
    this.ended = true;
    const result = [];
    for (const call of this.calls.values()) {
      this.complete(call);
      if (call.decision === "other" && call.pending.length) result.push({ choices: [{ index: call.choice, delta: { tool_calls: call.pending.splice(0) } }] });
    }
    this.requireOutput();
    for (const choice of this.queues.keys()) {
      const text = this.drain(choice);
      if (text) result.push(this.textFrame(text, choice));
    }
    result.push("[DONE]");
    return result;
  }
  requireOutput() {
    if (this.suppressedText && !this.otherCalls.size && ![...this.calls.values()].some((call) => call.decision === "own")) {
      throw new Error("\u6A21\u578B\u4EC5\u8FD4\u56DE\u4E86\u666E\u901A\u6B63\u6587\uFF0C\u6CA1\u6709\u8C03\u7528\u6B63\u6587\u5DE5\u5177\u3002\u8BF7\u5F00\u542F\u5F3A\u5236\u5DE5\u5177\u9009\u62E9\uFF0C\u6216\u542F\u7528\u4FDD\u7559\u666E\u901A\u6B63\u6587\u3002");
    }
  }
  interactionUsage(usage) {
    return { promptTokenCount: usage.total_input_tokens, candidatesTokenCount: usage.total_output_tokens, thoughtsTokenCount: usage.total_thought_tokens, totalTokenCount: usage.total_tokens, cachedContentTokenCount: usage.total_cached_tokens };
  }
  json(input) {
    const result = structuredClone(input);
    if (result.error) return result;
    if (result.promptFeedback?.blockReason) throw new Error(`Gemini \u672A\u751F\u6210\u6B63\u6587\uFF1A${result.promptFeedback.blockReason}`);
    if (Array.isArray(result.steps)) {
      const parts = [];
      let signature;
      for (const step of result.steps) {
        if (step.type === "thought") {
          signature = step.signature;
          for (const content of step.summary ?? []) if (content.type === "text") parts.push({ text: content.text, thought: true });
        } else if (step.type === "function_call") parts.push({ functionCall: { id: step.id, name: step.name, args: step.arguments }, ...signature ? { thoughtSignature: signature } : {} });
        else if (step.type === "model_output") {
          for (const content of step.content ?? []) if (content.type === "text") parts.push({ text: content.text });
        }
      }
      if (["failed", "cancelled", "incomplete"].includes(result.status)) throw new Error(`\u751F\u6210\u7ED3\u675F\u72B6\u6001\uFF1A${result.status}`);
      return this.json({ candidates: [{ content: { role: "model", parts } }], usageMetadata: this.interactionUsage(result.usage ?? {}) });
    }
    if (result.responseContent || result.candidates) {
      const contents = result.candidates ?? [{ content: result.responseContent }];
      const transformed = this.google({ candidates: contents });
      this.requireOutput();
      const content = transformed.candidates[0]?.content ?? { parts: [] };
      result.responseContent = content;
      if (result.candidates) result.candidates = transformed.candidates;
      result.choices = [{ message: { role: "assistant", content: content.parts.filter((part) => !part.thought && typeof part.text === "string").map((part) => part.text).join("") } }];
      return result;
    }
    for (const choice of result.choices ?? []) {
      const message = choice.message ?? {};
      const text = [this.original(message.content, choice.index ?? 0)];
      const remaining = [];
      let owned = false;
      for (const call of message.tool_calls ?? []) {
        const tool = this.tools.get(call.function?.name);
        if (tool) {
          owned = true;
          text.push(collectOutput(typeof call.function.arguments === "string" ? JSON.parse(call.function.arguments) : call.function.arguments, tool, this.config.separator));
        } else remaining.push(call);
      }
      if (!this.config.keepOriginalText && message.content && !owned && !remaining.length) throw new Error("\u6A21\u578B\u4EC5\u8FD4\u56DE\u4E86\u666E\u901A\u6B63\u6587\uFF0C\u6CA1\u6709\u8C03\u7528\u6B63\u6587\u5DE5\u5177\u3002\u8BF7\u5F00\u542F\u5F3A\u5236\u5DE5\u5177\u9009\u62E9\uFF0C\u6216\u542F\u7528\u4FDD\u7559\u666E\u901A\u6B63\u6587\u3002");
      message.content = text.filter(Boolean).join(this.config.separator);
      if (remaining.length) message.tool_calls = remaining;
      else delete message.tool_calls;
      if (!remaining.length && choice.finish_reason === "tool_calls") choice.finish_reason = "stop";
    }
    return result;
  }
};
function observeCompletion(body, diagnostics) {
  if (!diagnostics) return body;
  const reader = body.getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          diagnostics.finish("completed");
          reader.releaseLock();
          controller.close();
        } else controller.enqueue(next.value);
      } catch (error) {
        diagnostics.finish("failed");
        reader.releaseLock();
        controller.error(error);
      }
    },
    async cancel(reason) {
      diagnostics.finish("cancelled");
      try {
        await reader.cancel(reason);
      } finally {
        reader.releaseLock();
      }
    }
  });
}
function transformResponse(response, config, source, streaming, diagnostics) {
  diagnostics?.response(response);
  if (!response.ok) {
    diagnostics?.finish("failed");
    return response;
  }
  const transformer = new OutputTransformer(config, source, diagnostics);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  if (!streaming) return response.json().then((value) => new Response(JSON.stringify(transformer.json(value)), { status: response.status, headers }));
  headers.set("cache-control", streamCacheControl(headers.get("cache-control")));
  if (headers.get("content-type")?.includes("application/json")) return response.json().then((value) => {
    diagnostics?.input(value);
    const frame = transformer.json(value);
    if (!frame.candidates) for (const choice of frame.choices ?? []) {
      choice.delta = choice.message;
      delete choice.message;
    }
    headers.set("content-type", "text/event-stream; charset=utf-8");
    diagnostics?.output(frame);
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(encodeEvent(frame));
      controller.enqueue(encodeEvent("[DONE]"));
      controller.close();
    } });
    return new Response(observeCompletion(body, diagnostics), { status: response.status, headers });
  });
  if (!response.body) throw new Error("\u751F\u6210\u54CD\u5E94\u6CA1\u6709\u6570\u636E\u6D41\u3002");
  const decoder = new SseDecoder();
  headers.set("content-type", "text/event-stream; charset=utf-8");
  const transformed = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      diagnostics?.chunk();
      for (const event of decoder.push(chunk)) for (const data of transformer.event(event)) {
        diagnostics?.output(data);
        controller.enqueue(encodeEvent(data));
      }
    },
    flush(controller) {
      for (const event of decoder.push(new Uint8Array(), true)) for (const data of transformer.event(event)) {
        diagnostics?.output(data);
        controller.enqueue(encodeEvent(data));
      }
      for (const data of transformer.finish()) {
        diagnostics?.output(data);
        controller.enqueue(encodeEvent(data));
      }
    }
  }));
  return new Response(observeCompletion(transformed, diagnostics), { status: response.status, headers });
}

// src/server/transport.ts
import { PassThrough, Readable } from "node:stream";
import { EventEmitter } from "node:events";
function webResponse(response) {
  if (response instanceof Response) return response;
  const headers = new Headers();
  response.headers?.forEach((value, key) => headers.set(key, value));
  const body = response.body?.getReader ? response.body : response.body ? Readable.toWeb(response.body) : null;
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
function captureRoute(router, request, signal) {
  return new Promise((resolve2, reject) => {
    const socket = new EventEmitter();
    const incoming = Object.create(request);
    incoming.url = "/generate";
    incoming.baseUrl = "";
    incoming.body = request.body;
    Object.defineProperty(incoming, "socket", { value: socket });
    Object.defineProperty(incoming, "connection", { value: socket });
    let resolved = false;
    class CapturedResponse extends PassThrough {
      statusCode = 200;
      statusMessage = "";
      headersSent = false;
      headers = new Headers();
      socket = socket;
      locals = {};
      status(code) {
        this.statusCode = code;
        return this;
      }
      setHeader(key, value) {
        this.headers.set(key, String(value));
        return this;
      }
      getHeader(key) {
        return this.headers.get(key);
      }
      removeHeader(key) {
        this.headers.delete(key);
      }
      set(key, value) {
        if (typeof key === "string") this.setHeader(key, value);
        else for (const [name, entry] of Object.entries(key)) this.setHeader(name, entry);
        return this;
      }
      json(value) {
        this.setHeader("content-type", "application/json");
        this.end(JSON.stringify(value));
        return this;
      }
      send(value) {
        return typeof value === "object" ? this.json(value) : (this.end(String(value ?? "")), this);
      }
      sendStatus(code) {
        return this.status(code).send(String(code));
      }
      flushHeaders() {
        this.publish();
      }
      publish() {
        if (resolved) return;
        resolved = true;
        this.headersSent = true;
        resolve2(new Response(Readable.toWeb(this), { status: this.statusCode, headers: this.headers }));
      }
      _transform(chunk, encoding, callback) {
        this.publish();
        super._transform(chunk, encoding, callback);
      }
      _final(callback) {
        this.publish();
        callback();
      }
    }
    const response = new CapturedResponse();
    const abort = () => {
      socket.emit("close");
      response.destroy(new Error("\u751F\u6210\u5DF2\u53D6\u6D88\u3002"));
    };
    response.on("error", reject);
    response.once("close", () => {
      signal.removeEventListener("abort", abort);
      socket.emit("close");
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    try {
      router.handle(incoming, response, (error) => {
        response.destroy(error ?? new Error("\u9152\u9986\u6CA1\u6709\u5339\u914D\u7684\u804A\u5929\u751F\u6210\u63A5\u53E3\u3002"));
      });
    } catch (error) {
      response.destroy(error);
    }
  });
}
async function forwardResponse(upstream, response) {
  response.status(upstream.status);
  for (const key of ["content-type", "cache-control", "retry-after"]) {
    const value = upstream.headers.get(key);
    if (value) response.setHeader(key, value);
  }
  response.setHeader("x-accel-buffering", "no");
  if (upstream.headers.get("content-type")?.includes("text/event-stream")) {
    response.setHeader("cache-control", streamCacheControl(upstream.headers.get("cache-control")));
    response.flushHeaders?.();
  }
  if (!upstream.body) {
    response.end();
    return;
  }
  const reader = upstream.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {
    });
  };
  response.once("close", cancel);
  try {
    while (!response.destroyed) {
      const { done, value } = await reader.read();
      if (done) break;
      const writable = response.write(Buffer.from(value));
      response.flush?.();
      if (!writable) {
        await new Promise((resolve2, reject) => {
          const clean = () => {
            response.off("drain", drained);
            response.off("close", drained);
            response.off("error", failed);
          };
          const drained = () => {
            clean();
            resolve2();
          };
          const failed = (error) => {
            clean();
            reject(error);
          };
          response.once("drain", drained);
          response.once("close", drained);
          response.once("error", failed);
        });
      }
    }
    if (!response.destroyed) response.end();
  } catch (error) {
    if (!response.destroyed) {
      const message = error instanceof Error ? error.message : "\u6B63\u6587\u8F6C\u6362\u5931\u8D25\u3002";
      if (response.headersSent && upstream.headers.get("content-type")?.includes("text/event-stream")) {
        response.end(Buffer.from(encodeEvent({ error: { message } })));
      } else throw error;
    }
  } finally {
    response.off("close", cancel);
    reader.releaseLock();
  }
}

// src/server/google.ts
function enableArgumentStreaming(body, model, enabled) {
  if (!enabled || !/^gemini-3(?:[.\d]*-)/.test(model) || /3\.1-flash-lite/.test(model)) return;
  body.toolConfig ??= {};
  body.toolConfig.functionCallingConfig ??= { mode: "AUTO" };
  body.toolConfig.functionCallingConfig.streamFunctionCallArguments = true;
}
function toInteractions(body, model, stream) {
  const input = [];
  const pendingCalls = /* @__PURE__ */ new Map();
  let serial = 0;
  for (const message of body.contents ?? []) {
    let content = [];
    const flush = () => {
      if (content.length) input.push({ type: message.role === "model" ? "model_output" : "user_input", content });
      content = [];
    };
    for (const part of message.parts ?? []) {
      if (part.thought) {
        flush();
        input.push({ type: "thought", ...part.thoughtSignature ? { signature: part.thoughtSignature } : {}, ...part.text ? { summary: [{ type: "text", text: part.text }] } : {} });
        continue;
      }
      if (typeof part.text === "string") content.push({ type: "text", text: part.text });
      else if (part.inlineData || part.inline_data || part.fileData || part.file_data) {
        const media = part.inlineData ?? part.inline_data ?? part.fileData ?? part.file_data;
        const mime = media.mimeType ?? media.mime_type;
        const type = mime?.startsWith("image/") ? "image" : mime?.startsWith("audio/") ? "audio" : mime?.startsWith("video/") ? "video" : mime === "application/pdf" ? "document" : null;
        if (!type) throw new Error("Interactions \u6682\u4E0D\u652F\u6301\u6B64\u9644\u4EF6\u7C7B\u578B\uFF0C\u8BF7\u4F7F\u7528 Google \u539F\u751F\u6A21\u5F0F\u3002");
        content.push({ type, mime_type: mime, ...media.data ? { data: media.data } : { uri: media.fileUri ?? media.file_uri } });
      } else if (part.functionCall) {
        flush();
        if (part.thoughtSignature) input.push({ type: "thought", signature: part.thoughtSignature });
        const fc = part.functionCall;
        const id = fc.id || `history_call_${++serial}`;
        const ids = pendingCalls.get(fc.name) ?? [];
        ids.push(id);
        pendingCalls.set(fc.name, ids);
        input.push({ type: "function_call", id, name: fc.name, arguments: fc.args ?? {} });
      } else if (part.functionResponse) {
        flush();
        const fr = part.functionResponse;
        const id = fr.id || pendingCalls.get(fr.name)?.shift();
        if (!id) throw new Error("Interactions \u5DE5\u5177\u5386\u53F2\u7F3A\u5C11\u5BF9\u5E94\u8C03\u7528\uFF0C\u8BF7\u4F7F\u7528 Google \u539F\u751F\u6A21\u5F0F\u3002");
        input.push({ type: "function_result", name: fr.name, call_id: id, result: fr.response });
      } else throw new Error("Interactions \u6682\u4E0D\u652F\u6301\u6B64\u6D88\u606F\u5185\u5BB9\uFF0C\u8BF7\u4F7F\u7528 Google \u539F\u751F\u6A21\u5F0F\u3002");
    }
    flush();
  }
  const generation = body.generationConfig ?? {};
  const config = {};
  for (const [source, target] of Object.entries({ maxOutputTokens: "max_output_tokens", seed: "seed", stopSequences: "stop_sequences" })) {
    if (generation[source] !== void 0) config[target] = generation[source];
  }
  if (generation.thinkingConfig?.thinkingLevel) config.thinking_level = String(generation.thinkingConfig.thinkingLevel).toLowerCase();
  config.thinking_summaries = generation.thinkingConfig?.includeThoughts ? "auto" : "none";
  const choice = body.toolConfig?.functionCallingConfig;
  if (choice) config.tool_choice = choice.allowedFunctionNames?.length ? { allowed_tools: { mode: choice.mode.toLowerCase(), tools: choice.allowedFunctionNames } } : choice.mode.toLowerCase();
  const tools = [];
  for (const tool of body.tools ?? []) {
    const declarations = tool.functionDeclarations ?? tool.function_declarations;
    if (declarations) tools.push(...declarations.map((fn) => ({ type: "function", ...fn })));
    else if (tool.googleSearch || tool.google_search) tools.push({ type: "google_search" });
    else throw new Error("Interactions \u6682\u4E0D\u652F\u6301\u6B64\u5DE5\u5177\u7C7B\u578B\uFF0C\u8BF7\u4F7F\u7528 Google \u539F\u751F\u6A21\u5F0F\u3002");
  }
  return {
    model,
    input,
    stream,
    store: false,
    generation_config: config,
    tools,
    system_instruction: (body.systemInstruction ?? body.system_instruction)?.parts?.map((p) => p.text ?? "").join("\n") || void 0
  };
}
function interactionsUrl(original) {
  const url = new URL(original);
  if (!/\/v1(?:beta)?\/models\/[^/]+:(?:streamGenerateContent|generateContent)$/.test(url.pathname)) {
    throw new Error("\u6B64\u4EE3\u7406\u7684 URL \u65E0\u6CD5\u8F6C\u6362\u4E3A Interactions \u63A5\u53E3\uFF0C\u8BF7\u4F7F\u7528 Google \u539F\u751F\u6A21\u5F0F\u3002");
  }
  url.pathname = url.pathname.replace(/\/v1(?:beta)?\/models\/[^/]+:(?:streamGenerateContent|generateContent)$/, "/v1beta/interactions");
  url.searchParams.delete("alt");
  return url.href;
}
function prepareGoogleOutbound(url, options, body, config) {
  const protocol = resolveProtocol(body.chat_completion_source, config.googleMode);
  if (!protocol || protocol === "openai") return { url, options };
  const native = JSON.parse(options.body);
  if (protocol === "interactions") {
    return { url: interactionsUrl(url), options: { ...options, body: JSON.stringify(toInteractions(native, body.model, Boolean(body.stream))) } };
  }
  if (protocol === "vertex" && body.stream) enableArgumentStreaming(native, body.model, config.streamArguments);
  return { url, options: { ...options, body: JSON.stringify(native) } };
}
async function legacyGoogleRequest(request, modules, config, signal) {
  const body = request.body;
  const { converters, constants, google, secrets, util, fetch } = modules;
  const vertex = body.chat_completion_source === "vertexai";
  const model = String(body.model ?? "");
  if (!model) throw new Error("\u8BF7\u5148\u9009\u62E9 Gemini \u6A21\u578B\u3002");
  if (body.request_images || /^gemma/.test(model)) throw new Error("\u6B63\u6587\u5DE5\u5177\u9700\u8981\u652F\u6301\u51FD\u6570\u8C03\u7528\u7684\u804A\u5929\u6A21\u578B\u3002");
  const names = converters.getPromptNames(request);
  const messages = body.custom_prompt_post_processing ? converters.postProcessPrompt(body.messages, body.custom_prompt_post_processing, names) : body.messages;
  const prompt = converters.convertGooglePrompt(messages, model, Boolean(body.use_sysprompt), names);
  const generation = { maxOutputTokens: body.max_tokens, temperature: body.temperature, topP: body.top_p, topK: body.top_k || void 0, seed: body.seed, candidateCount: 1 };
  if (body.stop?.length) generation.stopSequences = body.stop;
  if (/^gemini-(2\.5|3)/.test(model)) {
    const budget = converters.calculateGoogleBudgetTokens(body.max_tokens, body.reasoning_effort, model);
    generation.thinkingConfig = {
      includeThoughts: Boolean(body.include_reasoning) && !(vertex && budget === 0),
      ...typeof budget === "number" ? { thinkingBudget: budget } : typeof budget === "string" ? { thinkingLevel: budget } : {}
    };
  }
  const functions = body.tools.filter((tool) => tool.type === "function").map((tool) => {
    const fn = structuredClone(tool.function);
    if (fn.parameters) delete fn.parameters.$schema;
    return fn;
  });
  const choice = body.tool_choice;
  const native = {
    contents: prompt.contents,
    generationConfig: generation,
    safetySettings: [...constants.GEMINI_SAFETY ?? [], ...vertex ? constants.VERTEX_SAFETY ?? [] : []],
    tools: [{ functionDeclarations: functions }],
    toolConfig: { functionCallingConfig: typeof choice === "object" ? { mode: "ANY", allowedFunctionNames: [choice.function.name] } : { mode: choice === "required" ? "ANY" : "AUTO" } }
  };
  if (body.use_sysprompt && prompt.system_instruction?.parts?.length) native.systemInstruction = prompt.system_instruction;
  const read = (key) => secrets.readProviderSecret ? secrets.readProviderSecret(request, key) : secrets.readSecret(request.user.directories, key, body.secret_id ?? null);
  const headers = { "content-type": "application/json" };
  const endpoint = body.stream ? "streamGenerateContent" : "generateContent";
  let base;
  if (vertex) {
    const region = String(body.vertexai_region || "us-central1");
    if (!/^[a-z0-9-]+$/.test(region)) throw new Error("Vertex \u533A\u57DF\u683C\u5F0F\u65E0\u6548\u3002");
    if (body.reverse_proxy) {
      base = `${String(body.reverse_proxy).replace(/\/$/, "")}/v1/publishers/google`;
      headers.authorization = `Bearer ${body.proxy_password || ""}`;
    } else {
      const host = region === "global" ? "aiplatform.googleapis.com" : `${region}-aiplatform.googleapis.com`;
      if (body.vertexai_auth_mode === "full") {
        const account = JSON.parse(read(secrets.SECRET_KEYS.VERTEXAI_SERVICE_ACCOUNT) || "{}");
        const project = google.getProjectIdFromServiceAccount(account);
        headers.authorization = `Bearer ${await google.getAccessToken(await google.generateJWTToken(account))}`;
        base = `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${region}/publishers/google`;
      } else {
        headers["x-goog-api-key"] = read(secrets.SECRET_KEYS.VERTEXAI) || "";
        base = `https://${host}/v1${body.vertexai_express_project_id ? `/projects/${encodeURIComponent(body.vertexai_express_project_id)}/locations/${region}` : ""}/publishers/google`;
      }
    }
  } else {
    base = `${String(body.reverse_proxy || "https://generativelanguage.googleapis.com").replace(/\/$/, "")}/${util.getConfigValue("gemini.apiVersion", "v1beta")}`;
    headers["x-goog-api-key"] = body.reverse_proxy ? body.proxy_password || "" : read(secrets.SECRET_KEYS.MAKERSUITE) || "";
  }
  const url = `${base}/models/${encodeURIComponent(model)}:${endpoint}${body.stream ? "?alt=sse" : ""}`;
  const prepared = prepareGoogleOutbound(url, { method: "POST", headers, signal, body: JSON.stringify(native) }, body, config);
  return fetch(prepared.url, prepared.options);
}

// src/shared/stream-diagnostics.ts
var StreamDiagnostics = class {
  constructor(report, now = () => performance.now()) {
    this.report = report;
    this.now = now;
    this.started = now();
  }
  report;
  now;
  started;
  ended = false;
  values = {
    responseMs: null,
    firstChunkMs: null,
    chunks: 0,
    argumentEvents: 0,
    firstArgumentMs: null,
    lastArgumentMs: null,
    textEvents: 0,
    firstTextMs: null,
    format: "sse"
  };
  elapsed() {
    return Math.max(0, Math.round(this.now() - this.started));
  }
  response(response) {
    this.values.responseMs ??= this.elapsed();
    this.values.format = response.headers.get("content-type")?.includes("application/json") ? "json" : "sse";
  }
  chunk() {
    this.values.firstChunkMs ??= this.elapsed();
    this.values.chunks++;
  }
  input(frame) {
    const hasArguments = (value) => typeof value === "string" ? value.length > 0 : value != null && typeof value === "object" && Object.keys(value).length > 0;
    const list = (value) => Array.isArray(value) ? value : [];
    const openai = list(frame.choices).some((choice) => list((choice.delta ?? choice.message)?.tool_calls).some((call) => hasArguments(call.function?.arguments)));
    const candidates = frame.candidates ?? (frame.responseContent ? [{ content: frame.responseContent }] : []);
    const google = list(candidates).some((candidate) => list(candidate.content?.parts).some((part) => hasArguments(part.functionCall?.args) || part.functionCall?.partialArgs?.length));
    const initial = list(frame.steps ?? (frame.step ? [frame.step] : [])).some((step) => step.type === "function_call" && hasArguments(step.arguments));
    const delta = ["arguments", "arguments_delta"].includes(frame.delta?.type) && hasArguments(frame.delta.arguments ?? frame.delta.partial_arguments);
    if (openai || google || initial || delta) {
      const elapsed = this.elapsed();
      this.values.firstArgumentMs ??= elapsed;
      this.values.lastArgumentMs = elapsed;
      this.values.argumentEvents++;
    }
  }
  output(frame) {
    if (typeof frame === "string") return;
    if (frame.error) {
      this.finish("failed");
      return;
    }
    const list = (value) => Array.isArray(value) ? value : [];
    const openai = list(frame.choices).some((choice) => {
      const content = (choice.delta ?? choice.message)?.content;
      return typeof content === "string" ? content.length > 0 : list(content).some((part) => part.text?.length);
    });
    const google = list(frame.candidates).some((candidate) => list(candidate.content?.parts).some((part) => !part.thought && part.text?.length));
    if (openai || google) {
      this.values.firstTextMs ??= this.elapsed();
      this.values.textEvents++;
    }
  }
  finish(result) {
    if (this.ended) return;
    this.ended = true;
    this.report({ ...this.values, result, elapsedMs: this.elapsed() });
  }
};
function logStreamReport(source, report) {
  const ms = (value) => value === null ? "\u65E0" : `${value}ms`;
  console.info(`[\u57FA\u7C73\u5DE5\u5177] \u6D41\u5F0F\u8BCA\u65AD\uFF1A\u6765\u6E90=${source}\uFF1B\u7ED3\u679C=${report.result}\uFF1B\u683C\u5F0F=${report.format}\uFF1B\u54CD\u5E94\u53EF\u8BFB=${ms(report.responseMs)}\uFF1B\u9996\u6279\u6570\u636E=${ms(report.firstChunkMs)}\uFF1B\u6570\u636E\u5757=${report.chunks}\uFF1B\u53C2\u6570\u4E8B\u4EF6=${report.argumentEvents}\uFF08${ms(report.firstArgumentMs)} \u2192 ${ms(report.lastArgumentMs)}\uFF09\uFF1B\u9996\u4E2A\u6B63\u6587=${ms(report.firstTextMs)}\uFF1B\u6B63\u6587\u4E8B\u4EF6=${report.textEvents}\uFF1B\u603B\u8017\u65F6=${report.elapsedMs}ms`);
}

// src/server/index.ts
var info = { id: PLUGIN_ID, name: "\u57FA\u7C73\u5DE5\u5177", description: "\u5C06\u6A21\u578B\u5DE5\u5177\u53C2\u6570\u8F6C\u6362\u4E3A\u804A\u5929\u6B63\u6587\u3002" };
function wrapDispatch(dispatch, config) {
  return (context) => dispatch({ ...context, fetch: async (url, options) => {
    const source = context.body.chat_completion_source;
    const diagnostics = context.body.stream ? new StreamDiagnostics((report) => logStreamReport(source, report)) : void 0;
    try {
      const prepared = prepareGoogleOutbound(url, options, context.body, config);
      const upstream = await context.fetch(prepared.url, prepared.options);
      return await transformResponse(webResponse(upstream), config, source, Boolean(context.body.stream), diagnostics);
    } catch (error) {
      diagnostics?.finish(options?.signal?.aborted ? "cancelled" : "failed");
      throw error;
    }
  } });
}
async function initialize(router, modules, host) {
  const luker = typeof modules.chat.selectChatCompletionDispatch === "function" && typeof modules.runner?.runLukerDispatch === "function";
  router.get("/status", (_request, response) => response.json({ id: PLUGIN_ID, version: VERSION, host, transport: luker ? "luker-job" : "http", interactions: true, vertexArgumentStreaming: true }));
  router.post("/generate", async (request, response) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    let diagnostics;
    try {
      const config = validateConfig(request.body?.[REQUEST_KEY]);
      if (!shouldActivate(request.body, config)) throw new Error("\u5F53\u524D\u8BF7\u6C42\u672A\u6EE1\u8DB3\u57FA\u7C73\u5DE5\u5177\u7684\u5168\u5C40\u5F00\u5173\u3001\u6A21\u578B\u540D\u79F0\u6216\u63A5\u53E3\u6761\u4EF6\u3002");
      if (!Array.isArray(request.body.messages)) throw new Error("\u804A\u5929\u8BF7\u6C42\u7F3A\u5C11\u6D88\u606F\u5217\u8868\u3002");
      request.body = injectRequest(request.body, config, (message) => console.warn("[\u57FA\u7C73\u5DE5\u5177]", message));
      if (luker) {
        if (request.body.custom_prompt_post_processing) request.body.messages = modules.converters.postProcessPrompt(request.body.messages, request.body.custom_prompt_post_processing, modules.converters.getPromptNames(request));
        if (request.body.json_schema?.value) request.body.json_schema.value = modules.util.flattenSchema(request.body.json_schema.value, request.body.chat_completion_source);
        await modules.runner.runLukerDispatch(request, response, { endpoint: "chat-completions", select: (body) => wrapDispatch(modules.chat.selectChatCompletionDispatch(body), config) });
        return;
      }
      response.once("close", cancel);
      const source = request.body.chat_completion_source;
      if (request.body.stream) diagnostics = new StreamDiagnostics((report) => logStreamReport(source, report));
      const upstream = resolveProtocol(source, config.googleMode) !== "openai" ? webResponse(await legacyGoogleRequest(request, modules, config, controller.signal)) : await captureRoute(modules.chat.router, request, controller.signal);
      await forwardResponse(await transformResponse(upstream, config, source, Boolean(request.body.stream), diagnostics), response);
    } catch (error) {
      diagnostics?.finish(controller.signal.aborted ? "cancelled" : "failed");
      if (!response.headersSent && !response.destroyed) response.status(400).json({ error: { message: error instanceof Error ? error.message : "\u5DE5\u5177\u6B63\u6587\u8BF7\u6C42\u5931\u8D25\u3002" } });
      else if (!response.destroyed && !response.writableEnded) response.end();
    } finally {
      response.off("close", cancel);
    }
  });
}
async function init(router) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const load = (path) => import(pathToFileURL(resolve(root, path)).href);
  const [chat, converters, util, google, secrets, constants] = await Promise.all([
    load("src/endpoints/backends/chat-completions.js"),
    load("src/prompt-converters.js"),
    load("src/util.js"),
    load("src/endpoints/google.js"),
    load("src/endpoints/secrets.js"),
    load("src/constants.js")
  ]);
  const runner = chat.selectChatCompletionDispatch ? await load("src/luker-dispatch/runner.js") : null;
  const require2 = createRequire(resolve(root, "package.json"));
  const fetchModule = await import(pathToFileURL(require2.resolve("node-fetch")).href);
  await initialize(router, { chat, converters, util, google, secrets, constants, runner, fetch: fetchModule.default }, { name: manifest.name, version: manifest.version });
  console.info(`[${PLUGIN_ID}] ${VERSION} \u5DF2\u52A0\u8F7D (${manifest.name} ${manifest.version})`);
}
export {
  info,
  init,
  initialize,
  wrapDispatch
};
