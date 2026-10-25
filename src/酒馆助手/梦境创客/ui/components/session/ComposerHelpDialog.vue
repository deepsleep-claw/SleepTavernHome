<template>
  <div class="dca-modal-backdrop" @click.self="emit('close')" @keydown.esc.stop="emit('close')">
    <section
      ref="dialog"
      class="dca-modal dca-command-help"
      role="dialog"
      aria-modal="true"
      aria-label="指令帮助"
      @keydown.tab="keepFocus"
    >
      <header>
        <strong>指令帮助</strong
        ><button ref="closeButton" type="button" aria-label="关闭指令帮助" @click="emit('close')">关闭</button>
      </header>
      <div class="dca-command-help-list">
        <button
          v-for="command in COMPOSER_COMMANDS"
          :key="command.id"
          type="button"
          @click="emit('choose', command.id)"
        >
          <code>{{ command.usage }}</code
          ><span>{{ command.description }}</span>
        </button>
        <p>输入 / 搜索指令，选择后可继续填写参数，再提交执行。模型、推理和 Skill 可从候选列表选择。</p>
        <p>输入 @ 搜索当前会话的角色资料、世界书、预设、聊天、Skills 和文件。选择后会插入可复制的资源链接。</p>
      </div>
    </section>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { COMPOSER_COMMANDS, type ComposerCommandId } from '../../../core/session/composer-commands';
const emit = defineEmits<{ close: []; choose: [id: ComposerCommandId] }>();
const dialog = ref<HTMLElement>();
const closeButton = ref<HTMLButtonElement>();
function keepFocus(event: KeyboardEvent) {
  const buttons = dialog.value?.querySelectorAll<HTMLButtonElement>('button');
  if (!buttons?.length) return;
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}
onMounted(() => closeButton.value?.focus());
</script>
<style lang="scss">
.dca-command-help {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(36rem, calc(100% - 1rem));
  max-height: calc(100% - 1rem);
  min-height: 0;
  overflow: hidden;
}
.dca-command-help > header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}
.dca-command-help-list {
  overflow: hidden auto;
  overscroll-behavior: contain;
  touch-action: pan-y;
  min-height: 0;
}
.dca-command-help-list > button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  min-height: 2.75rem;
  padding: 0.65rem;
  gap: 0.2rem;
  text-align: left;
}
.dca-command-help-list code {
  white-space: normal;
  overflow-wrap: anywhere;
}
.dca-command-help-list span,
.dca-command-help-list p {
  font-size: 0.8rem;
  color: var(--dca-text-muted);
}
</style>
