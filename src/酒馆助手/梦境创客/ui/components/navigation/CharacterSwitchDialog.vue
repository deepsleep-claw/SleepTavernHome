<template>
  <div v-if="characterSwitchRequest" class="dca-dialog-backdrop" @click.self="confirmCharacterSwitch(false)">
    <section class="dca-switch-dialog" role="alertdialog" aria-modal="true">
      <span class="dca-switch-icon"><i class="fa-solid fa-right-left" aria-hidden="true"></i></span>
      <h2>切换角色卡？</h2>
      <p>
        需要先在酒馆中切换到“{{ characterSwitchRequest.characterName }}”，才能{{
          characterSwitchRequest.kind === 'create' ? '新建会话' : '打开并继续这段会话'
        }}。
      </p>
      <small>切换前会校验所有任务状态；切换后也会核对角色卡的唯一绑定。</small>
      <footer>
        <button type="button" @click="confirmCharacterSwitch(false)">取消</button
        ><button class="primary" type="button" @click="confirmCharacterSwitch(true)">确认切换</button>
      </footer>
    </section>
  </div>
</template>
<script setup lang="ts">
import { useDreamCardAgent } from '../../composables/runtime';
const { characterSwitchRequest, confirmCharacterSwitch } = useDreamCardAgent();
</script>
<style lang="scss">
.dca-switch-dialog {
  width: min(26rem, 100%);
  padding: 1.4rem;
  border: 1px solid var(--dca-border-strong);
  border-radius: var(--dca-radius-lg);
  background: var(--dca-raised);
  box-shadow: var(--dca-shadow-3);
  text-align: center;
}
.dca-switch-icon {
  display: grid;
  width: 3rem;
  height: 3rem;
  margin: 0 auto 0.8rem;
  place-items: center;
  border-radius: 0.9rem;
  background: var(--dca-accent-soft);
  color: var(--dca-accent);
  font-size: 1.2rem;
}
.dca-switch-dialog h2 {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
}
.dca-switch-dialog p {
  margin: 0;
  line-height: 1.65;
}
.dca-switch-dialog small {
  display: block;
  margin-top: 0.65rem;
  color: var(--dca-text-muted);
  line-height: 1.55;
}
.dca-switch-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.55rem;
  margin-top: 1.2rem;
}
.dca-switch-dialog footer button {
  flex: 1;
}
.dca-switch-dialog footer .primary {
  border-color: var(--dca-accent);
  background: var(--dca-accent);
  color: var(--dca-on-accent);
}
</style>
