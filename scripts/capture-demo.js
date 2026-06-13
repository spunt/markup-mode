// Reproducible demo capture for the README's "in action" visuals.
//   node scripts/capture-demo.js
// Drives the REAL markup-mode demo headless (dark theme), injects a visible cursor,
// records a .webm of the core loop, and saves a legible compiled-Markdown still.
// Convert the webm to a GIF with scripts/make-gif.sh.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
function resolvePlaywright() {
  try { return require('playwright'); } catch (e) {}
  if (process.env.PLAYWRIGHT_DIR) { try { return require(path.join(process.env.PLAYWRIGHT_DIR, 'playwright')); } catch (e) {} }
  try { for (const d of fs.readdirSync(path.join(os.homedir(), '.npm/_npx'))) {
    const p = path.join(os.homedir(), '.npm/_npx', d, 'node_modules/playwright');
    if (fs.existsSync(p)) return require(p);
  } } catch (e) {}
  console.error('Playwright not found. Run the regression suite once, or set PLAYWRIGHT_DIR.'); process.exit(2);
}
const { chromium } = resolvePlaywright();

const SRC = path.join(__dirname, '..', 'assets', 'templates', 'markup-mode.html');
const html = fs.readFileSync(SRC, 'utf8');
const OUT = path.join(__dirname, '..', 'docs');
const PORT = 8198;
const W = 1040, H = 700;
const VIDDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-vid-'));

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise(r => server.listen(PORT, r));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: 2, colorScheme: 'dark',
    recordVideo: { dir: VIDDIR, size: { width: W, height: H } }
  });
  const page = await ctx.newPage();

  // deterministic dark theme + clean slate
  await page.addInitScript(() => {
    try {
      const NS = 'markup-mode:markup-mode.html';
      localStorage.setItem(NS + ':dock', JSON.stringify({ mode: 'rail', side: 'right', theme: { mode: 'dark' } }));
      localStorage.removeItem(NS + ':notes');
      localStorage.removeItem(NS + ':draft');
    } catch (e) {}
  });
  await page.goto(`http://127.0.0.1:${PORT}/markup-mode.html`);
  await page.waitForTimeout(500);

  // ---- inject a visible cursor + animation helpers ----
  await page.evaluate(() => {
    const c = document.createElement('div'); c.id = '__democur';
    Object.assign(c.style, { position: 'fixed', zIndex: 2147483647, left: '-60px', top: '-60px', pointerEvents: 'none', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.5))' });
    c.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 2.5 L5 20 L9.7 15.3 L12.7 21.4 L15.2 20.2 L12.2 14.2 L19 14.2 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    window.__pos = { x: -60, y: -60 };
    window.__moveTo = (x, y, ms) => new Promise(res => {
      const sx = window.__pos.x, sy = window.__pos.y, t0 = performance.now(), ease = t => 1 - Math.pow(1 - t, 3);
      (function step(now) {
        const t = Math.min(1, (now - t0) / ms), e = ease(t), cx = sx + (x - sx) * e, cy = sy + (y - sy) * e;
        c.style.left = cx + 'px'; c.style.top = cy + 'px'; window.__pos = { x: cx, y: cy };
        if (t < 1) requestAnimationFrame(step); else res();
      })(t0);
    });
    window.__pulse = () => { const r = document.createElement('div'); Object.assign(r.style, { position: 'fixed', zIndex: 2147483646, left: window.__pos.x + 'px', top: window.__pos.y + 'px', width: '8px', height: '8px', border: '2px solid #818cf8', borderRadius: '50%', pointerEvents: 'none', transform: 'translate(-50%,-50%)', transition: 'all .4s ease-out', opacity: '1' }); document.documentElement.appendChild(r); requestAnimationFrame(() => { r.style.width = '34px'; r.style.height = '34px'; r.style.opacity = '0'; }); setTimeout(() => r.remove(), 450); };
    // progressive text selection across a phrase (drag feel); returns end-rect
    window.__findText = (phrase) => {
      const w = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT, null); let n;
      while ((n = w.nextNode())) { const i = n.nodeValue.indexOf(phrase); if (i >= 0) return { found: true, _n: (window.__tn = n), i }; }
      return { found: false };
    };
    window.__selTo = (start, end) => {
      const n = window.__tn, sel = window.getSelection(); sel.removeAllRanges();
      const r = document.createRange(); r.setStart(n, start); r.setEnd(n, end); sel.addRange(r);
      const rect = r.getBoundingClientRect(); return { x: rect.right, y: rect.top + rect.height / 2 };
    };
    window.__mouseup = () => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  async function cursorTo(sel, ms = 750) {
    const box = await page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.evaluate(([x, y, ms]) => window.__moveTo(x, y, ms), [box.x, box.y, ms]);
    return box;
  }
  async function cursorXY(x, y, ms = 700) { await page.evaluate(([x, y, ms]) => window.__moveTo(x, y, ms), [x, y, ms]); }
  async function clickSel(sel) { await page.evaluate(() => window.__pulse()); await page.click(sel); }
  async function typeInto(sel, text, per = 45) {
    await page.focus(sel);
    for (const ch of text) { await page.type(sel, ch, { delay: 0 }); await sleep(per); }
  }

  // ===== the core loop =====
  await sleep(700);

  // 1) Arm
  await cursorTo('.mm-modebtn', 800);
  await clickSel('.mm-modebtn');
  await sleep(700);

  // 2) Highlight a claim → write a note
  const ph = 'frontend-only review layer';
  const f = await page.evaluate((p) => window.__findText(p), ph);
  if (f && f.found) {
    const startPt = await page.evaluate(([s, e]) => window.__selTo(s, e), [f.i, f.i + 1]);
    await cursorXY(startPt.x, startPt.y, 600);
    const N = ph.length;
    for (let k = 2; k <= N; k += 3) {
      const pt = await page.evaluate(([s, e]) => window.__selTo(s, e), [f.i, f.i + k]);
      await page.evaluate(([x, y]) => window.__moveTo(x, y, 70), [pt.x, pt.y]);
      await sleep(40);
    }
    await page.evaluate(([s, e]) => window.__selTo(s, e), [f.i, f.i + N]);
    await sleep(250);
    await page.evaluate(() => window.__mouseup());
  }
  await page.waitForSelector('.mm-pop.mm-open', { timeout: 4000 });
  await sleep(450);
  await typeInto('.mm-pop textarea', 'Cite the source for this claim.');
  await sleep(500);
  await cursorTo('.mm-pop .mm-save', 600); await clickSel('.mm-pop .mm-save');
  await sleep(1500); // HOLD on the pinned highlight

  // 3) Mark an element → note
  await cursorTo('.cards .card:nth-of-type(2)', 850);
  await clickSel('.cards .card:nth-of-type(2)');
  await page.waitForSelector('.mm-pop.mm-open', { timeout: 4000 });
  await sleep(450);
  await typeInto('.mm-pop textarea', 'Tighten this card copy.');
  await sleep(500);
  await cursorTo('.mm-pop .mm-save', 600); await clickSel('.mm-pop .mm-save');
  await sleep(1400); // HOLD

  // 4) Compile to Markdown
  await cursorTo('.mm-compile', 800); await clickSel('.mm-compile');
  await sleep(900);
  // legible still of the compiled output (clipped to the panel)
  const panel = await page.$('.mm-panel');
  if (panel) await panel.screenshot({ path: path.join(OUT, 'compiled.png') });
  await sleep(2200); // HOLD on compiled markdown (readable)

  await sleep(500);
  await ctx.close(); // finalizes the webm
  await browser.close();

  const vids = fs.readdirSync(VIDDIR).filter(f => f.endsWith('.webm'));
  if (vids.length) { fs.copyFileSync(path.join(VIDDIR, vids[0]), path.join(OUT, 'demo-raw.webm')); console.log('webm  ->', path.join(OUT, 'demo-raw.webm')); }
  console.log('still ->', path.join(OUT, 'compiled.png'));
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
