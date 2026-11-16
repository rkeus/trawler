const FRAMEWORKS: [string, RegExp][] = [
  ['Next.js', /__NEXT_DATA__|\/_next\/static\//],
  ['Nuxt', /__NUXT__|\/_nuxt\//],
  ['Angular', /\sng-version=|<app-root[\s>]/i],
  ['Vue', /\sdata-v-[0-9a-f]{8}\b|data-server-rendered|\sv-cloak\b/],
  ['React', /data-reactroot|react-dom(\.production)?(\.min)?\.js/],
  ['Svelte', /class="[^"]*\bsvelte-[a-z0-9]{6,}|__sveltekit/],
  ['Vite', /\/assets\/index-[A-Za-z0-9_-]{8,}\.js/],
  ['Webpack', /webpackChunk|\/static\/js\/main\.[0-9a-f]{8}(\.chunk)?\.js/],
];

const UI_KITS: [string, RegExp][] = [
  ['Bootstrap', /bootstrap(\.bundle)?(\.min)?\.(css|js)/i],
  ['Tailwind CSS', /tailwind(\.min)?\.css|cdn\.tailwindcss\.com/i],
  ['jQuery', /jquery([.-][\d.]+)?(\.min)?\.js/i],
  ['Bulma', /bulma(\.min)?\.css/i],
  ['Foundation', /foundation(\.min)?\.(css|js)/i],
  ['UIkit', /uikit(\.min)?\.(css|js)/i],
];

const matchAll = (list: [string, RegExp][], html: string): string[] =>
  list.filter(([, re]) => re.test(html)).map(([name]) => name);

/** JS framework/bundler markers (these influence the detection score). */
export function findFrameworkMarkers(html: string): string[] {
  return matchAll(FRAMEWORKS, html);
}

/** CSS/JS UI kits (display only, do not influence the score). */
export function findUiKits(html: string): string[] {
  return matchAll(UI_KITS, html);
}
