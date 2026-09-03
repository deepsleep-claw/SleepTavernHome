export const PRESET_ADAPTER_THEME_IDS = [
  'night-gold',
  'deep-blue',
  'purple-black',
  'jade-green',
  'moon-white',
  'frost-blue',
] as const;

export type PresetAdapterThemeId = (typeof PRESET_ADAPTER_THEME_IDS)[number];

export type PresetAdapterTheme = {
  description: string;
  icon: string;
  id: PresetAdapterThemeId;
  label: string;
  mode: 'dark' | 'light';
  swatches: readonly [string, string, string, string];
};

export const DEFAULT_PRESET_ADAPTER_THEME: PresetAdapterThemeId = 'night-gold';

export const PRESET_ADAPTER_THEMES: readonly PresetAdapterTheme[] = [
  {
    description: '深夜底色与温暖金线',
    icon: 'fa-moon',
    id: 'night-gold',
    label: '夜金',
    mode: 'dark',
    swatches: ['#090f1e', '#191b2a', '#f2bd65', '#fff0d6'],
  },
  {
    description: '深海蓝与清亮冰青',
    icon: 'fa-water',
    id: 'deep-blue',
    label: '深蓝',
    mode: 'dark',
    swatches: ['#06152a', '#0d2b4c', '#36a8ff', '#dceeff'],
  },
  {
    description: '曜石黑与紫晶微光',
    icon: 'fa-wand-magic-sparkles',
    id: 'purple-black',
    label: '紫黑',
    mode: 'dark',
    swatches: ['#100b1d', '#241438', '#a75cff', '#f1e4ff'],
  },
  {
    description: '浅青瓷与温润墨绿',
    icon: 'fa-leaf',
    id: 'jade-green',
    label: '青绿',
    mode: 'light',
    swatches: ['#edf7f2', '#d8ece3', '#238768', '#183f35'],
  },
  {
    description: '月白纸面与淡金细节',
    icon: 'fa-cloud-moon',
    id: 'moon-white',
    label: '月白',
    mode: 'light',
    swatches: ['#fbf8f1', '#eee6d8', '#b7873d', '#42382e'],
  },
  {
    description: '冰霜蓝白与清晰层次',
    icon: 'fa-snowflake',
    id: 'frost-blue',
    label: '霜蓝',
    mode: 'light',
    swatches: ['#f2f8ff', '#dceafb', '#2379ce', '#173a5e'],
  },
];

export function isPresetAdapterThemeId(value: unknown): value is PresetAdapterThemeId {
  return typeof value === 'string' && PRESET_ADAPTER_THEME_IDS.some(theme_id => theme_id === value);
}
