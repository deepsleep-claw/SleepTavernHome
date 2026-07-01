<template>
  <Section label="处理条目">
    <template #label-suffix>
      <HelpIcon :help="depth_injection_help" />
    </template>

    <Select
      v-model="store.settings.entry_processing.mode"
      :options="[
        { label: '无', value: 'none' },
        { label: '处理 D⚙ 条目', value: 'depth' },
        { label: '处理世界书条目', value: 'worldbook' },
      ]"
    />

    <template v-if="store.settings.entry_processing.mode === 'depth'">
      <input
        v-model.number="store.settings.depth_injection.threshold"
        type="number"
        min="0"
        class="text_pole flex1 wide100p"
      />

      <Checkbox v-model="store.settings.depth_injection.above.enabled">
        <span>处理 D{{ store.settings.depth_injection.threshold }} 及以上的 D⚙ 条目</span>
      </Checkbox>

      <template v-if="store.settings.depth_injection.above.enabled">
        <Select
          v-model="store.settings.depth_injection.above.type"
          style="width: 90%; align-self: flex-end"
          :options="[
            { label: '按顺序插入到 D9999', value: 'exclude' },
            { label: `合并后替换到 ${store.settings.depth_injection.above.placeholder} 宏位置`, value: 'placeholder' },
          ]"
        />
      </template>

      <Checkbox v-model="store.settings.depth_injection.below.enabled">
        <span>处理 D{{ store.settings.depth_injection.threshold }} 以下的 D⚙ 条目</span>
      </Checkbox>

      <template v-if="store.settings.depth_injection.below.enabled">
        <Select
          v-model="store.settings.depth_injection.below.type"
          style="width: 90%; align-self: flex-end"
          :options="[
            { label: '按顺序插入到 D0', value: 'exclude' },
            { label: `合并后替换到 ${store.settings.depth_injection.below.placeholder} 宏位置`, value: 'placeholder' },
          ]"
        />
      </template>
    </template>

    <template v-if="store.settings.entry_processing.mode === 'worldbook'">
      <Checkbox v-model="store.settings.entry_processing.worldbook.aggressive_green_cache.enabled">
        <span>激进处理绿灯缓存</span>
      </Checkbox>

      <div class="TR-green-cache-actions">
        <button type="button" class="menu_button" @click="clearGreenCache">清空绿灯缓存</button>
      </div>

      <Checkbox v-model="store.settings.entry_processing.worldbook.constant.enabled">
        <span>提取无动态宏的蓝灯持久条目到 {{ store.settings.entry_processing.worldbook.constant.placeholder }}</span>
      </Checkbox>

      <Checkbox v-model="store.settings.entry_processing.worldbook.keyed.enabled">
        <span
          >提取绿灯非持久条目和含动态宏的蓝灯条目到
          {{ store.settings.entry_processing.worldbook.keyed.placeholder }}</span
        >
      </Checkbox>

      <Field label="提取条目排序">
        <div
          v-for="(position, index) in store.settings.entry_processing.worldbook.position_order"
          :key="position"
          class="TR-position-order-item flex-container alignitemscenter"
        >
          <span class="flex1">{{ position_labels[position] }}</span>
          <button type="button" class="menu_button" :disabled="index === 0" @click="movePosition(index, -1)">
            上移
          </button>
          <button
            type="button"
            class="menu_button"
            :disabled="index === store.settings.entry_processing.worldbook.position_order.length - 1"
            @click="movePosition(index, 1)"
          >
            下移
          </button>
        </div>
      </Field>
    </template>
  </Section>
</template>

<script setup lang="ts">
import { clearGreenCacheVariables } from '../green_cache';
import { WorldbookExtractionPositionOrder, useSettingsStore } from '../store';
import Checkbox from './component/Checkbox.vue';
import Field from './component/Field.vue';
import HelpIcon from './component/HelpIcon.vue';
import Section from './component/Section.vue';
import Select from './component/Select.vue';
import depth_injection_help from './help/depth_injection.md';

const store = useSettingsStore();

type WorldbookExtractionPosition = (typeof WorldbookExtractionPositionOrder)[number];

const position_labels: Record<WorldbookExtractionPosition, string> = {
  before_character_definition: '角色定义前',
  after_character_definition: '角色定义后',
  before_example_messages: '示例消息前',
  after_example_messages: '示例消息后',
  before_author_note: '作者注释前',
  after_author_note: '作者注释后',
  at_depth: 'D⚙ 消息（按照插入深度）',
};

function movePosition(index: number, offset: -1 | 1) {
  const order = store.settings.entry_processing.worldbook.position_order;
  const target_index = index + offset;
  if (target_index < 0 || target_index >= order.length) {
    return;
  }
  [order[index], order[target_index]] = [order[target_index], order[index]];
}

async function clearGreenCache() {
  const confirmed = await SillyTavern.callGenericPopup(
    '确定清空当前聊天的绿灯缓存吗？',
    SillyTavern.POPUP_TYPE.CONFIRM,
  );
  if (confirmed !== true && confirmed !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) {
    return;
  }
  clearGreenCacheVariables();
  toastr.info('已清空当前聊天的绿灯缓存。', '压缩相邻消息');
}
</script>

<style scoped>
.TR-position-order-item {
  gap: 0.35rem;
}

.TR-green-cache-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.35rem;
}
</style>
