<template>
  <div class="inline-drawer jimi-panel">
    <div class="inline-drawer-toggle inline-drawer-header" @click="refresh">
      <b>基米工具</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content jimi-body">
      <small class="jimi-hint">版本 {{ SCRIPT_VERSION }}</small>
      <label class="jimi-check">
        <input type="checkbox" :checked="store.settings.enabled" @change="toggle" />启用基米工具
      </label>
      <p class="jimi-hint">设置保存在本脚本变量中，切换角色、聊天或聊天补全预设后继续生效。</p>
      <label class="jimi-field"
        ><span>模型名称包含</span><input v-model="draft.modelNameIncludes" maxlength="128"
      /></label>
      <p class="jimi-hint">不区分大小写。使用酒馆当前选择的模型和 API。</p>
      <label class="jimi-check"><input v-model="draft.keepOriginalText" type="checkbox" />同时保留模型原来的正文</label>
      <label class="jimi-field">
        <span>工具选择</span>
        <select v-model="draft.forceMode">
          <option value="auto">自动选择</option>
          <option value="required">必须调用工具</option>
          <option value="named">必须调用指定正文工具</option>
        </select>
      </label>
      <label v-if="draft.forceMode === 'named'" class="jimi-field">
        <span>指定正文工具</span>
        <select v-model="draft.forcedTool">
          <option v-for="tool in draft.tools.filter(item => item.enabled)" :key="tool.name" :value="tool.name">
            {{ tool.name }}
          </option>
        </select>
      </label>
      <label class="jimi-field"><span>正文分隔符</span><textarea v-model="draft.separator" rows="2"></textarea></label>
      <details open>
        <summary>提示词</summary>
        <label class="jimi-field">
          <span>提示词注入方式</span>
          <select v-model="draft.promptMode">
            <option value="none">不注入</option>
            <option value="system_prompt">注入系统提示词</option>
            <option value="user">注入User</option>
            <option value="assistant">注入Assistant</option>
            <option value="system">注入System</option>
          </select>
        </label>
        <template v-if="['user', 'assistant', 'system'].includes(draft.promptMode)">
          <label class="jimi-field"
            ><span>注入深度</span><input v-model.number="draft.promptDepth" type="number" step="1"
          /></label>
          <p class="jimi-hint">
            按所选角色定位并追加：0 是第一条，1 是第二条；-1 是最后一条，-2 是倒数第二条。目标不存在时会显示警告。
          </p>
        </template>
        <label class="jimi-field"><span>提示词内容</span><textarea v-model="draft.prompt" rows="6"></textarea></label>
        <p
          class="jimi-hint"
          v-text="'支持 {{tool_names}} 和 {{tool_outputs}}；注入系统提示词会在请求开头新增系统消息。'"
        ></p>
      </details>
      <details open>
        <summary>正文工具（{{ draft.tools.length }}）</summary>
        <fieldset v-for="(tool, index) in draft.tools" :key="index">
          <legend>工具 {{ index + 1 }}</legend>
          <label class="jimi-check"><input v-model="tool.enabled" type="checkbox" />启用此工具</label>
          <label class="jimi-field"
            ><span>名称</span
            ><input :value="tool.name" @input="renameTool(index, ($event.target as HTMLInputElement).value)"
          /></label>
          <label class="jimi-field"><span>说明</span><textarea v-model="tool.description" rows="2"></textarea></label>
          <label class="jimi-field"
            ><span>参数 JSON Schema</span><textarea v-model="tool.schemaText" rows="9" spellcheck="false"></textarea>
          </label>
          <label class="jimi-field"
            ><span>正文字段路径（每行一个）</span
            ><textarea v-model="tool.outputPathsText" rows="3" spellcheck="false"></textarea>
          </label>
          <p class="jimi-hint">
            按填写顺序收集并连接字符串字段，例如 thinking 和 text，也支持 story.text 或 chapters[0].text。
          </p>
          <button type="button" @click="draft.tools.splice(index, 1)">删除工具</button>
        </fieldset>
        <button type="button" :disabled="draft.tools.length >= 32" @click="addTool">添加工具</button>
      </details>
      <p v-if="store.warning" class="jimi-warning" role="status">{{ store.warning }}</p>
      <p v-if="store.error" class="jimi-error" role="alert">{{ store.error }}</p>
      <p v-if="message" role="status">{{ message }}</p>
      <div class="jimi-actions"><button type="button" class="menu_button" @click="save">保存设置</button></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { toolOutputPaths } from '../../../projects/tool-output-bridge/src/shared/config';
import { describeError, SCRIPT_VERSION, SettingsSchema, type Settings } from './config';
import { useJimiStore } from './settings';

const store = useJimiStore();
const makeDraft = (settings: Settings) => ({
  ...(JSON.parse(JSON.stringify(settings)) as Settings),
  tools: settings.tools.map(tool => ({
    ...(JSON.parse(JSON.stringify(tool)) as Settings['tools'][number]),
    schemaText: JSON.stringify(tool.parameters, null, 2),
    outputPathsText: toolOutputPaths(tool).join('\n'),
  })),
});
const draft = ref(makeDraft(store.settings));
const message = ref('');
watch(
  () => store.settings,
  settings => {
    draft.value = makeDraft(settings);
    message.value = '';
  },
  { flush: 'sync' },
);

function refresh() {
  try {
    store.refresh();
    store.error = '';
  } catch (error) {
    store.error = describeError(error);
  }
}
function toggle(event: Event) {
  try {
    store.save({ ...store.settings, enabled: (event.target as HTMLInputElement).checked });
  } catch (error) {
    store.error = describeError(error);
    (event.target as HTMLInputElement).checked = store.settings.enabled;
  }
}
function renameTool(index: number, name: string) {
  const previous = draft.value.tools[index].name;
  draft.value.tools[index].name = name;
  if (draft.value.forcedTool === previous) draft.value.forcedTool = name;
}
function addTool() {
  const tool = makeDraft(SettingsSchema.parse({})).tools[0];
  let suffix = draft.value.tools.length + 1;
  while (draft.value.tools.some(item => item.name === `publish_story_${suffix}`)) suffix++;
  draft.value.tools.push({ ...tool, name: `publish_story_${suffix}` });
}
function save() {
  message.value = '';
  store.error = '';
  try {
    store.save({
      ...draft.value,
      enabled: store.settings.enabled,
      tools: draft.value.tools.map(({ schemaText, outputPathsText, ...tool }) => ({
        ...tool,
        parameters: JSON.parse(schemaText),
        outputPaths: outputPathsText
          .split(/\r?\n/)
          .map(path => path.trim())
          .filter(Boolean),
      })),
    });
    draft.value = makeDraft(store.settings);
    message.value = '已保存到脚本变量。';
  } catch (error) {
    store.error = describeError(error);
  }
}
</script>

<style scoped>
.jimi-panel {
  min-width: 0;
  text-align: left;
}
.jimi-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
.jimi-body {
  padding: 8px 0;
}
.jimi-field {
  display: grid;
  gap: 6px;
  margin: 12px 0;
}
.jimi-check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0;
}
input:not([type='checkbox']),
select,
textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
  border: 1px solid var(--SmartThemeBorderColor, #666);
  border-radius: 5px;
  color: inherit;
  background: var(--SmartThemeBotMesBlurTintColor, #0004);
  font: inherit;
}
textarea {
  resize: vertical;
  min-height: 48px;
}
button {
  padding: 7px 12px;
  border: 1px solid var(--SmartThemeBorderColor, #666);
  border-radius: 5px;
  color: inherit;
  background: var(--SmartThemeBotMesBlurTintColor, #0004);
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
details {
  margin-top: 18px;
}
summary {
  cursor: pointer;
  font-weight: bold;
}
fieldset {
  min-width: 0;
  padding: 12px;
  margin: 14px 0;
  border: 1px solid var(--SmartThemeBorderColor, #666);
  border-radius: 6px;
}
.jimi-hint {
  font-size: 0.85em;
  opacity: 0.75;
  line-height: 1.6;
}
.jimi-error,
.jimi-warning {
  color: #efad76;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
