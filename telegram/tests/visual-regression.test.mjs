import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const base = execFileSync('git', ['show', '7112dc7:telegram/index.html'], { encoding: 'utf8' });
const withoutStyles = s => s.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/\r\n/g, '\n');

test('Primera tanda conserva todo el HTML funcional y JavaScript original', () => {
  assert.equal(withoutStyles(html), withoutStyles(base));
  for (const file of ['api/web.js', 'api/telegram.js', 'lib/espn.js', 'api/deportes.js', 'sw.js']) {
    const original = execFileSync('git', ['show', `7112dc7:telegram/${file}`], { encoding: 'utf8' });
    assert.equal(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'), original.replace(/\r\n/g, '\n'));
  }
});

test('Interfaz real: móvil/escritorio, catálogo, tema, estadio, persistencia y teclado', async () => {
  const browser = await chromium.launch({ headless: true });
  mkdirSync('test-results', { recursive: true });
  try {
    for (const width of [320, 390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [], writes = [];
      page.on('pageerror', e => errors.push(e.message));
      // All requests are fulfilled locally or blocked: no real credentials, ESPN or DB access.
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === 'http://app.test' && url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
        if (url.origin === 'http://app.test' && url.pathname === '/icon-192.png') return route.fulfill({ contentType: 'image/png', body: readFileSync(new URL('../icon-192.png', import.meta.url)) });
        if (url.pathname === '/api/web') {
          const body = route.request().postDataJSON();
          writes.push(body);
          return route.fulfill({ json: ['senales', 'ligas_juego'].includes(body.op) ? [] : {} });
        }
        if (url.pathname === '/api/deportes') return route.fulfill({ json: { galeria: [] } });
        return route.abort();
      });
      await page.goto('http://app.test');
      assert.equal(await page.locator('#v-login').isVisible(), true);
      assert.equal(await page.locator('.jcard').count(), 6);
      assert.deepEqual(await page.locator('.jcard').evaluateAll(es => es.map(e => e.dataset.juego)), ['logos', 'equipodoku', 'tiro_libre', 'penales', 'canasta', 'gol_campo']);
      // Exercise the existing theme and navigation functions; no authentication bypass ships in app.
      await page.evaluate(() => {
        listo = true;
        document.querySelector('#v-login').hidden = true;
        document.querySelector('#abrir-menu').hidden = false;
        document.querySelector('#marca').hidden = true;
        document.querySelector('#sec-actual').hidden = false;
        irA('diseno');
      });
      await page.locator('#ds-modo [data-m="oscuro"]').click();
      await page.locator('#ds-letra [data-l="grande"]').click();
      await page.locator('#ds-esquinas [data-e="cuadradas"]').click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      await page.evaluate(() => {
        tema.fondo = { tipo: 'galeria', foto: 'https://fixture.invalid/estadio.jpg', nombre: 'Estadio de prueba', credito: 'Fixture' };
        aplicarDiseno(); guardarTema();
      });
      assert.match(await page.locator('#fondo-pag').evaluate(e => e.style.backgroundImage), /estadio.jpg/);
      assert.equal(await page.locator('#credito-fondo').isVisible(), true);
      await page.waitForTimeout(800);
      assert.ok(writes.some(x => x.op === 'tema' && x.datos.tema.fondo.tipo === 'galeria'));
      await page.reload();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      assert.match(await page.locator('#fondo-pag').evaluate(e => e.style.backgroundImage), /estadio.jpg/);
      // Render original game catalog without asking for account state.
      await page.evaluate(() => {
        document.querySelector('#v-login').hidden = true;
        document.querySelector('#v-juegos').hidden = false;
        document.querySelector('[data-j="juegos"]').click();
      });
      assert.equal(await page.locator('.jcard').first().isVisible(), true);
      await page.locator('.jcard').first().focus();
      assert.notEqual(await page.locator('.jcard').first().evaluate(e => getComputedStyle(e).outlineStyle), 'none');
      assert.equal(await page.locator('.jcard').first().evaluate(e => getComputedStyle(e).borderRadius), '4px');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}px`);
      await page.screenshot({ path: `test-results/juegos-${width}.png`, fullPage: true });
      for (const game of ['logos', 'equipodoku', 'tiro_libre', 'penales', 'canasta', 'gol_campo']) {
        await page.locator(`[data-juego="${game}"]`).click();
        assert.equal(await page.locator('#juego-modal').isVisible(), true, game);
        assert.ok(await page.locator('#jm-area').evaluate(e => e.childElementCount > 0), game);
        await page.locator('#jm-x').click();
        assert.equal(await page.locator('#juego-modal').isVisible(), false, game);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); }
});
