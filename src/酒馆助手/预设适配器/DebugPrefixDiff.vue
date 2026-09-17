<template>
  <section class="pa-prefix-diff" aria-label="首差正文对照">
    <header><span>首处差异</span><button type="button" @click="locate">定位首差</button></header>
    <div class="pa-prefix-columns">
      <section>
        <h5>{{ currentLabel }}</h5>
        <div
          ref="left"
          class="pa-prefix-scroll"
          tabindex="0"
          aria-label="当前记录正文"
          @scroll="sync('left')"
          @keydown.stop
        >
          <pre><mark>{{ currentText.slice(0, prefixUnits) }}</mark><span ref="left_mark" class="pa-prefix-boundary">{{ first(currentText) }}</span>{{ rest(currentText) }}<span v-if="currentText.length === prefixUnits" class="pa-prefix-end">（到此结束）</span></pre>
        </div>
      </section>
      <section>
        <h5>{{ otherLabel }}</h5>
        <div
          ref="right"
          class="pa-prefix-scroll"
          tabindex="0"
          aria-label="对照记录正文"
          @scroll="sync('right')"
          @keydown.stop
        >
          <pre><mark>{{ otherText.slice(0, prefixUnits) }}</mark><span ref="right_mark" class="pa-prefix-boundary">{{ first(otherText) }}</span>{{ rest(otherText) }}<span v-if="otherText.length === prefixUnits" class="pa-prefix-end">（到此结束）</span></pre>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
const props = defineProps<{
  currentText: string;
  otherText: string;
  prefixUnits: number;
  currentLabel: string;
  otherLabel: string;
}>();
const left = ref<HTMLElement>();
const right = ref<HTMLElement>();
const left_mark = ref<HTMLElement>();
const right_mark = ref<HTMLElement>();
let syncing = false;
let frame: number | undefined;
function first(text: string): string {
  const code = text.codePointAt(props.prefixUnits);
  return code === undefined ? '' : String.fromCodePoint(code);
}
function rest(text: string): string {
  return text.slice(props.prefixUnits + first(text).length);
}
function sync(side: 'left' | 'right') {
  if (syncing) return;
  const source = side === 'left' ? left.value : right.value;
  const target = side === 'left' ? right.value : left.value;
  if (!source || !target) return;
  syncing = true;
  target.scrollLeft = source.scrollLeft;
  target.scrollTop = source.scrollTop;
  frame = requestAnimationFrame(() => {
    syncing = false;
    frame = undefined;
  });
}
async function locate() {
  await nextTick();
  for (const [pane, mark] of [
    [left.value, left_mark.value],
    [right.value, right_mark.value],
  ]) {
    if (!pane || !mark) continue;
    const area = pane.getBoundingClientRect();
    const point = mark.getBoundingClientRect();
    pane.scrollLeft = Math.max(0, pane.scrollLeft + point.left - area.left - pane.clientWidth * 0.35);
    pane.scrollTop = Math.max(0, pane.scrollTop + point.top - area.top - 48);
  }
}
watch(
  () => [props.currentText, props.otherText, props.prefixUnits],
  () => {
    void locate();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (frame !== undefined) cancelAnimationFrame(frame);
});
</script>

<style scoped>
.pa-prefix-diff {
  margin: 0.3rem 0 0.7rem;
  min-width: 0;
}
.pa-prefix-diff header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.85rem;
}
.pa-prefix-diff button {
  border: 1px solid var(--pa-border);
  background: var(--pa-surface-soft);
  color: var(--pa-text);
  border-radius: 6px;
  padding: 0.25rem 0.45rem;
  font: inherit;
  cursor: pointer;
}
.pa-prefix-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
}
.pa-prefix-columns section {
  min-width: 0;
}
.pa-prefix-columns h5 {
  margin: 0.5rem 0 0.3rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--pa-muted);
  overflow-wrap: anywhere;
}
.pa-prefix-scroll {
  max-height: 19rem;
  overflow: auto;
  border: 1px solid var(--pa-border);
  border-radius: 6px;
  background: var(--pa-ink);
  padding: 0.6rem;
  overscroll-behavior: contain;
}
.pa-prefix-scroll pre {
  display: block;
  width: max-content;
  min-width: 100%;
  margin: 0;
  font: 0.82rem/1.7 monospace;
  white-space: pre;
  overflow-wrap: normal;
  word-break: normal;
  color: var(--pa-text);
}
.pa-prefix-scroll mark {
  background: rgb(58 159 111 / 15%);
  color: inherit;
  border: 1px solid #61b88a;
  border-radius: 2px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
.pa-prefix-scroll mark:empty {
  display: none;
}
.pa-prefix-boundary {
  background: rgb(217 90 102 / 23%);
  outline: 1px solid #d9757f;
}
.pa-prefix-boundary:empty {
  outline: none;
}
.pa-prefix-end {
  color: var(--pa-muted);
}
@container (max-width: 600px) {
  .pa-prefix-columns {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
