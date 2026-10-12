import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = new URL('dist/', root);
const output = new URL('_site/', root);
const site = new URL(process.env.SITE_URL || 'https://amashimacreate.github.io/fret-atlas/');
if (!['https:', 'http:'].includes(site.protocol)) throw new Error('SITE_URL must use HTTP or HTTPS');
site.search = '';
site.hash = '';
site.pathname = `${site.pathname.replace(/\/+$/, '')}/`;
const escape = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const earTitle = 'FRET ATLAS — ギター耳コピトレーニング';
const earDescription = '聴いて、指板で再現。ギターがなくてもできる耳コピトレーニング。1〜4音のランダム出題、22フレット、聴き比べに対応。';

function shareMetadata(html, path, title, description) {
  const url = new URL(path, site).href;
  const image = new URL('assets/og-ear.png', site).href;
  return html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escape(description)}">`)
    .replace('</head>', `  <link rel="canonical" href="${escape(url)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="FRET ATLAS">
  <meta property="og:locale" content="ja_JP">
  <meta property="og:title" content="${escape(title)}">
  <meta property="og:description" content="${escape(description)}">
  <meta property="og:url" content="${escape(url)}">
  <meta property="og:image" content="${escape(image)}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1730">
  <meta property="og:image:height" content="909">
  <meta property="og:image:alt" content="FRET ATLAS — 聴いて、指板で再現。ギターの指板を描いたサムネイル">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escape(title)}">
  <meta name="twitter:description" content="${escape(description)}">
  <meta name="twitter:image" content="${escape(image)}">
  <meta name="twitter:image:alt" content="FRET ATLAS — 聴いて、指板で再現。">
</head>`);
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true, filter: path => !path.endsWith('.DS_Store') });

// Keep development routes intact. The deployed homepage opens ear training directly.
const ear = (await readFile(new URL('ear.html', source), 'utf8'))
  .replace('href="./" aria-label="FRET ATLASへ戻る"', 'href="atlas.html" aria-label="指板学習を開く"');
const home = shareMetadata(ear, '', earTitle, earDescription);
await writeFile(new URL('index.html', output), home);
// Existing ear.html links remain valid, with the homepage as their canonical URL.
await writeFile(new URL('ear.html', output), home);

const atlas = (await readFile(new URL('index.html', source), 'utf8'))
  .replace('href="ear.html"', 'href="./"');
await writeFile(new URL('atlas.html', output), shareMetadata(atlas, 'atlas.html',
  '指板学習 — FRET ATLAS', '音の位置をつないで覚える、日本語のギター指板トレーニング。'));
await writeFile(new URL('.nojekyll', output), '');
await writeFile(new URL('robots.txt', output), `User-agent: *\nAllow: /\nSitemap: ${new URL('sitemap.xml', site).href}\n`);
await writeFile(new URL('sitemap.xml', output), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escape(site.href)}</loc></url><url><loc>${escape(new URL('atlas.html', site).href)}</loc></url></urlset>\n`);
console.log(`Built _site/ for ${site.href}`);
