import { registerAsUniqueScript } from '@util/script';
import { klona } from 'klona';
import { defineStore } from 'pinia';
import { computed, ref, watchEffect } from 'vue';

export const SCRIPT_NAME = '现代化界面';

const LEGACY_DEFAULT_LEFT_SIDEBAR_WIDTH = 340;
export const DEFAULT_LEFT_SIDEBAR_WIDTH = 360;
export const DEFAULT_OVERLAY_PANEL_WIDTH = 960;
export const DEFAULT_MAIN_CHAT_MIN_WIDTH = 960;

export type ModernLayoutSettings = z.infer<typeof ModernLayoutSettings>;
export const ModernLayoutSettings = z
  .object({
    enabled: z.boolean().default(true).catch(true),
    desktopTwoColumn: z.boolean().default(true).catch(true),
    desktopDockedDrawer: z.boolean().default(false).catch(false),
    leftSidebarWidth: z
      .number()
      .min(320)
      .max(460)
      .default(DEFAULT_LEFT_SIDEBAR_WIDTH)
      .catch(DEFAULT_LEFT_SIDEBAR_WIDTH),
    overlayPanelWidth: z
      .number()
      .min(720)
      .default(DEFAULT_OVERLAY_PANEL_WIDTH)
      .catch(DEFAULT_OVERLAY_PANEL_WIDTH),
    mainChatMaxWidth: z
      .number()
      .min(0)
      .default(DEFAULT_MAIN_CHAT_MIN_WIDTH)
      .catch(DEFAULT_MAIN_CHAT_MIN_WIDTH),
    reduceMotion: z.boolean().default(false).catch(false),
    reduceAdvancedEffects: z.boolean().default(false).catch(false),
    modernWorldInfoEditor: z.boolean().default(true).catch(true),
    modernCharacterManagement: z.boolean().default(true).catch(true),
    modernExtensionSettings: z.boolean().default(true).catch(true),
  })
  .prefault({});

function readSettings(): ModernLayoutSettings {
  const raw_settings = klona(getVariables({ type: 'script', script_id: getScriptId() }));
  if (raw_settings && typeof raw_settings === 'object') {
    const settings = raw_settings as Record<string, unknown>;
    if (settings.desktopTwoColumn === undefined && typeof settings.desktopThreeColumn === 'boolean') {
      settings.desktopTwoColumn = settings.desktopThreeColumn;
    }
    if (settings.overlayPanelWidth === undefined && settings.leftSidebarWidth === LEGACY_DEFAULT_LEFT_SIDEBAR_WIDTH) {
      settings.leftSidebarWidth = DEFAULT_LEFT_SIDEBAR_WIDTH;
    }
  }

  const result = ModernLayoutSettings.safeParse(raw_settings);
  if (result.success) {
    return result.data;
  }
  console.warn(`[${SCRIPT_NAME}] 设置读取失败，已使用默认设置。`, result.error);
  return ModernLayoutSettings.parse({});
}

export const useModernLayoutStore = defineStore(SCRIPT_NAME, () => {
  const settings = ref(readSettings());
  const should_enable = ref(false);

  const { unregister, getPreferredScriptId, listenPreferenceState } = registerAsUniqueScript(SCRIPT_NAME);
  should_enable.value = getPreferredScriptId() === getScriptId();
  const preference_event = listenPreferenceState(preferred_script_id => {
    should_enable.value = preferred_script_id === getScriptId();
  });

  const is_active = computed(() => should_enable.value && settings.value.enabled);
  const should_use_two_column = computed(() => is_active.value && settings.value.desktopTwoColumn);

  watchEffect(() => {
    const validSettings = ModernLayoutSettings.parse(klona(settings.value));
    updateVariablesWith(
      variables => ({
        ...variables,
        ...validSettings,
      }),
      { type: 'script', script_id: getScriptId() },
    );
  });

  function resetSettings() {
    settings.value = ModernLayoutSettings.parse({});
  }

  function disableModernLayout() {
    settings.value = { ...settings.value, enabled: false };
  }

  function destroy(options: { unregisterUnique?: boolean } = {}) {
    preference_event.stop();
    if (options.unregisterUnique !== false) {
      unregister();
    }
  }

  return {
    settings,
    should_enable,
    is_active,
    should_use_two_column,
    resetSettings,
    disableModernLayout,
    destroy,
  };
});
