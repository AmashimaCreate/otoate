import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = new URL('dist/', root);
const output = new URL('_site/', root);
const site = new URL(process.env.SITE_URL || 'https://amashimacreate.github.io/otoate/');
if (!['https:', 'http:'].includes(site.protocol)) throw new Error('SITE_URL must use HTTP or HTTPS');
site.search = '';
site.hash = '';
site.pathname = `${site.pathname.replace(/\/+$/, '')}/`;
const escape = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const earTitle = 'オトアテ — ギター耳コピトレーニング';
const earDescription = '聴いて、指板で再現。ギターがなくてもできる耳コピトレーニング。1〜4音のランダム出題、22フレット、聴き比べに対応。';
const thumbnail = await readFile(new URL('assets/og-ear.png', source));
const imageWidth = thumbnail.readUInt32BE(16);
const imageHeight = thumbnail.readUInt32BE(20);

function shareMetadata(html, path, title, description) {
  const url = new URL(path, site).href;
  const image = new URL('assets/og-ear.png', site).href;
  return html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escape(description)}">`)
    .replace('</head>', `  <link rel="canonical" href="${escape(url)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="オトアテ">
  <meta property="og:locale" content="ja_JP">
  <meta property="og:title" content="${escape(title)}">
  <meta property="og:description" content="${escape(description)}">
  <meta property="og:url" content="${escape(url)}">
  <meta property="og:image" content="${escape(image)}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="${imageWidth}">
  <meta property="og:image:height" content="${imageHeight}">
  <meta property="og:image:alt" content="オトアテ — ギター耳コピトレーニング">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escape(title)}">
  <meta name="twitter:description" content="${escape(description)}">
  <meta name="twitter:image" content="${escape(image)}">
  <meta name="twitter:image:alt" content="オトアテ — ギター耳コピトレーニング">
</head>`);
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
// Publish only the standalone ear trainer and its assets.
for (const path of ['ear.css', 'ear.js', 'ear-model.js', 'ear-playback.js',
  'ear-preferences.js', 'pitch.js', 'audio.js', 'ear-wood.svg',
  'ear-icons/', 'assets/', 'site.webmanifest']) {
  await cp(new URL(path, source), new URL(path, output), { recursive: true,
    filter: path => !path.endsWith('.DS_Store') });
}
const ear = await readFile(new URL('ear.html', source), 'utf8');
const home = shareMetadata(ear, '', earTitle, earDescription);
await writeFile(new URL('index.html', output), home);
// Existing ear.html links remain valid, with the homepage as their canonical URL.
await writeFile(new URL('ear.html', output), home);

await writeFile(new URL('.nojekyll', output), '');
await writeFile(new URL('robots.txt', output), `User-agent: *\nAllow: /\nSitemap: ${new URL('sitemap.xml', site).href}\n`);
await writeFile(new URL('sitemap.xml', output), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escape(site.href)}</loc></url></urlset>\n`);
console.log(`Built _site/ for ${site.href}`);
