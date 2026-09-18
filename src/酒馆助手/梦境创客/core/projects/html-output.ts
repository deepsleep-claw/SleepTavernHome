export type HtmlRenderer = 'plain-html' | 'tavern-helper';

export function compileHtmlReplacement(html: string, renderer: HtmlRenderer): string {
  if (renderer === 'plain-html') return html;
  return ['```html', '<body>', html, '</body>', '```'].join('\n');
}

/** 酒馆助手在宿主中接管HTML代码块；独立预览iframe直接渲染块内内容。 */
export function unwrapHtmlReplacement(html: string, renderer: HtmlRenderer): string {
  if (renderer === 'plain-html') return html;
  return html.replace(/```html[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```/giu, (_block, content: string) => {
    const body = content.match(/^<body>\r?\n([\s\S]*)\r?\n<\/body>$/iu);
    return body ? body[1] : content;
  });
}
