import { describe, expect, it } from 'vitest';
import { getNativeWorldbookHash, WorldbookScanLedger } from './worldbook_scan';
import type { WorldbookEntryMetadata } from './worldbook_analysis';
import { entry, type TestEntry } from './test-helpers';

function metadata(raw: TestEntry): WorldbookEntryMetadata {
  return {
    key: `${raw.world}.${raw.uid}`,
    world: raw.world,
    uid: raw.uid,
    name: raw.comment ?? '',
    is_constant: raw.constant,
    is_disabled: raw.disable === true,
    content: raw.content,
    content_hash: raw.content,
    content_candidates: [raw.content],
    split_getwi_parts: [],
    has_dynamic_macro: raw.content.includes('{{'),
    rule_context: {
      world: raw.world,
      name: raw.comment ?? '',
      content: raw.content,
      sources: ['character'],
      trigger: raw.constant ? 'constant' : 'selective',
    },
  };
}
function load(ledger: WorldbookScanLedger, raw: TestEntry[]) {
  ledger.loaded(raw, new Map(raw.map(value => [`${value.world}.${value.uid}`, metadata(value)])));
  return raw.map(value => ({ ...structuredClone(value), hash: getNativeWorldbookHash(value) }));
}

describe('只读世界书扫描快照', () => {
  it('跨克隆与宏展开关联原文，并且不改写任何扫描正文', () => {
    const ledger = new WorldbookScanLedger();
    const raw = entry(1, '时间{{clock}}');
    const scanned = load(ledger, [raw]);
    scanned[0].content = '时间12:00';
    ledger.scanned(scanned, scanned);
    expect(ledger.activated(scanned)?.metadata.get('设定.1')?.content).toBe('时间{{clock}}');
    expect(raw.content).toBe('时间{{clock}}');
    expect(scanned[0].content).toBe('时间12:00');
  });

  it('交错扫描按返回的条目对象确认，不使用最后一次全局快照', () => {
    const ledger = new WorldbookScanLedger();
    const main = load(ledger, [entry(1, '主请求正文')]);
    const auxiliary = load(ledger, [entry(1, '副请求正文')]);
    ledger.scanned(auxiliary, auxiliary);
    ledger.scanned(main, main);
    expect(ledger.activated(auxiliary)?.metadata.get('设定.1')?.content).toBe('副请求正文');
    expect(ledger.activated(main)?.metadata.get('设定.1')?.content).toBe('主请求正文');
    ledger.loaded([entry(1, '后续变更')], new Map());
    expect(ledger.activated(main)?.metadata.get('设定.1')?.content).toBe('主请求正文');
  });

  it('确认后的快照与扫描缓存相互独立', () => {
    const ledger = new WorldbookScanLedger();
    const scanned = load(ledger, [entry(1, '正文')]);
    ledger.scanned(scanned, scanned);
    ledger.activated(scanned)!.metadata.get('设定.1')!.content = '局部改动';
    expect(ledger.activated(scanned)?.metadata.get('设定.1')?.content).toBe('正文');
  });

  it('零激活仍提供一致的原书元信息供缓存校验', () => {
    const ledger = new WorldbookScanLedger();
    const scanned = load(ledger, [entry(1, '绿灯正文', { constant: false, disable: true })]);
    ledger.scanned(scanned, []);
    expect(ledger.cacheSnapshot().metadata.get('设定.1')?.is_disabled).toBe(true);
    expect(ledger.cacheSnapshot().worlds.has('设定')).toBe(true);
  });

  it('零激活快照发生冲突时暂停该条缓存且不据此删除旧记录', () => {
    const ledger = new WorldbookScanLedger();
    const before = load(ledger, [entry(1, '旧正文')]);
    ledger.scanned(before, []);
    const after = load(ledger, [entry(1, '新正文')]);
    ledger.scanned(after, []);
    expect(ledger.cacheSnapshot().metadata.has('设定.1')).toBe(false);
    expect(ledger.cacheSnapshot().worlds.has('设定')).toBe(false);
  });

  it('无法关联的 hash 不冒用其他扫描内容，新的生成清理旧归属', () => {
    const ledger = new WorldbookScanLedger();
    const scanned = load(ledger, [entry(1, '正文')]);
    scanned[0].hash++;
    ledger.scanned(scanned, []);
    expect(ledger.cacheSnapshot().metadata.size).toBe(0);
    expect(ledger.cacheSnapshot().worlds.size).toBe(0);
    ledger.begin();
    expect(ledger.activated(scanned)).toBeUndefined();
    expect(ledger.cacheSnapshot().metadata.size).toBe(0);
  });

  it('装饰器与正文共同参与原生指纹', () => {
    const raw = entry(1, '@@activate\n正文');
    expect(getNativeWorldbookHash(raw)).not.toBe(getNativeWorldbookHash({ ...raw, content: '正文' }));
    expect(getNativeWorldbookHash(raw)).toBe(getNativeWorldbookHash(structuredClone(raw)));
  });

  it('只有加载和激活事件时可按原文指纹关联，并提供零激活缓存元信息', () => {
    const ledger = new WorldbookScanLedger();
    const scanned = load(ledger, [entry(1, '{{clock}}'), entry(2, '绿灯', { constant: false })]);
    scanned[0].content = '12:00';
    expect(ledger.activated([scanned[0]])?.metadata.get('设定.1')?.content).toBe('{{clock}}');
    expect(ledger.cacheSnapshot().metadata.get('设定.2')?.content).toBe('绿灯');
  });
});
