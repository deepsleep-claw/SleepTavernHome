export type WebsiteFavicon = {
  darkUrl: string;
  fallbackUrl?: string;
  lightUrl: string;
  strategy: 'origin-fallback' | 'theme-variants';
};

type ThemeVariantRule = {
  darkUrl: string;
  hostnames: readonly string[];
  lightUrl: string;
};

// 这里仅收录确实公开明暗资源、且普通 /favicon.ico 明显不适合暗色界面的站点。
// 新规则应保持少而明确，避免猜测文件名或篡改品牌颜色。
const THEME_VARIANT_RULES: readonly ThemeVariantRule[] = [
  {
    darkUrl: 'https://github.githubassets.com/favicons/favicon-dark.svg',
    hostnames: ['github.com', 'gist.github.com'],
    lightUrl: 'https://github.githubassets.com/favicons/favicon.svg',
  },
];

function matchesHostname(hostname: string, expected: string): boolean {
  return hostname === expected || hostname.endsWith(`.${expected}`);
}

export function resolveWebsiteFavicon(url: URL): WebsiteFavicon {
  const hostname = url.hostname.toLowerCase();
  const rule = THEME_VARIANT_RULES.find(candidate =>
    candidate.hostnames.some(expected => matchesHostname(hostname, expected)),
  );
  const fallbackUrl = new URL('/favicon.ico', url.origin).href;
  if (!rule) {
    return {
      darkUrl: fallbackUrl,
      lightUrl: fallbackUrl,
      strategy: 'origin-fallback',
    };
  }
  return {
    darkUrl: rule.darkUrl,
    fallbackUrl,
    lightUrl: rule.lightUrl,
    strategy: 'theme-variants',
  };
}

