import { parse, stringify } from 'yaml';
import manifest from '../../内置资源/Skills/html-project/templates/minimal/project.yaml?raw';
import html from '../../内置资源/Skills/html-project/templates/minimal/template.html?raw';
import css from '../../内置资源/Skills/html-project/templates/minimal/style.css?raw';

export function htmlProjectTemplate(renderer: 'plain-html' | 'tavern-helper' = 'plain-html') {
  const config = parse(manifest) as { renderer: string; build: { scripts: string[] } };
  config.renderer = renderer;
  if (renderer === 'tavern-helper') config.build.scripts = ['main.js'];
  return [
    { path: 'project.yaml', content: stringify(config) },
    { path: 'template.html', content: html },
    { path: 'style.css', content: css },
    ...(renderer === 'tavern-helper' ? [{ path: 'main.js', content: "$(() => {\n  const cleanup = () => {};\n  $(window).one('pagehide', cleanup);\n});\n" }] : []),
  ];
}
