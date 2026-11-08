import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

test('Preview cannot build as production; real application keeps its login', () => {
  const result = spawnSync(process.execPath, ['scripts/build-preview.mjs', '--local'], { env: { ...process.env, VERCEL: '1', VERCEL_ENV: 'production' } });
  assert.notEqual(result.status, 0);
  const html = readFileSync('index.html', 'utf8');
  assert.ok(html.includes('id="v-login"'));
  assert.ok(!html.includes('preview-local.js'));
});

test('Guest opens without account; games, theme, local progress; zero API traffic', async () => {
  execFileSync(process.execPath, ['scripts/build-preview.mjs', '--local']);
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, method: req.method });
    const file = req.url === '/' ? 'index.html' : req.url.slice(1);
    if (!['index.html', 'preview-local.js', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'].includes(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.png') ? 'image/png' : 'text/html');
    res.end(readFileSync(`.vercel/output/static/${file}`));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(origin);
      await page.locator('#v-inicio').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#v-login').isVisible(), false);
      await page.locator('#inicio .ini-mascota').waitFor();
      assert.match(await page.locator('#fondo-pag').evaluate(e => e.style.backgroundImage), /images.unsplash.com/);
      async function navigate(section) {
        await page.locator('#abrir-menu').click();
        await page.locator(`#menu-items > [data-v="${section}"]`).click();
        await page.waitForFunction(() => !document.body.classList.contains('menu-abierto'));
      }
      await navigate('juegos');
      await page.locator('#pet svg').waitFor();
      await page.locator('[data-j="juegos"]').click();
      for (const name of ['logos', 'equipodoku', 'tiro_libre', 'penales', 'canasta', 'gol_campo']) {
        await page.locator(`[data-juego="${name}"]`).click();
        assert.equal(await page.locator('#juego-modal').isVisible(), true);
        if (name === 'logos') {
          await page.locator('#jm-area button').filter({ hasText: '¡Jugar!' }).click();
          await page.waitForTimeout(100);
          assert.ok(!(await page.locator('#jm-area').innerText()).includes('No hay suficientes'));
        }
        await page.locator('#jm-x').click();
      }
      // Verify the real game's completion function saves its reward only to local fixture storage.
      await page.evaluate(() => finJuego('penales', 3, 5));
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('bitacora-preview-v1')).scores.penales), 3);
      await navigate('diseno');
      await page.locator('#ds-modo [data-m="claro"]').click();
      await page.waitForFunction(() => document.querySelector('#ds-guardado').textContent.includes('solo en este navegador'));
      await page.reload();
      await page.locator('#v-diseno').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
      assert.equal(await page.locator('#v-login').isVisible(), false);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('bitacora-preview-v1')).scores.penales), 3);
      const blocked = await page.evaluate(async () => (await fetch('/api/web', { method: 'POST', body: JSON.stringify({ op: 'registro', datos: {} }) })).status);
      assert.equal(blocked, 503);
      assert.ok(!requests.some(r => r.url.startsWith('/api/') || r.method !== 'GET'));
      assert.deepEqual(errors, []);
      await navigate('inicio');
      mkdirSync('test-results', { recursive: true });
      await page.screenshot({ path: `test-results/guest-inicio-${width}.png`, fullPage: true });
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
