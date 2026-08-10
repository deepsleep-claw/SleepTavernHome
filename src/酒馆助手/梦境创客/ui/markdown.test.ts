import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('渲染常用Markdown并为链接追加安全属性', () => {
    const html = renderMarkdown('# 标题\n\n**加粗**与[链接](https://example.com)\n\n- 一\n- 二');

    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<strong>加粗</strong>');
    expect(html).toContain('target="_blank" rel="noopener noreferrer" href="https://example.com"');
    expect(html).toContain('<li>一</li>');
  });

  it('渲染Markdown图片与单独一行的图片链接', () => {
    const html = renderMarkdown(
      '![角色立绘](https://example.com/portrait.webp)\n\nhttps://example.com/scene.png?size=large',
    );

    expect(html.match(/<img /gu)).toHaveLength(2);
    expect(html).toContain('loading="lazy" decoding="async"');
    expect(html).toContain('src="https://example.com/scene.png?size=large"');
  });

  it('按照GFM语义渲染表格', () => {
    const html = renderMarkdown('| 条目 | 状态 |\n| --- | --- |\n| 世界观 | 完整 |\n| 开场白 | 待补充 |');

    expect(html).toContain('<table>');
    expect(html).toContain('<th>条目</th>');
    expect(html).toContain('<td>世界观</td>');
    expect(html).toContain('<td>待补充</td>');
  });

  it('清理消息中的脚本、事件和危险协议', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[危险链接](javascript:alert(1))',
    );

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
  });
});
