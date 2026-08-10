import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';

const markdownProcessor = remark().use(remarkGfm).use(remarkHtml);
const standaloneImageUrl =
  /^(?<indent>[\t ]*)(?<url>https?:\/\/[^\s<>]+?\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?[^\s<>]*)?(?:#[^\s<>]*)?)[\t ]*$/gimu;

function normalizeStandaloneImages(source: string): string {
  return source.replace(standaloneImageUrl, '$<indent>![](<$<url>>)');
}

/**
 * 将会话正文转换为经过清洗的 HTML。
 * remark-html 默认启用安全 Schema；这里追加的属性均为固定值，不接受消息正文输入。
 */
export function renderMarkdown(source: string): string {
  return String(markdownProcessor.processSync(normalizeStandaloneImages(source)))
    .replaceAll('<a href=', '<a target="_blank" rel="noopener noreferrer" href=')
    .replaceAll('<img ', '<img loading="lazy" decoding="async" ');
}
