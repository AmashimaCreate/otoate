import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
const base = new URL('https://preview.example/projects/guitar-trainer/');
let fixture, output, originalEar;
const pages = new Map();

before(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'ear-training-build-'));
  output = join(fixture, '_site');
  await Promise.all([
    cp(new URL('../dist/', import.meta.url), join(fixture, 'dist'), { recursive: true }),
    cp(new URL('../scripts/', import.meta.url), join(fixture, 'scripts'), { recursive: true }),
  ]);
  originalEar = await readFile(join(fixture, 'dist/ear.html'), 'utf8');
  await run(process.execPath, [join(fixture, 'scripts/build.mjs')], {
    cwd: fixture,
    env: { ...process.env, SITE_URL: base.href.slice(0, -1) },
  });
  for (const name of ['index.html', 'ear.html']) {
    pages.set(name, await readFile(join(output, name), 'utf8'));
  }
});

after(async () => {
  if (fixture) await rm(fixture, { recursive: true, force: true });
});

const decode = text => text.replace(/&(amp|quot|apos|lt|gt|#39);/g,
  (_, name) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', '#39': "'" })[name]);

function elements(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))].map(([element]) =>
    Object.fromEntries([...element.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)]
      .map(([, name, , value]) => [name.toLowerCase(), decode(value)])));
}

function one(html, tag, predicate) {
  const matches = elements(html, tag).filter(predicate);
  assert.equal(matches.length, 1, `expected one matching ${tag} element`);
  return matches[0];
}

function meta(html, name) {
  return one(html, 'meta', item => item.property === name || item.name === name).content;
}

function localFile(url) {
  assert.equal(url.origin, base.origin);
  assert.ok(url.pathname.startsWith(base.pathname), `${url.href} escaped the deployment subpath`);
  let path = decodeURIComponent(url.pathname.slice(base.pathname.length));
  if (!path || path.endsWith('/')) path += 'index.html';
  return join(output, path);
}

async function pngDimensions(file) {
  const data = await readFile(file);
  assert.deepEqual(data.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), `${file} must be a PNG`);
  assert.equal(data.toString('ascii', 12, 16), 'IHDR');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

test('published routes open only the standalone ear trainer under a subpath', async () => {
  for (const name of ['index.html', 'ear.html']) {
    const html = pages.get(name);
    const pageURL = new URL(name, base);
    assert.equal(new URL(one(html, 'script', item => item.type === 'module').src, pageURL).pathname,
      new URL('ear.js', base).pathname);
    assert.equal(elements(html, 'a').length, 0, 'practice must not link to another app');
    assert.ok(html.includes('<h1>オトアテ</h1>'));
    assert.doesNotMatch(html, /fret[\s-]?atlas|atlas\.html/i);
  }
  for (const legacy of ['atlas.html', 'app.js', 'engine.js', 'journey.js', 'styles.css', 'icon.svg']) {
    await assert.rejects(stat(join(output, legacy)), { code: 'ENOENT' });
  }
});

test('canonical and sharing URLs use the configured public path and image metadata matches the actual thumbnail', async () => {
  for (const [name, html] of pages) {
    const canonical = base.href;
    assert.equal(one(html, 'link', item => item.rel === 'canonical').href, canonical);
    assert.equal(meta(html, 'og:url'), canonical);
    assert.equal(meta(html, 'og:type'), 'website');
    assert.equal(meta(html, 'og:site_name'), 'オトアテ');
    assert.ok(meta(html, 'og:title').length > 0);
    assert.ok(meta(html, 'og:description').length > 0);
    const image = meta(html, 'og:image');
    assert.equal(image, new URL('assets/og-ear.png', base).href);
    const dimensions = await pngDimensions(localFile(new URL(image)));
    assert.deepEqual({ width: Number(meta(html, 'og:image:width')), height: Number(meta(html, 'og:image:height')) }, dimensions);
    assert.equal(meta(html, 'og:image:type'), 'image/png');
    assert.ok(meta(html, 'og:image:alt').length > 0);
    assert.equal(meta(html, 'twitter:card'), 'summary_large_image');
    assert.equal(meta(html, 'twitter:image'), image);
  }
});

test('browser and home-screen icons resolve to actual correctly sized assets', async () => {
  for (const name of ['index.html', 'ear.html']) {
    const html = pages.get(name);
    const pageURL = new URL(name, base);
    const favicon = one(html, 'link', item => item.rel === 'icon' && item.type === 'image/png');
    assert.equal(favicon.sizes, '32x32');
    assert.deepEqual(await pngDimensions(localFile(new URL(favicon.href, pageURL))), { width: 32, height: 32 });
    const apple = one(html, 'link', item => item.rel === 'apple-touch-icon');
    assert.equal(apple.sizes, '180x180');
    assert.deepEqual(await pngDimensions(localFile(new URL(apple.href, pageURL))), { width: 180, height: 180 });
    const manifestURL = new URL(one(html, 'link', item => item.rel === 'manifest').href, pageURL);
    const manifest = JSON.parse(await readFile(localFile(manifestURL), 'utf8'));
    assert.equal(manifest.name, 'オトアテ');
    assert.equal(manifest.short_name, 'オトアテ');
    assert.equal(new URL(manifest.start_url, manifestURL).href, base.href);
    assert.equal(new URL(manifest.scope, manifestURL).href, base.href);
    assert.equal(new URL(manifest.id, manifestURL).href, base.href);
    assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
    assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
    for (const icon of manifest.icons) {
      assert.equal(icon.type, 'image/png');
      const [width, height] = icon.sizes.split('x').map(Number);
      assert.deepEqual(await pngDimensions(localFile(new URL(icon.src, manifestURL))), { width, height });
    }
  }
});

test('local HTML, CSS and module references all resolve inside the deployed project', async () => {
  let checked = 0;
  for (const relative of await readdir(output, { recursive: true })) {
    const file = join(output, relative);
    if (!(await stat(file)).isFile() || !/\.(?:html|css|js)$/.test(relative)) continue;
    const text = await readFile(file, 'utf8');
    const references = [];
    if (relative.endsWith('.html')) {
      for (const tag of ['a', 'link', 'script', 'img']) {
        for (const item of elements(text, tag)) if (item.href || item.src) references.push(item.href || item.src);
      }
    } else if (relative.endsWith('.css')) {
      for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) references.push(match[1]);
    } else {
      for (const match of text.matchAll(/\b(?:import|export)\s+(?:[^;"']*?\sfrom\s*)?["']([^"']+)["']/g)) references.push(match[1]);
    }
    for (const reference of references) {
      const url = new URL(reference, new URL(relative, base));
      if (!['https:', 'http:'].includes(url.protocol) || url.origin !== base.origin) continue;
      assert.ok((await stat(localFile(url))).isFile(), `${relative} references missing asset ${reference}`);
      checked++;
    }
  }
  assert.ok(checked > 20, 'the published pages and their dependencies must actually be checked');
});

test('search discovery uses the same subpath and building leaves development pages intact', async () => {
  const sitemap = await readFile(join(output, 'sitemap.xml'), 'utf8');
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, value]) => decode(value));
  assert.deepEqual(locations, [base.href]);
  const robots = await readFile(join(output, 'robots.txt'), 'utf8');
  assert.ok(robots.includes(`Sitemap: ${new URL('sitemap.xml', base).href}`));
  assert.ok((await stat(join(output, '.nojekyll'))).isFile());
  assert.equal(await readFile(join(fixture, 'dist/ear.html'), 'utf8'), originalEar);
});
