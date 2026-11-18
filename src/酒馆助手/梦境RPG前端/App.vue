<template>
  <section
    class="drpg-journal"
    :data-theme="snapshot?.theme ?? 'light'"
    :style="themeVariables[snapshot?.theme ?? 'light']"
    aria-label="梦境行旅"
  >
    <header class="drpg-journal-header">
      <span class="drpg-emblem" aria-hidden="true">◇</span>
      <h2>梦境行旅</h2>
      <span class="drpg-subtitle">此刻，轮到你</span>
      <button
        v-if="api"
        type="button"
        class="drpg-settings-button"
        aria-label="打开RPG设置"
        :aria-expanded="settingsOpen"
        aria-controls="drpg-interface-settings"
        @click="settingsOpen = !settingsOpen"
      >
        ⚙
      </button>
      <button
        type="button"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? '展开行动' : '收起行动'"
        @click="collapsed = !collapsed"
      >
        {{ collapsed ? '⌄' : '⌃' }}
      </button>
    </header>
    <div v-if="!available" class="drpg-notice" role="alert">{{ connectionMessage }}</div>
    <div v-if="error" class="drpg-notice" role="alert">{{ error }}</div>
    <section
      v-if="settingsOpen && api && snapshot"
      id="drpg-interface-settings"
      class="drpg-interface-settings"
      aria-label="界面设置"
    >
      <h3>界面设置</h3>
      <label class="drpg-interface-setting">
        <input
          type="checkbox"
          :checked="snapshot.settings.enabled"
          @change="changeSettings({ enabled: ($event.target as HTMLInputElement).checked })"
        />
        <span>启用 RPG 交互</span>
      </label>
      <label class="drpg-interface-setting">
        <input
          type="checkbox"
          :checked="snapshot.settings.reuse_rolls"
          @change="changeSettings({ reuse_rolls: ($event.target as HTMLInputElement).checked })"
        />
        <span>复用相同行动的骰点</span>
      </label>
      <label v-if="snapshot.settings.preview_results !== undefined" class="drpg-interface-setting">
        <input
          type="checkbox"
          :checked="snapshot.settings.preview_results"
          @change="changeSettings({ preview_results: ($event.target as HTMLInputElement).checked })"
        />
        <span>提前查看结果</span>
      </label>
      <label class="drpg-interface-setting">
        <input
          type="checkbox"
          :checked="snapshot.settings.allow_secret_reveal"
          @change="changeSettings({ allow_secret_reveal: ($event.target as HTMLInputElement).checked })"
        />
        <span>允许显示暗骰</span>
      </label>
      <label class="drpg-interface-setting">
        <span>界面主题</span>
        <select
          :value="snapshot.settings.theme"
          @change="changeSettings({ theme: ($event.target as HTMLSelectElement).value as RpgSettings['theme'] })"
        >
          <option value="auto">跟随酒馆</option>
          <option value="light">暖纸亮色</option>
          <option value="dark">墨蓝暗色</option>
        </select>
      </label>
      <small>设置自动保存</small>
    </section>
    <div v-if="snapshot && !collapsed" class="drpg-journal-body">
      <div v-if="available && snapshot.settings.allow_secret_reveal" class="drpg-secret-tools">
        <button type="button" :aria-pressed="revealSecretDc" @click="revealSecretDc = !revealSecretDc">
          {{ revealSecretDc ? '收起暗骰难度' : '查看本轮暗骰难度' }}
        </button>
      </div>
      <template v-for="(part, index) in snapshot.registry.parts" :key="index">
        <p v-if="part.kind === 'prose'" class="drpg-prose">
          <template v-for="(item, itemIndex) in part.items" :key="itemIndex">
            <template v-if="item.kind === 'text'">{{ item.text }}</template>
            <button
              v-else
              class="drpg-inline"
              type="button"
              :disabled="!canChoose(item.entry) || !!item.entry.options[0].error"
              :title="item.entry.error || item.entry.options[0].error || badge(item.entry.options[0])"
              :aria-pressed="selected(item.entry, item.entry.options[0].text)"
              @click="choose(item.entry)"
            >
              {{ item.entry.options[0].text
              }}<small :style="{ '--drpg-difficulty-color': optionDifficulty(item.entry.options[0])?.color }">{{
                badge(item.entry.options[0])
              }}</small>
            </button>
          </template>
        </p>
        <section v-else class="drpg-group" :data-type="part.entry.type">
          <span class="drpg-eyebrow">{{ part.entry.type === 'handle' ? '应对眼前' : '自由探索' }}</span>
          <h3>{{ part.entry.q }}</h3>
          <p v-if="part.entry.error" class="drpg-notice">{{ part.entry.error }}</p>
          <div class="drpg-options">
            <button
              v-for="(option, optionIndex) in part.entry.options"
              :key="optionIndex"
              type="button"
              class="drpg-option"
              :disabled="!canChoose(part.entry) || !!option.error"
              :aria-pressed="selected(part.entry, option.text)"
              :title="option.error"
              @click="choose(part.entry, optionIndex)"
            >
              <span class="drpg-letter">{{ String.fromCharCode(65 + optionIndex) }}</span>
              <span class="drpg-action-text">{{ option.text }}</span>
              <small :style="{ '--drpg-difficulty-color': optionDifficulty(option)?.color }">{{ badge(option) }}</small
              ><span v-if="selected(part.entry, option.text)" aria-hidden="true">✓</span>
            </button>
          </div>
          <form class="drpg-custom" @submit.prevent="choose(part.entry, -1)">
            <span aria-hidden="true">✎</span>
            <input
              v-model="custom[part.entry.id]"
              :disabled="!canChoose(part.entry)"
              :aria-label="part.entry.q + '：自定义行动'"
              placeholder="也可以试试别的办法…"
              @keydown.stop
            />
            <button type="submit" :disabled="!canChoose(part.entry) || !custom[part.entry.id]?.trim()">写入</button>
          </form>
        </section>
      </template>
      <p v-if="!snapshot.registry.parts.length" class="drpg-notice">当前楼层没有完整的行动选项。</p>
      <p v-if="status" class="drpg-status" role="status">{{ status }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { describeDifficulty } from '../梦境RPG/difficulty';
import {
  GLOBAL_KEY,
  type DreamRpgApi,
  type RpgEntry,
  type RpgOption,
  type RpgSnapshot,
  type RpgSettings,
} from '../梦境RPG/protocol';
import { themeVariables } from '../梦境RPG/theme';

const api = shallowRef<DreamRpgApi>();
const snapshot = shallowRef<RpgSnapshot>();
const collapsed = ref(false);
const settingsOpen = ref(false);
const revealSecretDc = ref(false);
const custom = ref<Record<string, string>>({});
const error = ref('');
const status = ref('');
const available = computed(() => !!api.value?.active);
const connectionMessage = computed(() =>
  api.value
    ? '梦境RPG脚本已停用，请在设置中启用。'
    : '未检测到梦境RPG脚本，功能不可用。请在酒馆助手脚本库中导入并启用脚本。',
);
let timer: ReturnType<typeof setInterval>;
let messageId: number;
let signature = '';
let statusTimer: ReturnType<typeof setTimeout>;
function update() {
  try {
    const shared = (window.parent as Window & { DreamRpg?: DreamRpgApi })[GLOBAL_KEY];
    api.value = shared?.version === 1 && typeof shared.updateSettings === 'function' ? shared : undefined;
    if (!api.value) {
      snapshot.value = undefined;
      revealSecretDc.value = false;
      signature = '';
      return;
    }
    const next = api.value.snapshot(messageId);
    if (
      !api.value.active ||
      !next.settings.allow_secret_reveal ||
      snapshot.value?.registry.source !== next.registry.source
    ) {
      revealSecretDc.value = false;
    }
    error.value = '';
    const nextSignature = JSON.stringify(next);
    if (signature !== nextSignature) {
      snapshot.value = next;
      signature = nextSignature;
    }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}
function optionDifficulty(option: RpgOption) {
  if (
    option.mode === 'none' ||
    (option.mode === 'secret' && !(revealSecretDc.value && snapshot.value?.settings.allow_secret_reveal))
  )
    return undefined;
  return describeDifficulty(option.dc);
}
function badge(option: RpgOption) {
  if (option.mode === 'none' || option.dc === 'none') return '无需检定';
  const difficulty = optionDifficulty(option);
  if (option.mode === 'secret') return difficulty ? `◇ 暗骰 · ${difficulty.text}` : '◇ 暗骰';
  return difficulty?.text ?? '难度待定';
}
function changeSettings(settings: Partial<RpgSettings>) {
  try {
    api.value!.updateSettings(settings);
    error.value = '';
    update();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}
function canChoose(entry: RpgEntry) {
  return available.value && snapshot.value?.interactive && !entry.error;
}
function selected(entry: RpgEntry, text: string) {
  return snapshot.value?.interactive && snapshot.value.selected[entry.id] === text;
}
function choose(entry: RpgEntry, select?: number) {
  if (!canChoose(entry)) return;
  try {
    api.value!.choose(messageId, entry.id, select, custom.value[entry.id]);
    error.value = '';
    status.value = '已写入输入框';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      status.value = '';
    }, 1800);
    if (select === -1) custom.value[entry.id] = '';
    update();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}
onMounted(() => {
  messageId = getCurrentMessageId();
  update();
  timer = setInterval(update, 600);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  clearTimeout(statusTimer);
});
</script>

<style>
html,
body {
  margin: 0;
  padding: 0;
  background: transparent;
}
</style>
<style scoped>
.drpg-journal {
  --paper: var(--drpg-paper, #f6efe1);
  --ink: var(--drpg-ink, #29271e);
  --muted: var(--drpg-muted, #746a57);
  --line: var(--drpg-line, #b99c67);
  --soft-line: var(--drpg-soft-line, #cfbfa2);
  --selected: var(--drpg-good, #dfe6c9);
  --selected-ink: var(--drpg-selected-ink, #2b3b1d);
  --input: var(--drpg-input, #fff8ec);
  box-sizing: border-box;
  width: 100%;
  color: var(--ink);
  background: radial-gradient(ellipse at top, #ffffff14, transparent 70%), var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  font-family: 'Noto Serif SC', 'Songti SC', STSong, SimSun, serif;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.drpg-journal * {
  box-sizing: border-box;
}
.drpg-journal button,
.drpg-journal input {
  font: inherit;
  color: inherit;
}
.drpg-journal button {
  cursor: pointer;
}
.drpg-journal button:disabled,
.drpg-journal input:disabled {
  cursor: default;
  opacity: 0.5;
}
.drpg-journal button:focus-visible,
.drpg-journal input:focus-visible {
  outline: 2px solid var(--line);
  outline-offset: 3px;
}
.drpg-journal-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 2px solid var(--line);
  background: #17232d;
  color: #ecddb9;
}
.drpg-journal-header h2 {
  flex: 0 1 auto;
  margin: 0;
  font-size: 1.3em;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.drpg-emblem {
  font-size: 1.9em;
  line-height: 1;
}
.drpg-subtitle {
  margin-right: auto;
  padding-left: 12px;
  border-left: 1px solid #b99c6770;
  font-size: 0.85em;
}
.drpg-journal-header button {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 4px;
  font-family: sans-serif;
  font-size: 1.15em;
}
.drpg-journal-body {
  padding: 12px 20px 18px;
}
.drpg-secret-tools {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 10px;
}
.drpg-secret-tools button {
  padding: 3px 9px;
  border: 1px solid var(--soft-line);
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  font-size: 0.8em;
}
.drpg-secret-tools button[aria-pressed='true'] {
  border-color: var(--line);
  background: var(--selected);
  color: var(--selected-ink);
}
.drpg-interface-settings {
  display: grid;
  gap: 10px;
  margin: 12px 20px;
  padding: 12px;
  border: 1px solid var(--soft-line);
  border-radius: 7px;
  background: var(--input);
  font-size: 0.9em;
}
.drpg-interface-settings h3 {
  margin: 0;
  font-size: 1em;
}
.drpg-interface-settings small {
  color: var(--muted);
}
.drpg-interface-setting {
  display: flex;
  gap: 9px;
  align-items: center;
  flex-wrap: wrap;
}
.drpg-interface-setting input {
  accent-color: var(--line);
}
.drpg-interface-setting select {
  padding: 4px 7px;
  max-width: 100%;
  border: 1px solid var(--soft-line);
  border-radius: 5px;
  background: var(--paper);
  color: var(--ink);
  font: inherit;
}
.drpg-prose {
  margin: 3px 0 15px;
  white-space: pre-line;
}
.drpg-inline {
  display: inline;
  margin: 1px 3px;
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #81994d14;
  line-height: 1.65;
  box-decoration-break: clone;
}
.drpg-inline small {
  margin-left: 5px;
  font-size: 0.7em;
  color: var(--drpg-difficulty-color, var(--muted));
  white-space: nowrap;
}
.drpg-inline[aria-pressed='true'] {
  background: var(--selected);
}
.drpg-group {
  border-top: 1px solid var(--line);
  padding-top: 13px;
  margin-top: 12px;
  margin-bottom: 15px;
}
.drpg-group:last-of-type {
  margin-bottom: 0;
}
.drpg-eyebrow {
  display: inline-block;
  padding: 0 13px 0 7px;
  background: #974b2d;
  color: #fff3db;
  font-size: 0.78em;
  letter-spacing: 0.08em;
  clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%);
}
.drpg-group[data-type='explore'] .drpg-eyebrow {
  background: #4d673b;
}
.drpg-group h3 {
  margin: 4px 0 10px;
  font-size: 1.07em;
  font-weight: 700;
}
.drpg-options {
  display: grid;
  gap: 6px;
}
.drpg-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--soft-line);
  border-radius: 7px;
  background: transparent;
  text-align: left;
  line-height: 1.5;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.drpg-option:hover:enabled,
.drpg-inline:hover:enabled {
  border-color: var(--line);
  background: #a9925e20;
}
.drpg-option[aria-pressed='true'] {
  border-color: #869454;
  background: var(--selected);
  color: var(--selected-ink);
}
.drpg-letter {
  flex: 0 0 23px;
  border-right: 1px solid var(--soft-line);
  font-family: Georgia, serif;
}
.drpg-action-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}
.drpg-option small {
  flex: 0 0 auto;
  color: var(--drpg-difficulty-color, var(--muted));
  font-size: 0.8em;
  white-space: nowrap;
}
.drpg-custom {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}
.drpg-custom > span {
  padding-left: 8px;
  color: var(--muted);
}
.drpg-custom input {
  width: 0;
  flex: 1 1 auto;
  border: 1px solid var(--soft-line);
  border-radius: 6px;
  background: var(--input);
  padding: 7px 9px;
  font-size: 0.86em;
}
.drpg-custom input::placeholder {
  color: var(--muted);
}
.drpg-custom button {
  flex: 0 0 auto;
  border: 1px solid #83945e;
  border-radius: 6px;
  background: #486040;
  color: #f3ecd4;
  padding: 6px 14px;
}
.drpg-notice {
  margin: 12px;
  padding: 10px 12px;
  border: 1px solid var(--soft-line);
  border-radius: 6px;
  font-size: 0.9em;
}
.drpg-status {
  margin: 0;
  font-size: 0.8em;
  color: var(--muted);
}
.drpg-status {
  margin-top: 10px;
}
@media (min-width: 640px) {
  .drpg-group[data-type='explore'] .drpg-options {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 420px) {
  .drpg-journal-header {
    gap: 8px;
    padding: 10px 12px;
  }
  .drpg-journal-header h2 {
    font-size: 1.1em;
  }
  .drpg-subtitle {
    display: none;
  }
  .drpg-settings-button {
    margin-left: auto;
  }
  .drpg-journal-body {
    padding: 12px;
  }
  .drpg-option {
    padding: 9px 8px;
  }
  .drpg-custom {
    gap: 5px;
  }
  .drpg-custom > span {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .drpg-option {
    transition: none;
  }
}
</style>
