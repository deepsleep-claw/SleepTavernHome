<template>
  <div v-if="!state.onboardingDone" class="dca-modal-backdrop">
    <section class="dca-modal dca-onboarding" role="dialog" aria-modal="true" aria-label="快速引导">
      <span class="dca-onboarding-step">快速引导 {{ step + 1 }} / 5</span>
      <h3>{{ onboarding[step].title }}</h3>
      <p>{{ onboarding[step].body }}</p>
      <div class="dca-onboarding-dots" aria-hidden="true">
        <i v-for="(_, index) in onboarding" :key="index" :class="{ active: index === step }"></i>
      </div>
      <div class="dca-row-actions">
        <button class="dca-btn-ghost" type="button" @click="finish">跳过</button>
        <button class="dca-btn-primary" type="button" @click="next">
          {{ step === 4 ? '开始创作' : '下一步' }}
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useDreamCardAgent } from '../composables/runtime';

const { action, runtime, state } = useDreamCardAgent();

const step = ref(0);
const onboarding = [
  { title: '先打开角色卡', body: '梦境创客只编辑当前单角色卡，并用稳定绑定避免会话串卡。' },
  { title: '准备API', body: '保存Base URL、Key和模型；也可以显式读取接口提供的模型列表。' },
  { title: '像文件一样创作', body: '角色字段、开场白、世界书和Skill都投影到隔离的Card Workspace。' },
  { title: '先快照，再修改', body: '每条要求都有检查点；普通模式逐项批准，YOLO仍拦截高危操作。' },
  {
    title: '窗口可以放心关闭',
    body: '关闭浮窗不会停止本页中的Agent；任务结束后才会批量保存，关闭浏览器会丢弃尚未结束的本轮运行。',
  },
];

async function finish() {
  await action(() => runtime.updateSettings({ onboardingDone: true }));
}

async function next() {
  if (step.value < 4) step.value += 1;
  else await finish();
}
</script>

<style lang="scss">
.dca-onboarding {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.dca-onboarding-step {
  color: var(--dca-accent);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.06em;
}

.dca-onboarding h3 {
  margin: 0;
  font-size: 1.2rem;
}

.dca-onboarding p {
  margin: 0;
  color: var(--dca-text-secondary);
}

.dca-onboarding-dots {
  display: flex;
  gap: 0.35rem;
  margin: 0.6rem 0 0.2rem;
}

.dca-onboarding-dots i {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: var(--dca-border-strong);
}

.dca-onboarding-dots i.active {
  background: var(--dca-accent);
}

.dca-onboarding .dca-row-actions {
  justify-content: flex-end;
  margin-top: 0.4rem;
}
</style>
