import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Explicit opt-in build. Never enabled by a hostname, query parameter or production build.
if (process.env.VERCEL_ENV !== 'preview' && !(process.argv.includes('--local') && !process.env.VERCEL)) {
  throw new Error('This guest build is only allowed in Preview or explicit local testing.');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '.vercel/output');
mkdirSync(resolve(output, 'static'), { recursive: true });
const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'none'; worker-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
let html = readFileSync(resolve(root, 'index.html'), 'utf8');
html = html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">\n<script src="/preview-local.js"></script>`);
html = html.replace('<body>', '<body>\n<p id="preview-notice" style="position:relative;z-index:1;pointer-events:none;margin:0;padding:10px 16px;background:#153a30;color:#fff;text-align:center;font:14px system-ui">Vista previa sin cuenta · Datos de ejemplo · Cambios guardados solo en este navegador</p>');
html = html.replace('</body>', `<script>
// Use the original app bootstrap with an entirely local data adapter.
token = 'preview-local'; vista = SECCIONES[location.hash.slice(1)] ? location.hash.slice(1) : 'inicio';
terminosOk = true;
try { localStorage.setItem('tour-visto', '1'); } catch (_) {}
document.querySelector('#salir').hidden = true;
const saved = document.querySelector('#ds-guardado');
new MutationObserver(() => { if (saved.textContent.includes('tu cuenta')) saved.textContent = '✓ Guardado solo en este navegador de vista previa.'; }).observe(saved, { childList: true });
cargar();
</script></body>`);
writeFileSync(resolve(output, 'static/index.html'), html);
copyFileSync(resolve(root, 'preview/local.js'), resolve(output, 'static/preview-local.js'));
for (const file of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'terminos.html']) copyFileSync(resolve(root, file), resolve(output, 'static', file));
// Build Output API: static app only. No API functions or credentials are deployed.
writeFileSync(resolve(output, 'config.json'), JSON.stringify({ version: 3, routes: [
  { src: '/api/.*', status: 404 },
  { src: '/(.*)', headers: { 'Content-Security-Policy': csp, 'Cache-Control': 'no-store' }, continue: true },
  { handle: 'filesystem' }
] }, null, 2));
console.log('Guest Preview built from the real index.html, without server functions.');
