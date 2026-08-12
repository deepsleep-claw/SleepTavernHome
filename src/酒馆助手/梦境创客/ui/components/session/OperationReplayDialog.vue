<template>
  <div v-if="request" class="dca-modal-backdrop" role="presentation">
    <section class="dca-modal dca-replay-dialog" role="dialog" aria-modal="true" aria-labelledby="dca-replay-title">
      <header>
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        <div>
          <strong id="dca-replay-title">部分文件不能安全{{ request.direction === 'undo' ? '撤销' : '重做' }}</strong>
          <span>这些文件在原操作后发生了变化。继续时会跳过它们，只处理其余操作。</span>
        </div>
      </header>
      <ul>
        <li v-for="conflict in request.conflicts" :key="conflict.operationId">
          <code>{{ conflict.path }}</code><span>{{ conflict.reason }}</span>
        </li>
      </ul>
      <footer>
        <button type="button" @click="action(() => runtime.confirmOperationReplay(false))">不进行操作</button>
        <button class="danger" type="button" @click="action(() => runtime.confirmOperationReplay(true))">
          跳过冲突并继续
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useDreamCardAgent } from '../../composables/runtime';

const { action, runtime, state } = useDreamCardAgent();
const request = computed(() => state.value.active?.operationReplay);
</script>

<style lang="scss">
.dca-replay-dialog { width: min(36rem, calc(100vw - 2rem)); }
.dca-replay-dialog > header { display: flex; gap: 0.7rem; }
.dca-replay-dialog > header i { color: var(--dca-warning); }
.dca-replay-dialog > header div,
.dca-replay-dialog li { display: grid; gap: 0.2rem; }
.dca-replay-dialog header span,
.dca-replay-dialog li span { color: var(--dca-text-muted); font-size: 0.78rem; }
.dca-replay-dialog ul { display: grid; max-height: 40vh; gap: 0.45rem; overflow: auto; padding: 0; list-style: none; }
.dca-replay-dialog footer { display: flex; justify-content: flex-end; gap: 0.5rem; }
</style>
