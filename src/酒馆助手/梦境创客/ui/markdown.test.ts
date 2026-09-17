import { expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

it('渲染消息时移除可执行内容，并为外部链接添加安全属性', () => {
  const html = renderMarkdown(
    '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[危险链接](javascript:alert(1))\n\n[来源](https://example.com)',
  );
  expect(html).not.toContain('<script');
  expect(html).not.toContain('onerror');
  expect(html).not.toContain('javascript:');
  expect(html).toContain('target="_blank" rel="noopener noreferrer" href="https://example.com"');
});
