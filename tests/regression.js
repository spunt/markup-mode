// Re-runnable headless regression harness for markup-mode.
//   Usage:  node tests/regression.js [path/to/markup-mode.html]
//   Needs Playwright + a Chromium build. If `require('playwright')` fails, set
//   PLAYWRIGHT_DIR to a node_modules dir that has it, or run once via npx so it
//   lands in the npx cache (npx playwright install chromium).
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');

function resolvePlaywright() {
  try { return require('playwright'); } catch (e) {}
  if (process.env.PLAYWRIGHT_DIR) { try { return require(path.join(process.env.PLAYWRIGHT_DIR, 'playwright')); } catch (e) {} }
  try { for (const d of fs.readdirSync(path.join(os.homedir(), '.npm/_npx'))) {
    const p = path.join(os.homedir(), '.npm/_npx', d, 'node_modules/playwright');
    if (fs.existsSync(p)) return require(p);
  } } catch (e) {}
  console.error('Playwright not found. `npm i -D playwright && npx playwright install chromium`, or set PLAYWRIGHT_DIR.');
  process.exit(2);
}
const { chromium } = resolvePlaywright();

const SRC = process.argv[2] || path.join(__dirname, '..', 'assets', 'templates', 'markup-mode.html');
const html = fs.readFileSync(SRC, 'utf8');
const PORT = process.env.MM_TEST_PORT ? +process.env.MM_TEST_PORT : 8147;

const server = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

let pass = 0, fail = 0; const fails = [];
function check(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log('  ✗ ' + name); } }
// Copy-ref button hidden 2026-06-05 (display:none in markup-mode.html). Its interaction tests
// (X2 / I3b / I3c / RH4 copy-ref) are quarantined until the button returns — flip this to true to re-enable.
const COPY_REF_ENABLED = false;

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.evaluate(() => { Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)); });
  await page.reload();
  await page.waitForTimeout(150);
  // default is right-rail; float then minimize to pill so the main-flow tests can use the handle as before
  await page.click('.mm-dockbtn-float');
  await page.waitForTimeout(40);
  // HANDLE: the collapsed pill is the minimized affordance ONLY — hidden while the panel is open (float OR rail).
  check('HANDLE hidden while floating panel is open', await page.evaluate(() => getComputedStyle(document.querySelector('.mm-handle')).display === 'none'));
  await page.click('.mm-close'); // minimize: collapses panel in float mode
  await page.waitForTimeout(40);
  check('HANDLE visible when minimized', await page.evaluate(() => getComputedStyle(document.querySelector('.mm-handle')).display !== 'none'));

  // S1 mount
  check('S1 __mmLayer set', await page.evaluate(() => window.__mmLayer === true));
  check('S1 .mm-dock present', await page.$('.mm-dock') !== null);
  check('S1 --mm-accent resolves', await page.evaluate(() => !!getComputedStyle(document.documentElement).getPropertyValue('--mm-accent').trim()));

  // F1: token layer present (12 theme vars + radius trio + type scale) in light + dark
  check('F1 --mm-accent-ink defined (light)', await page.evaluate(() =>
    !!getComputedStyle(document.documentElement).getPropertyValue('--mm-accent-ink').trim()));
  for (const v of ['--mm-focus','--mm-shadow','--mm-danger','--mm-r-sm','--mm-r-md','--mm-r-lg',
                   '--mm-fs-xs','--mm-fs-sm','--mm-fs-base','--mm-fs-md']) {
    check('F1 ' + v + ' defined', await page.evaluate((vn) =>
      !!getComputedStyle(document.documentElement).getPropertyValue(vn).trim(), v));
  }
  check('F1 dark block also defines --mm-accent-ink', /:root\.mm-theme-dark\{[^}]*--mm-accent-ink/.test(html.replace(/\n/g,'')));
  check('F1 light block also defines --mm-accent-ink', /:root\.mm-theme-light\{[^}]*--mm-accent-ink/.test(html.replace(/\n/g,'')));

  // F2: accent foreground uses the legible ink token, and measured contrast >= 4.5:1 (light theme)
  check('F2 .mm-popmode rule uses --mm-accent-ink', /\.mm-popmode\{[^}]*--mm-accent-ink/.test(html.replace(/\n/g,'')));
  check('F2 .mm-link:hover uses --mm-accent-ink', /\.mm-link:hover\{[^}]*--mm-accent-ink/.test(html.replace(/\n/g,'')));
  check('F2 .mm-popmode contrast >= 4.5:1 on panel bg (light)', await page.evaluate(() => {
    document.documentElement.classList.remove('mm-theme-dark');
    document.documentElement.classList.add('mm-theme-light');
    const toLin = c => { c/=255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
    const lum = ([r,g,b]) => 0.2126*toLin(r) + 0.7152*toLin(g) + 0.0722*toLin(b);
    const rgb = s => s.match(/\d+(\.\d+)?/g).slice(0,3).map(Number);
    const probe = (varName) => { const d=document.createElement('div'); d.style.color=`var(${varName})`; document.body.appendChild(d); const c=getComputedStyle(d).color; d.remove(); return rgb(c); };
    const L1 = lum(probe('--mm-accent-ink')) + 0.05, L2 = lum(probe('--mm-bg')) + 0.05;
    const ratio = Math.max(L1,L2)/Math.min(L1,L2);
    return ratio >= 4.5;
  }));

  // F7: representative type uses the scale tokens, not raw px
  check('F7 .mm-title uses --mm-fs-lg', /\.mm-title\{[^}]*font-size:var\(--mm-fs-lg\)/.test(html.replace(/\n/g,'')));
  check('F7 .mm-rtext uses --mm-fs-base', /\.mm-rtext\{[^}]*font-size:var\(--mm-fs-base\)/.test(html.replace(/\n/g,'')));
  check('F7 .mm-rkind uses --mm-fs-xs', /\.mm-rkind\{[^}]*font-size:var\(--mm-fs-xs\)/.test(html.replace(/\n/g,'')));

  // F8: panel/popup use --mm-r-lg; buttons/rows use --mm-r-md
  check('F8 .mm-panel uses --mm-r-lg', /\.mm-panel\{[^}]*border-radius:var\(--mm-r-lg\)/.test(html.replace(/\n/g,'')));
  check('F8 .mm-btn uses --mm-r-md', /\.mm-btn\{[^}]*border-radius:var\(--mm-r-md\)/.test(html.replace(/\n/g,'')));

  // F3: focus-visible ring present; no bare :focus{outline:none} regresses the ring
  check('F3 :focus-visible rule exists keyed to --mm-focus', /:focus-visible\{[^}]*--mm-focus/.test(html.replace(/\n/g,'')));
  // regression guard: no bare ":focus{ … outline:none … }" (the scoped :focus:not(:focus-visible){outline:none} is allowed — different selector)
  check('F3 no bare :focus{outline:none} suppressor remains', !/:focus\{[^}]*outline:\s*none/.test(html.replace(/\n/g,'')));
  // live: open panel so header .mm-iconbtns are visible, keyboard-focus the Minimize button specifically, verify the ring paints
  await page.click('.mm-handle'); // open panel (currently minimized to pill)
  await page.waitForTimeout(40);
  const mmMinSel = '.mm-iconbtn[aria-label="Minimize"]';
  // deterministically drive keyboard focus onto the Minimize button: focus it, then a no-op keydown so the
  // :focus-visible heuristic flags it as keyboard-originated (programmatic .focus() alone does not qualify in headless Chromium)
  await page.focus(mmMinSel);
  await page.keyboard.press('Shift'); // a keystroke while focused flips Chromium's focus-visible heuristic to keyboard
  check('F3 keyboard focus lands on the Minimize button', await page.evaluate((s) =>
    document.activeElement === document.querySelector(s), mmMinSel));
  check('F3 keyboard focus paints an outline on the Minimize button', await page.evaluate((s) => {
    const b = document.querySelector(s); if (!b || document.activeElement !== b) return false;
    const cs = getComputedStyle(b);
    return b.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  }, mmMinSel));
  // empirical clip check: ring (rect grown by outline-offset+width ≈ 4px) must stay inside the panel's clip box.
  // Probe both a header edge control (Minimize, near top) and a footer edge control (Clear all link, near bottom).
  const ringFits = (s) => {
    const b = document.querySelector(s); const panel = document.querySelector('.mm-panel');
    if (!b || !panel) return false;
    const grow = 4; // outline-offset(2) + outline-width(2)
    const r = b.getBoundingClientRect(), p = panel.getBoundingClientRect();
    return (r.left - grow) >= p.left && (r.top - grow) >= p.top &&
           (r.right + grow) <= p.right && (r.bottom + grow) <= p.bottom;
  };
  check('F3 focus ring is not clipped by panel overflow:hidden (header Minimize)', await page.evaluate(ringFits, mmMinSel));
  check('F3 focus ring is not clipped by panel overflow:hidden (list-header Clear all)', await page.evaluate(ringFits, '.mm-clear'));
  await page.click('.mm-close'); // re-minimize so the main flow tests start from the same pill state
  await page.waitForTimeout(40);

  // F4: reduced-motion disables the pulse animation
  check('F4 prefers-reduced-motion media query disables animation', /@media\s*\(prefers-reduced-motion:\s*reduce\)[^{]*\{[^}]*animation:\s*none/.test(html.replace(/\n/g,' ')));
  check('F4 .mm-reduce-motion class hook present for explicit pref', /\.mm-reduce-motion[\s\S]{0,80}animation:\s*none/.test(html));

  // enter mode: open panel, click start
  await page.click('.mm-handle');
  await page.click('.mm-modebtn');
  await page.waitForTimeout(50);
  check('S?? mode armed', await page.evaluate(() => document.body.classList.contains('mm-armed')));

  // S2 text selection + word-snap
  await page.evaluate(() => {
    const p = document.querySelector('.sub'); const t = p.firstChild;
    const sel = window.getSelection(); sel.removeAllRanges();
    const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 2); // "Tu" of "Turn"
    sel.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(60);
  check('S2 popup open', await page.evaluate(() => document.querySelector('.mm-pop').classList.contains('mm-open')));
  check('S2 kind TEXT', (await page.textContent('.mm-popkind')) === 'TEXT');
  check('S2 word-snap whole word', /Turn/.test(await page.textContent('.mm-popquote')));
  check('C: new-note modal labels (New note / Discard / Save note)', await page.evaluate(() =>
    /New note/.test(document.querySelector('.mm-popmode').textContent) &&
    document.querySelector('.mm-cancel').textContent === 'Discard' &&
    document.querySelector('.mm-save').textContent === 'Save note'));

  // S3 type + save
  await page.fill('.mm-pop textarea', 'first text note');
  await page.click('.mm-pop .mm-save');
  await page.waitForTimeout(60);
  check('S3 one note persisted', await page.evaluate(() => JSON.parse(localStorage.getItem('markup-mode:index.html:notes')||'[]').length === 1));
  check('S3 highlight registered', await page.evaluate(() => !!(window.CSS && CSS.highlights && CSS.highlights.has('mm-note'))));
  check('S3 one pin', (await page.$$('.mm-overlay .mm-pin')).length === 1);

  // S4 element click + save
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await page.click('.card');
  await page.waitForTimeout(60);
  check('S4 popup element', (await page.textContent('.mm-popkind')) === 'ELEMENT');
  await page.fill('.mm-pop textarea', 'element note');
  await page.click('.mm-pop .mm-save');
  await page.waitForTimeout(60);
  const notes = await page.evaluate(() => JSON.parse(localStorage.getItem('markup-mode:index.html:notes')||'[]'));
  check('S4 two notes', notes.length === 2);
  check('S4 element kind+selector', notes[1].anchors[0].kind === 'element' && !!notes[1].anchors[0].selector);
  check('S4 two pins', (await page.$$('.mm-overlay .mm-pin')).length === 2);

  // NEST: marks nested inside another mark use complementary accent (.mm-nested)
  {
    check('NEST0 nested accent tokens defined', /--mm-accent-nest/.test(html));
    check('NEST0 nested element-mark CSS present', /\.mm-out\.mm-out-mark\.mm-nested/.test(html.replace(/\n/g, '')));
    check('NEST0 nested text-highlight names present', /mm-note-nest/.test(html));
    check('NEST0 nesting detection in layer', /recomputeNestedMarks/.test(html) && /anchorContains/.test(html));
    const cn = await browser.newContext();
    const pn = await cn.newPage();
    await pn.goto(`http://127.0.0.1:${PORT}/index.html`);
    await pn.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('markup-mode')).forEach(k => localStorage.removeItem(k)));
    await pn.reload(); await pn.waitForTimeout(120);
    await pn.click('.mm-modebtn'); await pn.waitForTimeout(40);
    await pn.click('.cards .card'); await pn.waitForTimeout(60);
    await pn.fill('.mm-pop textarea', 'nest outer el'); await pn.click('.mm-pop .mm-save'); await pn.waitForTimeout(60);
    await pn.evaluate(() => {
      const h = document.querySelector('.cards .card h3').firstChild;
      const sel = window.getSelection(); sel.removeAllRanges();
      const r = document.createRange(); r.setStart(h, 0); r.setEnd(h, 4);
      sel.addRange(r); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await pn.waitForTimeout(60);
    await pn.fill('.mm-pop textarea', 'nest inner text'); await pn.click('.mm-pop .mm-save'); await pn.waitForTimeout(60);
    check('NEST1 text inside element mark is nested; outer element mark is not', await pn.evaluate(() => {
      const notes = JSON.parse(localStorage.getItem('markup-mode:index.html:notes') || '[]');
      const outer = notes.find(n => n.comment === 'nest outer el');
      const inner = notes.find(n => n.comment === 'nest inner text');
      if (!outer || !inner) return false;
      const outerPin = document.querySelector('.mm-pin[data-id="' + outer.id + '"]');
      const innerPin = document.querySelector('.mm-pin[data-id="' + inner.id + '"]');
      return outerPin && innerPin && !outerPin.classList.contains('mm-nested') && innerPin.classList.contains('mm-nested');
    }));
    await pn.evaluate(() => window.getSelection().removeAllRanges());
    await pn.evaluate(() => {
      const t = document.querySelector('.sub').firstChild;
      const sel = window.getSelection(); sel.removeAllRanges();
      const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 18);
      sel.addRange(r); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await pn.waitForTimeout(60);
    await pn.fill('.mm-pop textarea', 'nest outer txt'); await pn.click('.mm-pop .mm-save'); await pn.waitForTimeout(60);
    await pn.evaluate(() => {
      const t = document.querySelector('.sub').firstChild;
      const sel = window.getSelection(); sel.removeAllRanges();
      const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 4);
      sel.addRange(r); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await pn.waitForTimeout(60);
    await pn.fill('.mm-pop textarea', 'nest inner txt'); await pn.click('.mm-pop .mm-save'); await pn.waitForTimeout(60);
    check('NEST2 shorter text selection inside longer text is nested', await pn.evaluate(() => {
      const notes = JSON.parse(localStorage.getItem('markup-mode:index.html:notes') || '[]');
      const outer = notes.find(n => n.comment === 'nest outer txt');
      const inner = notes.find(n => n.comment === 'nest inner txt');
      if (!outer || !inner) return false;
      const outerPin = document.querySelector('.mm-pin[data-id="' + outer.id + '"]');
      const innerPin = document.querySelector('.mm-pin[data-id="' + inner.id + '"]');
      return outerPin && innerPin && !outerPin.classList.contains('mm-nested') && innerPin.classList.contains('mm-nested');
    }));
    check('NEST3 nested text highlights registered when Highlight API available', await pn.evaluate(() =>
      !(window.CSS && CSS.highlights) || (CSS.highlights.has('mm-note') && CSS.highlights.has('mm-note-nest'))));
    await cn.close();
  }

  // F5: interactive targets are at least 24x24 (measured)
  check('F5 .mm-iconbtn >= 24x24', await page.evaluate(() => {
    const b = document.querySelector('.mm-phead .mm-iconbtn'); if (!b) return false;
    const r = b.getBoundingClientRect(); return r.width >= 24 && r.height >= 24;
  }));
  check('F5 row edit/delete buttons >= 24x24', await page.evaluate(() => {
    const e = document.querySelector('.mm-redit'); if (!e) return false;
    const r = e.getBoundingClientRect(); return r.width >= 24 && r.height >= 24;
  }));

  // C: single-click a dock row REVEALS + SELECTS (active state), does NOT open the editor
  await page.click('.mm-row[data-id="1"]');
  await page.waitForFunction(() => document.querySelector('.mm-row[data-id="1"]')?.classList.contains('mm-row-active'), null, { timeout: 2000 });
  check('C: single-click row selects (mm-row-active) without opening editor', await page.evaluate(() =>
    document.querySelector('.mm-row[data-id="1"]').classList.contains('mm-row-active') &&
    !document.querySelector('.mm-pop').classList.contains('mm-open')));
  check('C: selected row pin gets mm-pin-active', await page.evaluate(() =>
    !!document.querySelector('.mm-overlay .mm-pin[data-id="1"].mm-pin-active')));

  // C: double-click a dock row OPENS the editor with context labels
  await page.dblclick('.mm-row[data-id="1"]');
  await page.waitForTimeout(60);
  check('C: dblclick row opens editor (Editing · Note 1 / Cancel / Save)', await page.evaluate(() =>
    document.querySelector('.mm-pop').classList.contains('mm-open') &&
    /Editing · Note 1/.test(document.querySelector('.mm-popmode').textContent) &&
    document.querySelector('.mm-cancel').textContent === 'Cancel' &&
    document.querySelector('.mm-save').textContent === 'Save'));

  // F6: single-click reveal must be DEFERRED behind the 220ms debounce, not synchronous.
  // Reset to a clean state where the target row (2) is NOT active: 1st Escape closes the
  // open editor, 2nd Escape clears active selection + exits mode.
  await page.keyboard.press('Escape'); await page.waitForTimeout(40);
  await page.keyboard.press('Escape'); await page.waitForTimeout(40);
  await page.waitForFunction(() => !document.querySelector('.mm-row.mm-row-active'), null, { timeout: 2000 });
  // load-bearing: single-click then assert (next round-trip, well under 220ms) the row is NOT
  // yet active. WITHOUT the debounce, reveal fires synchronously on click and this FAILS.
  await page.click('.mm-row[data-id="2"]');
  check('F6 single-click reveal is deferred (not active synchronously)',
    (await page.evaluate(() => document.querySelector('.mm-row[data-id="2"]').classList.contains('mm-row-active'))) === false);
  // then the deferred reveal must still eventually land
  await page.waitForFunction(() => document.querySelector('.mm-row[data-id="2"]')?.classList.contains('mm-row-active'), null, { timeout: 2000 });
  check('F6 deferred reveal lands (row becomes active after debounce)',
    await page.evaluate(() => document.querySelector('.mm-row[data-id="2"]').classList.contains('mm-row-active')));
  // restore the state S5 expects: editor open on note 1, then close popup (mode stays on)
  await page.dblclick('.mm-row[data-id="1"]');
  await page.waitForFunction(() => document.querySelector('.mm-pop').classList.contains('mm-open'), null, { timeout: 2000 });
  await page.keyboard.press('Escape'); await page.waitForTimeout(40);

  // SMART: intent resolver prefers real controls and semantic/component boundaries over raw hit targets.
  await page.evaluate(() => {
    const host = document.createElement('section');
    host.className = 'smart-target-fixture';
    host.innerHTML = '<div class="outer-wrap"><div class="inner-wrap"><button class="deep-action" type="button">Nested action</button></div></div>';
    document.querySelector('main').appendChild(host);
  });
  await page.click('.smart-target-fixture .deep-action'); await page.waitForTimeout(60);
  check('SMART1 nested button resolves to the button, not wrapper divs', await page.evaluate(() =>
    document.querySelector('.mm-pop').classList.contains('mm-open') &&
    document.querySelector('.mm-popkind').textContent === 'ELEMENT' &&
    /button\.deep-action/.test(document.querySelector('.mm-popwhere').textContent)));
  await page.keyboard.press('Escape'); await page.waitForTimeout(40);
  await page.click('.card h3'); await page.waitForTimeout(60);
  check('SMART2 card heading click resolves to card/component boundary by default', await page.evaluate(() =>
    document.querySelector('.mm-pop').classList.contains('mm-open') &&
    /div\.card/.test(document.querySelector('.mm-popwhere').textContent)));
  await page.keyboard.press('Escape'); await page.waitForTimeout(40);

  // S5: secondary-ref insertion while a note is open — Alt/Option-gated gesture.
  await page.dblclick('.mm-row[data-id="1"]');
  await page.waitForFunction(() => document.querySelector('.mm-pop').classList.contains('mm-open'), null, { timeout: 2000 });
  await page.evaluate(() => {
    const card=document.querySelector('.cards .card:nth-of-type(2)'), r=card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:r.left+10,clientY:r.top+10}));
  });
  await page.waitForTimeout(40);
  check('S5-ref-outline plain hover while editing does not show dashed ref target', await page.evaluate(() =>
    getComputedStyle(document.querySelector('.mm-out.mm-hover')).display === 'none'));
  await page.evaluate(() => {
    const card=document.querySelector('.cards .card:nth-of-type(2)'), r=card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,altKey:true,clientX:r.left+10,clientY:r.top+10}));
  });
  await page.waitForTimeout(40);
  check('S5-ref-outline Alt hover while editing shows dashed ref target', await page.evaluate(() =>
    getComputedStyle(document.querySelector('.mm-out.mm-hover')).display !== 'none'));
  await page.keyboard.up('Alt'); await page.waitForTimeout(40);
  check('S5-ref-outline releasing Alt hides dashed ref target', await page.evaluate(() =>
    getComputedStyle(document.querySelector('.mm-out.mm-hover')).display === 'none'));
  await page.click('.card:nth-of-type(1)'); await page.waitForTimeout(40);
  check('S5a plain click while popup open does not insert element ref', !/\[ref:/.test(await page.inputValue('.mm-pop textarea')));
  await page.click('.card:nth-of-type(1)', { modifiers: ['Alt'] }); await page.waitForTimeout(40);
  check('S5b Alt+click while popup open inserts element ref', /\[ref:/.test(await page.inputValue('.mm-pop textarea')));
  check('S5 still two notes', await page.evaluate(() => JSON.parse(localStorage.getItem('markup-mode:index.html:notes')||'[]').length === 2));
  await page.keyboard.press('Escape'); await page.waitForTimeout(40);
  await page.dblclick('.mm-row[data-id="1"]');
  await page.waitForFunction(() => document.querySelector('.mm-pop').classList.contains('mm-open'), null, { timeout: 2000 });
  await page.evaluate(() => { const p=document.querySelector('.sub'), t=p.firstChild, sel=window.getSelection();
    sel.removeAllRanges(); const r=document.createRange(); r.setStart(t,0); r.setEnd(t,4); sel.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); });
  await page.waitForTimeout(80);
  check('S5c plain selection while popup open does not insert text ref', !/\[ref: "/.test(await page.inputValue('.mm-pop textarea')));
  await page.evaluate(() => { const p=document.querySelector('.sub'), t=p.firstChild, sel=window.getSelection();
    sel.removeAllRanges(); const r=document.createRange(); r.setStart(t,0); r.setEnd(t,4); sel.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,altKey:true})); });
  await page.waitForTimeout(80);
  check('S5d Alt+selection while popup open inserts text ref', /\[ref: "/.test(await page.inputValue('.mm-pop textarea')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(40);

  // F-row-guard: dblclicking a row while a note editor is already open does NOT switch/replace it (matches pin behavior)
  await page.dblclick('.mm-row[data-id="1"]');
  await page.waitForFunction(() => document.querySelector('.mm-pop').classList.contains('mm-open'), null, { timeout: 2000 });
  const beforeMode = await page.evaluate(() => document.querySelector('.mm-popmode') ? document.querySelector('.mm-popmode').textContent : '');
  await page.dblclick('.mm-row[data-id="2"]'); await page.waitForTimeout(80);
  check('F-row-guard: dblclick another row while editing does not switch the open editor', await page.evaluate((b) =>
    document.querySelector('.mm-pop').classList.contains('mm-open') &&
    document.querySelector('.mm-popmode').textContent === b, beforeMode));
  await page.keyboard.press('Escape'); await page.waitForTimeout(40);

  // C: the explicit pencil button also opens the editor
  await page.hover('.mm-row[data-id="2"]');
  await page.click('.mm-row[data-id="2"] .mm-redit');
  await page.waitForTimeout(60);
  check('C: pencil (✎) button opens editor', await page.evaluate(() =>
    document.querySelector('.mm-pop').classList.contains('mm-open') &&
    /Editing · Note 2/.test(document.querySelector('.mm-popmode').textContent)));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(40);

  // S7 compile contract
  await page.evaluate(() => { const b=[...document.querySelectorAll('.mm-compile')]; });
  // ensure mode/editor closed, panel open
  await page.click('.mm-handle').catch(()=>{});
  await page.evaluate(() => { if(!document.querySelector('.mm-panel').classList.contains('mm-open')) document.querySelector('.mm-handle').click(); });
  await page.click('.mm-compile');
  await page.waitForTimeout(40);
  const compiled = await page.inputValue('.mm-compiled');
  check('S7 compile header', /# Feedback —/.test(compiled));
  // (retargeted) Selector is now a labeled HINT ("Selector (hint):"), not the primary key
  check('S7 compile has Where/Selector(hint)/Comment', /Where:/.test(compiled) && /Selector \(hint\):/.test(compiled) && /Comment:/.test(compiled));
  check('B: Source line = host+path (not bare filename)', /Source: 127\.0\.0\.1:\d+\/index\.html/.test(compiled));
  check('S7 compile has Quote', /Quote:/.test(compiled));
  // ATTR: uniqueness-gate preamble present in the compiled header (Locator + exactly-one-else-report; Selector demoted)
  check('ATTR: uniqueness-gate preamble (Locator, act-iff-unique, report-else)', /How to apply each note: its Locator/.test(compiled) && /exactly one place/.test(compiled) && /report that note as unresolved/.test(compiled) && /Selector is a stale positional hint/.test(compiled));
  check('ATTR: assumptions preamble (needs original artifact; .md is the deliverable)', /Assumptions: you have the original artifact/.test(compiled) && /this Markdown is the deliverable, not any \*\.markup\.html/.test(compiled));
  // ATTR: Selector still emitted but explicitly labeled as a hint (not "Selector:")
  check('ATTR: selector emitted as a labeled hint, not the primary key', /Selector \(hint\): /.test(compiled) && !/^Selector: /m.test(compiled));
  // ATTR: a TEXT note carries prefix/suffix context around its quote (note 1 = "Turn" at paragraph start ⇒ After present)
  {
    const n1 = compiled.split('## Note 2')[0];
    check('ATTR: text note emits After: context around its Quote', /## Note 1 · text/.test(n1) && /\nAfter: "/.test(n1));
    // ATTR: text note emits a Locator fusing context around the quote with the ⟪ ⟫ edit-span markers
    const loc = (n1.match(/\nLocator: "([^"\n]*)"/) || [])[1];
    const q = (n1.match(/\nQuote: "([^"\n]*)"/) || [])[1];
    check('ATTR: text note emits a Locator with ⟪ ⟫ span markers', !!loc && loc.includes('⟪') && loc.includes('⟫'));
    check('ATTR: Locator wraps exactly the Quote inside ⟪ ⟫', !!q && loc.includes('⟪' + q + '⟫'));
  }
  // ATTR: an ELEMENT note now emits a non-empty Quote derived from the element's visible text (note 2 = .card)
  {
    const n2 = '## Note 2' + (compiled.split('## Note 2')[1] || '');
    const block = n2.split(/\n## Note /)[0];
    check('ATTR: element note emits a non-empty Quote', /## Note 2 · element/.test(block) && /\nQuote: "[^"\n]+"/.test(block));
    // ATTR: element note (no surrounding text span) emits no Locator
    check('ATTR: element note emits no Locator', !/\nLocator: /.test(block));
  }

  // S11/S12 rail dock + clamp
  await page.click('.mm-dockbtn-right');
  await page.waitForTimeout(40);
  check('S11 rail reserves column', await page.evaluate(() => document.body.style.marginRight !== ''));
  // clamp: force huge railW, reload, expect <= railMaxW() = min(900, 60vw); and the reserved
  // body margin must equal the panel width (never exceed it — the over-drag shift regression).
  await page.evaluate(() => { const d=JSON.parse(localStorage.getItem('markup-mode:index.html:dock')||'{}'); d.mode='rail'; d.railW=99999; localStorage.setItem('markup-mode:index.html:dock', JSON.stringify(d)); });
  await page.reload(); await page.waitForTimeout(120);
  const clamp = await page.evaluate(() => ({ w: document.querySelector('.mm-panel').offsetWidth, cap: Math.min(900, Math.round(innerWidth*0.6)), margin: parseInt(document.body.style.marginRight,10)||0 }));
  check('S12 rail width clamps to railMaxW (min(900,60vw))', clamp.w <= clamp.cap + 1);
  check('S12b reserved body margin equals panel width (no over-shift)', Math.abs(clamp.margin - clamp.w) <= 1);
  // back to float for cleanliness
  await page.evaluate(() => { const d=JSON.parse(localStorage.getItem('markup-mode:index.html:dock')||'{}'); d.mode='float'; localStorage.setItem('markup-mode:index.html:dock', JSON.stringify(d)); });

  // S13 reload re-hydration
  await page.reload(); await page.waitForTimeout(150);
  check('S13 notes rehydrate', await page.evaluate(() => JSON.parse(localStorage.getItem('markup-mode:index.html:notes')||'[]').length === 2));
  check('S13 pins rebuilt', (await page.$$('.mm-overlay .mm-pin')).length >= 1);

  // S14 mode off cleanup
  await page.click('.mm-handle').catch(()=>{});
  await page.evaluate(() => { if(!document.querySelector('.mm-panel').classList.contains('mm-open')) document.querySelector('.mm-handle').click(); });
  await page.evaluate(() => { if(document.body.classList.contains('mm-armed')) document.querySelector('.mm-modebtn').click(); });
  await page.waitForTimeout(40);
  check('S14 mode off removes mm-armed', await page.evaluate(() => !document.body.classList.contains('mm-armed')));

  // MIN: mm-close minimizes to the handle in EVERY dock state (not float-convert)
  await page.evaluate(() => { document.querySelector('.mm-dockbtn-left').click(); });
  await page.waitForTimeout(60);
  await page.evaluate(() => document.querySelector('.mm-close').click());
  await page.waitForTimeout(60);
  check('MIN1 docked-left close hides the panel', !(await page.evaluate(() => document.querySelector('.mm-panel').classList.contains('mm-open'))));
  check('MIN2 docked-left close clears reserved body margin', '' === (await page.evaluate(() => document.body.style.marginLeft)));
  check('MIN3 handle pill visible after minimize', await page.evaluate(() => { const h=document.querySelector('.mm-handle'); return getComputedStyle(h).display !== 'none'; }));
  await page.evaluate(() => document.querySelector('.mm-handle').click()); await page.waitForTimeout(60);
  check('MIN4 reopen from handle restores rail (left margin reserved again)', '' !== (await page.evaluate(() => document.body.style.marginLeft)));

  // DRAG: popup is movable by its header and stays put; a trailing click during the drag does NOT insert a ref
  await page.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
  await page.reload(); await page.waitForTimeout(120);
  await page.evaluate(() => document.querySelector('.mm-modebtn').click()); await page.waitForTimeout(40);
  await page.click('.card:nth-of-type(1)'); await page.waitForTimeout(60);
  // seed a sentinel so a stray ref insertion would mutate the textarea (else the empty-textarea check is vacuous)
  await page.fill('.mm-pop textarea', 'SENTINEL');
  const before = await page.evaluate(() => document.querySelector('.mm-pop').getBoundingClientRect().left);
  // drag the header AND dispatch the trailing click synchronously in the same tick: popMoving is reset via
  // setTimeout(...,0) at mouseup, so the trailing click must land before that 0ms timer to fall inside the guard window.
  await page.evaluate(() => {
    const h=document.querySelector('.mm-poplabel'), r=h.getBoundingClientRect();
    h.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:r.left+10,clientY:r.top+5}));
    document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:r.left-110,clientY:r.top+65}));
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    document.querySelector('.card:nth-of-type(1)').dispatchEvent(new MouseEvent('click',{bubbles:true})); // trailing click, popMoving still true
  });
  await page.waitForTimeout(40);
  const after = await page.evaluate(() => document.querySelector('.mm-pop').getBoundingClientRect().left);
  check('DRAG1 popup header drag moves the popup', Math.abs(after-before) > 40);
  check('DRAG2 drag-then-click did not insert a stray ref', 'SENTINEL' === (await page.inputValue('.mm-pop textarea')));

  // F: cross-node text highlight re-resolves after reload (fresh context, isolated from main flow)
  {
    const c2 = await browser.newContext();
    const p2 = await c2.newPage();
    await p2.goto(`http://127.0.0.1:${PORT}/index.html`);
    await p2.evaluate(() => { Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)); });
    await p2.reload(); await p2.waitForTimeout(120);
    // panel already open in default right-rail mode
    await p2.click('.mm-modebtn'); await p2.waitForTimeout(40);
    // select a run that crosses the nested <strong> in the "What it does" paragraph
    await p2.evaluate(() => {
      const p = [...document.querySelectorAll('p')].find(n => n.querySelector('strong') && /specific run of text/.test(n.textContent));
      const strong = p.querySelector('strong');
      const pre = strong.previousSibling, post = strong.nextSibling;
      const sel = window.getSelection(); sel.removeAllRanges();
      const r = document.createRange();
      r.setStart(pre, Math.max(0, pre.nodeValue.length - 12)); // a few words before <strong>
      r.setEnd(post, 10);                                       // into the text after <strong>
      sel.addRange(r);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await p2.waitForTimeout(80);
    await p2.fill('.mm-pop textarea', 'cross-node note'); await p2.click('.mm-pop .mm-save'); await p2.waitForTimeout(60);
    const persisted = await p2.evaluate(() => JSON.parse(localStorage.getItem('markup-mode:index.html:notes')||'[]')[0]);
    check('F: cross-node anchor persists startOff/endOff', persisted && persisted.anchors[0].startOff != null && persisted.anchors[0].endOff != null);
    await p2.reload(); await p2.waitForTimeout(150);
    const reHl = await p2.evaluate(() => (window.CSS && CSS.highlights && CSS.highlights.get('mm-note')) ? CSS.highlights.get('mm-note').size : 0);
    check('F: cross-node highlight re-paints after reload (size>=1)', reHl >= 1);
    await c2.close();
  }

  // E: window.MarkupModeConfig overrides + conservative theme auto-detection (fresh contexts)
  {
    const URL = `http://127.0.0.1:${PORT}/index.html`;
    // (1) CFG.ns + CFG.accent
    const c3 = await browser.newContext(); const p3 = await c3.newPage();
    await p3.addInitScript(() => { window.MarkupModeConfig = { ns: 'custom-ns:demo', accent: 'rgb(0, 128, 255)' }; });
    await p3.goto(URL);
    await p3.evaluate(() => Object.keys(localStorage).filter(k=>/custom-ns|markup-mode/.test(k)).forEach(k=>localStorage.removeItem(k)));
    await p3.reload(); await p3.waitForTimeout(120);
    check('E: CFG.accent applied to --mm-accent', /0,\s*128,\s*255/.test(await p3.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mm-accent'))));
    // panel already open in default right-rail mode
    await p3.click('.mm-modebtn'); await p3.waitForTimeout(40);
    await p3.click('.card'); await p3.waitForTimeout(60);
    await p3.fill('.mm-pop textarea', 'ns note'); await p3.click('.mm-pop .mm-save'); await p3.waitForTimeout(60);
    check('E: CFG.ns moves the localStorage key', await p3.evaluate(() => JSON.parse(localStorage.getItem('custom-ns:demo:notes')||'[]').length === 1 && localStorage.getItem('markup-mode:index.html:notes') === null));
    await c3.close();
    // (2) auto-theme adopts host token; (3) autoTheme:false opts out
    // Set the host --accent so it's present before the layer's mount() runs applyConfigTheme().
    // Set immediately if documentElement exists at document-start, and again on DOMContentLoaded (belt-and-suspenders).
    const hostInit = () => { const set=()=>document.documentElement && document.documentElement.style.setProperty('--accent','rgb(255,0,0)'); set(); document.addEventListener('DOMContentLoaded', set); };
    const c4 = await browser.newContext(); const p4 = await c4.newPage();
    await p4.addInitScript(hostInit); await p4.goto(URL); await p4.waitForTimeout(150);
    check('E: auto-theme adopts host --accent', /255,\s*0,\s*0/.test(await p4.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mm-accent'))));
    await c4.close();
    const c5 = await browser.newContext(); const p5 = await c5.newPage();
    await p5.addInitScript(() => { window.MarkupModeConfig = { autoTheme:false }; });
    await p5.addInitScript(hostInit); await p5.goto(URL); await p5.waitForTimeout(150);
    check('E: autoTheme:false ignores host --accent', !/255,\s*0,\s*0/.test(await p5.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mm-accent'))));
    await c5.close();
  }

  // D: handle corner-lock + left-rail mirror (fresh context)
  {
    const URL = `http://127.0.0.1:${PORT}/index.html`;
    const c6 = await browser.newContext(); const p6 = await c6.newPage();
    await p6.goto(URL);
    await p6.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await p6.reload(); await p6.waitForTimeout(120);
    // D1: float first (default is right-rail), open panel, drag its header to ~center, collapse, assert pill pinned bottom-right
    await p6.click('.mm-dockbtn-float'); await p6.waitForTimeout(40); // switch to float (panel stays open)
    await p6.click('.mm-close'); await p6.waitForTimeout(40);          // minimize to pill
    await p6.click('.mm-handle'); await p6.waitForTimeout(40);          // reopen panel
    const head = await p6.$('.mm-phead'); const hb = await head.boundingBox();
    await p6.mouse.move(hb.x + hb.width/2, hb.y + hb.height/2); await p6.mouse.down();
    await p6.mouse.move(400, 300, { steps: 8 }); await p6.mouse.up(); await p6.waitForTimeout(40);
    await p6.click('.mm-close'); await p6.waitForTimeout(40); // collapse to pill (float)
    const pin = await p6.evaluate(() => { const r = document.querySelector('.mm-handle').getBoundingClientRect(); return { right: innerWidth - r.right, bottom: innerHeight - r.bottom }; });
    check('D1: collapsed pill pinned near bottom-right after drag-to-center', pin.right <= 24 && pin.bottom <= 24);
    // D2: use direct dock buttons — float -> right -> left, assert margins
    await p6.click('.mm-handle'); await p6.waitForTimeout(30); // reopen panel
    await p6.click('.mm-dockbtn-right'); await p6.waitForTimeout(40); // dock right
    const rightMargin = await p6.evaluate(() => document.body.style.marginRight);
    await p6.click('.mm-dockbtn-left'); await p6.waitForTimeout(40); // dock left
    const leftState = await p6.evaluate(() => ({ ml: document.body.style.marginLeft, mr: document.body.style.marginRight }));
    check('D2: right-rail sets marginRight', rightMargin !== '');
    check('D2: left-rail sets marginLeft + clears marginRight', leftState.ml !== '' && leftState.mr === '');
    await p6.click('.mm-dockbtn-float'); await p6.waitForTimeout(40); // back to float
    const floatState = await p6.evaluate(() => ({ ml: document.body.style.marginLeft, mr: document.body.style.marginRight }));
    check('D2: float clears both margins', floatState.ml === '' && floatState.mr === '');
    check('D3: float panel exposes four corner resize grips', await p6.evaluate(() =>
      document.querySelectorAll('.mm-cornergrip').length === 4 &&
      [...document.querySelectorAll('.mm-cornergrip')].every(g => getComputedStyle(g).display !== 'none')));
    const beforeResize = await p6.evaluate(() => { const d=document.querySelector('.mm-dock').getBoundingClientRect(), p=document.querySelector('.mm-panel').getBoundingClientRect(); return {x:d.left,y:d.top,w:p.width,h:p.height}; });
    const nw = await p6.$('.mm-cornergrip[data-corner="nw"]'); const nwb = await nw.boundingBox();
    await p6.mouse.move(nwb.x + nwb.width/2, nwb.y + nwb.height/2); await p6.mouse.down();
    await p6.mouse.move(nwb.x - 38, nwb.y - 32, { steps: 6 }); await p6.mouse.up(); await p6.waitForTimeout(60);
    const afterResize = await p6.evaluate(() => { const d=document.querySelector('.mm-dock').getBoundingClientRect(), p=document.querySelector('.mm-panel').getBoundingClientRect(); return {x:d.left,y:d.top,w:p.width,h:p.height}; });
    check('D3: top-left resize grip moves dock up-left and grows panel', afterResize.x < beforeResize.x && afterResize.y < beforeResize.y && afterResize.w > beforeResize.w && afterResize.h > beforeResize.h);
    await p6.click('.mm-dockbtn-right'); await p6.waitForTimeout(40);
    check('D3: corner resize grips hide in rail mode', await p6.evaluate(() =>
      [...document.querySelectorAll('.mm-cornergrip')].every(g => getComputedStyle(g).display === 'none')));
    await c6.close();
  }

  // C: pin gestures, reveal-with-mode-off, and undo-toast delete (fresh context)
  {
    const URL = `http://127.0.0.1:${PORT}/index.html`;
    const c7 = await browser.newContext(); const p7 = await c7.newPage();
    await p7.goto(URL);
    await p7.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await p7.reload(); await p7.waitForTimeout(120);
    // seed one element note (panel already open in default right-rail mode)
    await p7.click('.mm-modebtn'); await p7.waitForTimeout(40);
    await p7.click('.card'); await p7.waitForTimeout(60);
    await p7.fill('.mm-pop textarea', 'seed note'); await p7.click('.mm-pop .mm-save'); await p7.waitForTimeout(60);
    // exit comment mode, then prove navigation works with mode OFF
    await p7.evaluate(() => { if(document.body.classList.contains('mm-armed')) document.querySelector('.mm-modebtn').click(); });
    await p7.waitForTimeout(40);
    await p7.click('.mm-row[data-id="1"]');
    await p7.waitForFunction(() => document.querySelector('.mm-row[data-id="1"]')?.classList.contains('mm-row-active'), null, { timeout: 2000 });
    check('C: single-click reveals+selects with mode OFF and does not arm mode', await p7.evaluate(() =>
      document.querySelector('.mm-row[data-id="1"]').classList.contains('mm-row-active') &&
      !document.body.classList.contains('mm-armed') &&
      !document.querySelector('.mm-pop').classList.contains('mm-open')));
    // pin single-click selects (no editor); double-click opens editor
    await p7.click('.mm-overlay .mm-pin[data-id="1"]');
    await p7.waitForFunction(() => document.querySelector('.mm-overlay .mm-pin[data-id="1"]')?.classList.contains('mm-pin-active'), null, { timeout: 2000 });
    check('C: pin single-click selects, no editor', await p7.evaluate(() => !document.querySelector('.mm-pop').classList.contains('mm-open')));
    await p7.dblclick('.mm-overlay .mm-pin[data-id="1"]'); await p7.waitForTimeout(60);
    check('C: pin double-click opens editor', await p7.evaluate(() => document.querySelector('.mm-pop').classList.contains('mm-open')));
    await p7.keyboard.press('Escape'); await p7.waitForTimeout(40);
    // delete -> undo toast -> restore (id preserved)
    await p7.hover('.mm-row[data-id="1"]');
    await p7.click('.mm-row[data-id="1"] .mm-rdel'); await p7.waitForTimeout(60);
    check('C: delete shows an Undo toast', await p7.evaluate(() => !!document.querySelector('.mm-toast .mm-toastbtn')));
    check('C: note removed on delete', await p7.evaluate(() => JSON.parse(localStorage.getItem('markup-mode:index.html:notes')||'[]').length === 0));
    await p7.click('.mm-toast .mm-toastbtn'); await p7.waitForTimeout(60);
    check('C: Undo restores the note with its id', await p7.evaluate(() => { const n = JSON.parse(localStorage.getItem('markup-mode:index.html:notes')||'[]'); return n.length === 1 && n[0].id === 1; }));
    await c7.close();
  }

  // G: accessibility — roles, ARIA-live toast, dialog, roving list nav, focus restore (fresh context)
  {
    const URL = `http://127.0.0.1:${PORT}/index.html`;
    const c8 = await browser.newContext(); const p8 = await c8.newPage();
    await p8.goto(URL);
    await p8.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await p8.reload(); await p8.waitForTimeout(120);
    // static roles
    check('G: toast is role=status + aria-live=polite', await p8.evaluate(() => { const t=document.querySelector('.mm-toast'); return t.getAttribute('role')==='status' && t.getAttribute('aria-live')==='polite'; }));
    check('G: overlay aria-hidden', await p8.evaluate(() => document.querySelector('.mm-overlay').getAttribute('aria-hidden')==='true'));
    check('G: popup is role=dialog + non-modal (aria-modal=false by design)', await p8.evaluate(() => { const d=document.querySelector('.mm-pop'); return d.getAttribute('role')==='dialog' && d.getAttribute('aria-modal')==='false'; }));
    check('G: panel role=region, list role=list', await p8.evaluate(() => document.querySelector('.mm-panel').getAttribute('role')==='region' && document.querySelector('.mm-list').getAttribute('role')==='list'));
    // handle is a keyboard button with aria-expanded
    check('G: handle role=button', await p8.evaluate(() => document.querySelector('.mm-handle').getAttribute('role')==='button'));
    // default is right-rail (panel already open); ensure panel open before clicking modebtn
    await p8.evaluate(() => { if(!document.querySelector('.mm-panel').classList.contains('mm-open')) document.querySelector('.mm-handle').click(); }); await p8.waitForTimeout(30);
    await p8.click('.mm-modebtn'); await p8.waitForTimeout(40);
    check('G: handle aria-expanded reflects open panel', await p8.evaluate(() => document.querySelector('.mm-handle').getAttribute('aria-expanded')==='true'));
    // seed two notes
    await p8.click('.card'); await p8.waitForTimeout(50); await p8.fill('.mm-pop textarea','g1'); await p8.click('.mm-pop .mm-save'); await p8.waitForTimeout(50);
    await p8.click('.cards .card:nth-of-type(2)'); await p8.waitForTimeout(50); await p8.fill('.mm-pop textarea','g2'); await p8.click('.mm-pop .mm-save'); await p8.waitForTimeout(50);
    check('G: rows are role=listitem with id-bearing edit/delete aria-labels', await p8.evaluate(() => {
      const row = document.querySelector('.mm-row[data-id="1"]');
      return row.getAttribute('role')==='listitem' &&
        /1/.test(row.querySelector('.mm-redit').getAttribute('aria-label')||'') &&
        /1/.test(row.querySelector('.mm-rdel').getAttribute('aria-label')||'');
    }));
    // roving arrow nav + Enter = reveal (not edit)
    await p8.focus('.mm-row[data-id="1"]'); await p8.waitForTimeout(30);
    await p8.keyboard.press('ArrowDown'); await p8.waitForTimeout(40);
    check('G: ArrowDown moves roving focus to row 2', await p8.evaluate(() => document.activeElement === document.querySelector('.mm-row[data-id="2"]')));
    await p8.keyboard.press('Enter'); await p8.waitForTimeout(50);
    check('G: Enter reveals+selects row 2 (active, no editor)', await p8.evaluate(() =>
      document.querySelector('.mm-row[data-id="2"]').classList.contains('mm-row-active') &&
      document.querySelector('.mm-row[data-id="2"]').getAttribute('aria-current')==='true' &&
      !document.querySelector('.mm-pop').classList.contains('mm-open')));
    // dialog aria-label tracks mode; focus restored to trigger on Escape
    await p8.dblclick('.mm-row[data-id="1"]'); await p8.waitForTimeout(60);
    check('G: dialog aria-label tracks edit mode', await p8.evaluate(() => /Editing · Note 1/.test(document.querySelector('.mm-pop').getAttribute('aria-label')||'')));
    await p8.keyboard.press('Escape'); await p8.waitForTimeout(50);
    check('G: Escape restores focus to the triggering row', await p8.evaluate(() => document.activeElement === document.querySelector('.mm-row[data-id="1"]')));
    await c8.close();
  }

  // T1: Show/Hide Compiled toggle — label, Copy visibility, textarea visibility (fresh context)
  {
    const URL = `http://127.0.0.1:${PORT}/index.html`;
    const ct = await browser.newContext();
    const pt = await ct.newPage();
    await pt.goto(URL);
    await pt.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pt.reload(); await pt.waitForTimeout(120);

    // seed one note so the compile button is enabled (panel already open in default right-rail mode)
    await pt.click('.mm-modebtn'); await pt.waitForTimeout(40);
    await pt.click('.card'); await pt.waitForTimeout(60);
    await pt.fill('.mm-pop textarea', 'toggle test note'); await pt.click('.mm-pop .mm-save'); await pt.waitForTimeout(60);

    // T1a: default state — "Show Compiled", no Copy, no visible textarea
    // (icon revision: label now lives in a <span> beside an inline svg — read the span text, not raw glyphs)
    check('T1a: default compile btn label is "Show Compiled"', await pt.evaluate(() => (document.querySelector('.mm-compile span')||document.querySelector('.mm-compile')).textContent.trim() === 'Show Compiled'));
    check('T1a: default corner Copy is hidden', await pt.evaluate(() => { const c = document.querySelector('.mm-cornercopy'); return c.style.display === 'none' || c.offsetParent === null; }));
    check('T1a: default compiled textarea hidden (no mm-show)', await pt.evaluate(() => !document.querySelector('.mm-compiled').classList.contains('mm-show')));
    check('T1a: Export is present and enabled (1 note)', await pt.evaluate(() => { const e = document.querySelector('.mm-exportbtn'); return !!e && !e.disabled; }));

    // T1b: first click — "Hide Compiled", Copy visible, textarea visible
    await pt.click('.mm-compile'); await pt.waitForTimeout(40);
    check('T1b: after click label is "Hide Compiled"', await pt.evaluate(() => (document.querySelector('.mm-compile span')||document.querySelector('.mm-compile')).textContent.trim() === 'Hide Compiled'));
    check('T1b: after click corner Copy is visible', await pt.evaluate(() => document.querySelector('.mm-cornercopy').style.display !== 'none'));
    check('T1b: after click compiled textarea has mm-show', await pt.evaluate(() => document.querySelector('.mm-compiled').classList.contains('mm-show')));
    check('T1b: Export still present and enabled', await pt.evaluate(() => { const e = document.querySelector('.mm-exportbtn'); return !!e && !e.disabled; }));

    // T1c: second click — back to hidden
    await pt.click('.mm-compile'); await pt.waitForTimeout(40);
    check('T1c: second click label back to "Show Compiled"', await pt.evaluate(() => (document.querySelector('.mm-compile span')||document.querySelector('.mm-compile')).textContent.trim() === 'Show Compiled'));
    check('T1c: second click corner Copy hidden again', await pt.evaluate(() => { const c = document.querySelector('.mm-cornercopy'); return c.style.display === 'none' || c.offsetParent === null; }));
    check('T1c: second click compiled textarea hidden again', await pt.evaluate(() => !document.querySelector('.mm-compiled').classList.contains('mm-show')));
    check('T1c: Export present throughout (second hide)', await pt.evaluate(() => !!document.querySelector('.mm-exportbtn')));

    // T1d: Export disabled when no notes (fresh state)
    const pt2 = await ct.newPage();
    await pt2.goto(URL);
    await pt2.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pt2.reload(); await pt2.waitForTimeout(120);
    // panel already open in default right-rail; no need to click the handle
    await pt2.waitForTimeout(30);
    check('T1d: Export disabled when no notes', await pt2.evaluate(() => document.querySelector('.mm-exportbtn').disabled === true));
    check('T1d: Show Compiled disabled when no notes', await pt2.evaluate(() => document.querySelector('.mm-compile').disabled === true));

    await ct.close();
  }

  // EXP: Export ▾ menu + corner copy on the compiled box (footer rework, T1.1)
  {
    check('EXP0 export path uses showSaveFilePicker when available', /showSaveFilePicker/.test(html));
    check('EXP0 export first picker default prefers Desktop', /starts\.push\("desktop"/.test(html));
    check('EXP0 export first picker default falls back to Downloads', /starts\.push\("desktop",\s*"downloads"/.test(html));
    check('EXP0 export persists previous picker handle for startIn reuse', /persistSaveStartHandle\(handle\)/.test(html));
    const ce = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const pe = await ce.newPage();
    await pe.goto(`http://127.0.0.1:${PORT}/index.html`);
    await pe.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pe.reload(); await pe.waitForTimeout(120);
    check('EXP1 Export toggle disabled with no notes', await pe.evaluate(() => document.querySelector('.mm-exportbtn').disabled === true));
    await pe.click('.mm-modebtn'); await pe.waitForTimeout(40);
    await pe.click('.card'); await pe.waitForTimeout(60);
    await pe.fill('.mm-pop textarea', 'export menu note'); await pe.click('.mm-pop .mm-save'); await pe.waitForTimeout(60);
    check('EXP1 Export toggle enabled once a note exists', await pe.evaluate(() => document.querySelector('.mm-exportbtn').disabled === false));
    check('EXP2 menu closed initially (aria-expanded=false)', await pe.evaluate(() => document.querySelector('.mm-exportbtn').getAttribute('aria-expanded') === 'false'));
    check('EXP2 menu hidden initially', await pe.evaluate(() => !document.querySelector('.mm-menu').classList.contains('mm-open')));
    await pe.click('.mm-exportbtn'); await pe.waitForTimeout(40);
    check('EXP3 clicking Export opens the menu', await pe.evaluate(() => document.querySelector('.mm-menu').classList.contains('mm-open')));
    check('EXP3 aria-expanded true when open', await pe.evaluate(() => document.querySelector('.mm-exportbtn').getAttribute('aria-expanded') === 'true'));
    check('EXP3 menu has role=menu', await pe.evaluate(() => document.querySelector('.mm-menu').getAttribute('role') === 'menu'));
    check('EXP3 menu exposes exactly 3 menuitems', await pe.evaluate(() => document.querySelectorAll('.mm-menu [role="menuitem"]').length === 3));
    check('EXP3 menu includes a Copy to Clipboard item', await pe.evaluate(() => !!document.querySelector('.mm-mi-copy') && /Copy to Clipboard/.test(document.querySelector('.mm-mi-copy').textContent)));
    check('EXP3 menu includes Markdown and Reviewed HTML items', await pe.evaluate(() => /Markdown/.test(document.querySelector('.mm-mi-md').textContent) && /Reviewed HTML/.test(document.querySelector('.mm-mi-html').textContent)));
    await pe.keyboard.press('Escape'); await pe.waitForTimeout(40);
    check('EXP4 Escape closes the menu', await pe.evaluate(() => !document.querySelector('.mm-menu').classList.contains('mm-open')));
    check('EXP4 focus returns to the Export toggle after Escape', await pe.evaluate(() => document.activeElement === document.querySelector('.mm-exportbtn')));
    check('EXP5 corner copy hidden before compiled shown', await pe.evaluate(() => { const c=document.querySelector('.mm-cornercopy'); return c.style.display==='none' || c.offsetParent===null; }));
    await pe.click('.mm-compile'); await pe.waitForTimeout(40);
    check('EXP5 corner copy visible once compiled shown', await pe.evaluate(() => { const c=document.querySelector('.mm-cornercopy'); return c.style.display!=='none' && c.offsetParent!==null; }));
    await pe.evaluate(() => navigator.clipboard && navigator.clipboard.writeText('exp-sentinel'));
    await pe.click('.mm-cornercopy'); await pe.waitForTimeout(60);
    const clipCorner = await pe.evaluate(() => navigator.clipboard ? navigator.clipboard.readText().catch(()=>'') : '');
    check('EXP6 corner copy writes compiled markdown to clipboard', /export menu note/.test(clipCorner) && /# Feedback/.test(clipCorner));
    check('EXP6 corner copy shows a "Copied" toast', await pe.evaluate(() => /Copied/.test(document.querySelector('.mm-toast').textContent)));
    await pe.evaluate(() => navigator.clipboard && navigator.clipboard.writeText('exp-sentinel-2'));
    await pe.click('.mm-exportbtn'); await pe.waitForTimeout(30);
    await pe.click('.mm-mi-copy'); await pe.waitForTimeout(60);
    const clipMenu = await pe.evaluate(() => navigator.clipboard ? navigator.clipboard.readText().catch(()=>'') : '');
    check('EXP6 menu Copy to Clipboard writes compiled markdown', /export menu note/.test(clipMenu));
    check('EXP6 menu Copy closes the menu', await pe.evaluate(() => !document.querySelector('.mm-menu').classList.contains('mm-open')));
    await ce.close();
  }

  // CHR: header/list chrome cleanup + aria-pressed (T1.2)
  {
    const cc = await browser.newContext();
    const pc = await cc.newPage();
    await pc.goto(`http://127.0.0.1:${PORT}/index.html`);
    await pc.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pc.reload(); await pc.waitForTimeout(120);
    check('CHR1 persistence microcopy ("stay on this page only") is gone', await pc.evaluate(() => !/stay on this page/i.test(document.querySelector('.mm-panel').textContent)));
    check('CHR2 Clear all relocated into the list-header strip (.mm-sortwrap)', await pc.evaluate(() => !!document.querySelector('.mm-sortwrap .mm-clear')));
    check('CHR2 Clear all no longer lives in the footer (.mm-foot)', await pc.evaluate(() => !document.querySelector('.mm-foot .mm-clear')));
    check('CHR3 header no longer has a redundant marks toggle (moved to Settings)', await pc.evaluate(() => !document.querySelector('.mm-phead .mm-pins') && !document.querySelector('.mm-pins')));
    check('CHR3 mode button carries aria-pressed', await pc.evaluate(() => document.querySelector('.mm-modebtn').hasAttribute('aria-pressed')));
    check('CHR3 copy-ref button carries aria-pressed', await pc.evaluate(() => document.querySelector('.mm-copyref').hasAttribute('aria-pressed')));
    check('CHR3b copy-ref button is hidden for now (display:none)', await pc.evaluate(() => getComputedStyle(document.querySelector('.mm-copyref')).display === 'none'));
    check('CHR5 mode button aria-pressed reflects comment mode (false→true)', await (async () => {
      const off = await pc.evaluate(() => document.querySelector('.mm-modebtn').getAttribute('aria-pressed'));
      await pc.click('.mm-modebtn'); await pc.waitForTimeout(40);
      const on = await pc.evaluate(() => document.querySelector('.mm-modebtn').getAttribute('aria-pressed'));
      return off === 'false' && on === 'true';
    })());
    await cc.close();
  }

  // KBD: keyboard edit/delete + focus-within affordances on a focused row (T1.3)
  {
    const ck = await browser.newContext();
    const pk = await ck.newPage();
    await pk.goto(`http://127.0.0.1:${PORT}/index.html`);
    await pk.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pk.reload(); await pk.waitForTimeout(120);
    await pk.click('.mm-modebtn'); await pk.waitForTimeout(40);
    await pk.click('.cards .card:nth-of-type(1)'); await pk.waitForTimeout(50);
    await pk.fill('.mm-pop textarea', 'kbd note one'); await pk.click('.mm-pop .mm-save'); await pk.waitForTimeout(50);
    await pk.click('.cards .card:nth-of-type(2)'); await pk.waitForTimeout(50);
    await pk.fill('.mm-pop textarea', 'kbd note two'); await pk.click('.mm-pop .mm-save'); await pk.waitForTimeout(50);
    await pk.evaluate(() => { if(document.body.classList.contains('mm-armed')) document.querySelector('.mm-modebtn').click(); });
    await pk.waitForTimeout(40);
    await pk.evaluate(() => document.querySelector('.mm-row[data-id="1"]').focus());
    await pk.waitForTimeout(30);
    check('KBD1 focus-within reveals row edit button (opacity 1)', await pk.evaluate(() => getComputedStyle(document.querySelector('.mm-row[data-id="1"] .mm-redit')).opacity === '1'));
    check('KBD1 focus-within reveals row delete button (opacity 1)', await pk.evaluate(() => getComputedStyle(document.querySelector('.mm-row[data-id="1"] .mm-rdel')).opacity === '1'));
    await pk.keyboard.press('Tab'); await pk.waitForTimeout(30);
    check('KBD2 Tab from focused row lands on its edit button', await pk.evaluate(() => document.activeElement === document.querySelector('.mm-row[data-id="1"] .mm-redit')));
    await pk.keyboard.press('Enter'); await pk.waitForTimeout(50);
    check('KBD2 Enter on the edit button opens the editor for note 1', await pk.evaluate(() => { const p=document.querySelector('.mm-pop'); return p.classList.contains('mm-open') && /Editing · Note 1/.test(p.querySelector('.mm-popmode').textContent); }));
    await pk.keyboard.press('Escape'); await pk.waitForTimeout(40);
    const beforeCount = await pk.evaluate(() => JSON.parse(localStorage.getItem('markup-mode:index.html:notes')||'[]').length);
    await pk.evaluate(() => document.querySelector('.mm-row[data-id="2"]').focus()); await pk.waitForTimeout(20);
    await pk.keyboard.press('Delete'); await pk.waitForTimeout(60);
    const afterCount = await pk.evaluate(() => JSON.parse(localStorage.getItem('markup-mode:index.html:notes')||'[]').length);
    check('KBD3 Delete on a focused row removes the note', afterCount === beforeCount - 1);
    check('KBD3 Delete surfaces an Undo toast', await pk.evaluate(() => { const t=document.querySelector('.mm-toast'); return t.classList.contains('mm-show') && /deleted/.test(t.textContent) && !!t.querySelector('.mm-toastbtn'); }));
    await ck.close();
  }

  // AM: popup is non-modal by design (aria-modal=false) but keeps its Tab focus-trap (T1.4)
  {
    const cam = await browser.newContext();
    const pam = await cam.newPage();
    await pam.goto(`http://127.0.0.1:${PORT}/index.html`);
    await pam.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pam.reload(); await pam.waitForTimeout(120);
    await pam.click('.mm-modebtn'); await pam.waitForTimeout(40);
    await pam.click('.card'); await pam.waitForTimeout(60);
    check('AM1 popup is aria-modal=false (non-modal by design)', await pam.evaluate(() => document.querySelector('.mm-pop').getAttribute('aria-modal') === 'false'));
    check('AM1 popup keeps role=dialog', await pam.evaluate(() => document.querySelector('.mm-pop').getAttribute('role') === 'dialog'));
    check('AM2 Tab from the last focusable wraps inside the popup (focus-trap intact)', await (async () => {
      await pam.evaluate(() => document.querySelector('.mm-pop .mm-save').focus());
      await pam.keyboard.press('Tab'); await pam.waitForTimeout(30);
      return await pam.evaluate(() => !!document.activeElement.closest('.mm-pop'));
    })());
    check('AM2 Shift+Tab from the first focusable also stays inside the popup', await (async () => {
      await pam.evaluate(() => document.querySelector('.mm-pop textarea').focus());
      await pam.keyboard.press('Shift+Tab'); await pam.waitForTimeout(30);
      return await pam.evaluate(() => !!document.activeElement.closest('.mm-pop'));
    })());
    await cam.close();
  }

  // PIN: on-page marks are compact, unnumbered click targets (T1.5)
  {
    const cpn = await browser.newContext();
    const ppn = await cpn.newPage();
    await ppn.goto(`http://127.0.0.1:${PORT}/index.html`);
    await ppn.evaluate(() => {
      Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k));
      const notes=[]; for(let i=1;i<=12;i++){ notes.push({ id:i, comment:'note '+i, ts:i, anchors:[{ kind:'element', selector:'h1', quote:'', desc:'h1', where:'Main' }] }); }
      localStorage.setItem('markup-mode:index.html:notes', JSON.stringify(notes));
    });
    await ppn.reload(); await ppn.waitForTimeout(150);
    const dims = await ppn.evaluate(() => {
      const pins = Array.prototype.slice.call(document.querySelectorAll('.mm-overlay .mm-pin'));
      if(pins.length < 12) return null;
      const p = pins[11], r = p.getBoundingClientRect(), dot = getComputedStyle(p, '::before');
      return { count:pins.length, text:p.textContent.trim(), w:r.width, h:r.height, dotW:parseFloat(dot.width), label:p.getAttribute('aria-label')||'' };
    });
    check('PIN1 all seeded marks render as click targets', !!dims && dims.count >= 12);
    check('PIN2 on-page marks do not render ordinal text', !!dims && dims.text === '');
    check('PIN3 visual dot is smaller than the click target', !!dims && dims.dotW < dims.w && dims.w >= 16 && dims.h >= 16 && /note 12/.test(dims.label));
    await cpn.close();
  }

  // X: Export phantom-note bug — no phantom note in comment mode, no ref-copy in copy-ref mode
  {
    const URL = `http://127.0.0.1:${PORT}/index.html`;
    const cx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const px = await cx.newPage();
    await px.goto(URL);
    await px.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await px.reload(); await px.waitForTimeout(120);

    // seed one note so Export is enabled (panel already open in default right-rail mode)
    await px.click('.mm-modebtn'); await px.waitForTimeout(40);
    await px.click('.card'); await px.waitForTimeout(60);
    await px.fill('.mm-pop textarea', 'export test note'); await px.click('.mm-pop .mm-save'); await px.waitForTimeout(60);
    const notesBefore = await px.evaluate(() => JSON.parse(localStorage.getItem('markup-mode:index.html:notes')||'[]').length);

    // X1: Export in comment mode — no phantom note, no popup opened
    await px.evaluate(() => { document.querySelector('.mm-exportbtn').click(); document.querySelector('.mm-mi-md').click(); });
    await px.waitForTimeout(120);
    const notesAfterCommentMode = await px.evaluate(() => JSON.parse(localStorage.getItem('markup-mode:index.html:notes')||'[]').length);
    const popupOpenAfterExport = await px.evaluate(() => document.querySelector('.mm-pop').classList.contains('mm-open'));
    check('X1: Export in comment mode creates no phantom note', notesAfterCommentMode === notesBefore);
    check('X1: Export in comment mode does not open popup', !popupOpenAfterExport);

    // X2: Export in copy-ref mode — no phantom ref-copy  [QUARANTINED: copy-ref button hidden]
    if (COPY_REF_ENABLED) {
    // First write a known sentinel to clipboard so we can detect if it changes to a ref token
    await px.evaluate(() => navigator.clipboard && navigator.clipboard.writeText('sentinel-no-ref'));
    await px.waitForTimeout(30);
    await px.click('.mm-copyref'); await px.waitForTimeout(30); // enable copy-ref mode
    await px.evaluate(() => { document.querySelector('.mm-exportbtn').click(); document.querySelector('.mm-mi-md').click(); });
    await px.waitForTimeout(120);
    const clipAfterExport = await px.evaluate(() => navigator.clipboard ? navigator.clipboard.readText().catch(()=>'') : Promise.resolve(''));
    const notesAfterCopyRefMode = await px.evaluate(() => JSON.parse(localStorage.getItem('markup-mode:index.html:notes')||'[]').length);
    check('X2: Export in copy-ref mode creates no phantom note', notesAfterCopyRefMode === notesBefore);
    check('X2: Export in copy-ref mode does not overwrite clipboard with a ref token', !/\[ref:/.test(clipAfterExport));
    }
    await cx.close();
  }

  // T2: dirty-aware auto-update (fresh context)
  {
    const URL = `http://127.0.0.1:${PORT}/index.html`;
    const ct2 = await browser.newContext();
    const pt2 = await ct2.newPage();
    await pt2.goto(URL);
    await pt2.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pt2.reload(); await pt2.waitForTimeout(120);

    // seed one note (panel already open in default right-rail mode)
    await pt2.click('.mm-modebtn'); await pt2.waitForTimeout(40);
    await pt2.click('.card'); await pt2.waitForTimeout(60);
    await pt2.fill('.mm-pop textarea', 'auto-update note 1'); await pt2.click('.mm-pop .mm-save'); await pt2.waitForTimeout(60);

    // show compiled
    await pt2.click('.mm-compile'); await pt2.waitForTimeout(40);
    const v1 = await pt2.inputValue('.mm-compiled');
    check('T2a: compiled shown and contains first note', /auto-update note 1/.test(v1));
    check('T2a: Refresh link hidden (clean)', await pt2.evaluate(() => document.querySelector('.mm-refresh').style.display === 'none' || document.querySelector('.mm-refresh').style.display === ''));

    // T2b: add a second note while shown — auto-update should fire
    await pt2.click('.cards .card:nth-of-type(2)'); await pt2.waitForTimeout(60);
    await pt2.fill('.mm-pop textarea', 'auto-update note 2'); await pt2.click('.mm-pop .mm-save'); await pt2.waitForTimeout(60);
    const v2 = await pt2.inputValue('.mm-compiled');
    check('T2b: adding a note while shown updates the preview', /auto-update note 2/.test(v2));
    check('T2b: Refresh link still hidden after auto-update', await pt2.evaluate(() => { const s = document.querySelector('.mm-refresh').style.display; return s === 'none' || s === ''; }));

    // T2c: preview is read-only; generated notes remain the source of truth
    await pt2.click('.mm-compiled'); await pt2.waitForTimeout(20);
    await pt2.keyboard.type('user edit');
    await pt2.waitForTimeout(40);
    const vTyped = await pt2.inputValue('.mm-compiled');
    check('T2c: compiled preview is readonly', await pt2.evaluate(() => document.querySelector('.mm-compiled').readOnly));
    check('T2c: typing in preview does not mutate compiled Markdown', vTyped === v2);
    check('T2c: Refresh link remains hidden for readonly preview', await pt2.evaluate(() => { const s = document.querySelector('.mm-refresh').style.display; return s === 'none' || s === ''; }));

    // verify auto-update continues: add another note, preview should update
    await pt2.click('.card:nth-of-type(1)'); await pt2.waitForTimeout(60);
    await pt2.fill('.mm-pop textarea', 'note after readonly preview'); await pt2.click('.mm-pop .mm-save'); await pt2.waitForTimeout(60);
    const v3 = await pt2.inputValue('.mm-compiled');
    check('T2c: auto-update continues after focusing readonly preview', /note after readonly preview/.test(v3));

    // T2d: generated preview remains current; Refresh is not exposed in readonly mode
    const v4 = await pt2.inputValue('.mm-compiled');
    check('T2d: generated preview remains current', /note after readonly preview/.test(v4));
    check('T2d: Refresh stays hidden in readonly mode', await pt2.evaluate(() => { const s = document.querySelector('.mm-refresh').style.display; return s === 'none' || s === ''; }));

    // T2e: Hide then Show resets to clean
    await pt2.click('.mm-compile'); await pt2.waitForTimeout(30); // Hide
    await pt2.click('.mm-compile'); await pt2.waitForTimeout(40); // Show
    check('T2e: Hide->Show keeps Refresh link hidden', await pt2.evaluate(() => { const s = document.querySelector('.mm-refresh').style.display; return s === 'none' || s === ''; }));
    const v5 = await pt2.inputValue('.mm-compiled');
    check('T2e: Hide->Show regenerates the preview', /note after readonly preview/.test(v5));

    // T2f: Copy uses generated Markdown
    await pt2.click('.mm-cornercopy'); await pt2.waitForTimeout(40);
    const copiedPreview = await pt2.inputValue('.mm-compiled');
    check('T2f: Copy uses generated Markdown from notes', /note after readonly preview/.test(copiedPreview) && !/user edit/.test(copiedPreview));
    check('T2f: Copy leaves readonly preview clean', await pt2.evaluate(() => document.querySelector('.mm-compiled').readOnly && document.querySelector('.mm-refresh').style.display !== 'inline'));

    // T2g: Export leaves readonly preview clean
    await pt2.evaluate(() => { document.querySelector('.mm-exportbtn').click(); document.querySelector('.mm-mi-md').click(); }); await pt2.waitForTimeout(80);
    check('T2g: Export leaves Refresh link hidden', await pt2.evaluate(() => { const s = document.querySelector('.mm-refresh').style.display; return s === 'none' || s === ''; }));

    // T2h: Clear-all while compiled shown syncs all UI (textarea hidden, grip hidden, toggle label, Copy hidden, dirty cleared)
    // ensure compiled is shown (T2g may leave it shown; if not, show it)
    await pt2.evaluate(() => { if(!document.querySelector('.mm-compiled').classList.contains('mm-show')) document.querySelector('.mm-compile').click(); }); await pt2.waitForTimeout(40);
    check('T2h: compiled shown before Clear-all', await pt2.evaluate(() => document.querySelector('.mm-compiled').classList.contains('mm-show')));
    await pt2.evaluate(() => { window.confirm = () => true; document.querySelector('.mm-clear').click(); }); await pt2.waitForTimeout(40);
    check('T2h: compiled textarea hidden after Clear-all', await pt2.evaluate(() => !document.querySelector('.mm-compiled').classList.contains('mm-show')));
    check('T2h: splitgrip hidden after Clear-all', await pt2.evaluate(() => { const g = document.querySelector('.mm-splitgrip'); return !g.classList.contains('mm-show'); }));
    check('T2h: compile toggle label reset to "Show Compiled" after Clear-all', await pt2.evaluate(() => /Show Compiled/.test(document.querySelector('.mm-compile').textContent)));
    check('T2h: corner Copy hidden after Clear-all', await pt2.evaluate(() => { const s = document.querySelector('.mm-cornercopy').style.display; return s === 'none' || s === ''; }));
    check('T2h: dirty cleared after Clear-all (Refresh link hidden)', await pt2.evaluate(() => { const s = document.querySelector('.mm-refresh').style.display; return s === 'none' || s === ''; }));

    await ct2.close();
  }

  // I5: list↔preview splitter (fresh context)
  {
    const URL = `http://127.0.0.1:${PORT}/index.html`;
    const ci5 = await browser.newContext();
    const pi5 = await ci5.newPage();
    await pi5.goto(URL);
    await pi5.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pi5.reload(); await pi5.waitForTimeout(120);

    // seed one note so compiled can be shown (panel already open in default right-rail mode)
    await pi5.click('.mm-modebtn'); await pi5.waitForTimeout(40);
    await pi5.click('.card'); await pi5.waitForTimeout(60);
    await pi5.fill('.mm-pop textarea', 'splitter test note'); await pi5.click('.mm-pop .mm-save'); await pi5.waitForTimeout(60);

    // I5a: grip hidden before compiled shown; no native resize
    check('I5a: splitgrip hidden when compiled not shown', await pi5.evaluate(() => {
      const g = document.querySelector('.mm-splitgrip');
      return !g.classList.contains('mm-show') && g.offsetParent === null;
    }));
    check('I5a: compiled textarea has no resize:vertical', await pi5.evaluate(() => {
      return getComputedStyle(document.querySelector('.mm-compiled')).resize !== 'vertical';
    }));

    // I5b: grip visible after compiled shown
    await pi5.click('.mm-compile'); await pi5.waitForTimeout(40);
    check('I5b: splitgrip visible when compiled is shown', await pi5.evaluate(() => {
      const g = document.querySelector('.mm-splitgrip');
      return g.classList.contains('mm-show') && g.offsetParent !== null;
    }));

    // I5c: dragging grip up grows compiled height and respects min 80px
    const initialH = await pi5.evaluate(() => document.querySelector('.mm-compiled').offsetHeight);
    const grip = await pi5.$('.mm-splitgrip');
    const gb = await grip.boundingBox();
    await pi5.mouse.move(gb.x + gb.width/2, gb.y + gb.height/2);
    await pi5.mouse.down();
    await pi5.mouse.move(gb.x + gb.width/2, gb.y + gb.height/2 - 60, { steps: 8 });
    await pi5.mouse.up();
    await pi5.waitForTimeout(40);
    const afterDragH = await pi5.evaluate(() => document.querySelector('.mm-compiled').offsetHeight);
    check('I5c: dragging grip up increases compiled height', afterDragH > initialH);

    // I5c: min size clamp — drag way past min
    await pi5.mouse.move(gb.x + gb.width/2, gb.y + gb.height/2);
    await pi5.mouse.down();
    await pi5.mouse.move(gb.x + gb.width/2, gb.y + gb.height/2 + 999, { steps: 10 });
    await pi5.mouse.up();
    await pi5.waitForTimeout(40);
    const clampedH = await pi5.evaluate(() => document.querySelector('.mm-compiled').offsetHeight);
    check('I5c: compiled height respects 80px minimum', clampedH >= 80);

    // I5d: persisted height survives reload
    const gripBB = await (await pi5.$('.mm-splitgrip')).boundingBox();
    await pi5.mouse.move(gripBB.x + gripBB.width/2, gripBB.y + gripBB.height/2);
    await pi5.mouse.down();
    await pi5.mouse.move(gripBB.x + gripBB.width/2, gripBB.y + gripBB.height/2 - 40, { steps: 6 });
    await pi5.mouse.up();
    await pi5.waitForTimeout(60);
    const persistH = await pi5.evaluate(() => document.querySelector('.mm-compiled').offsetHeight);
    const savedH = await pi5.evaluate(() => { const d = JSON.parse(localStorage.getItem('markup-mode:index.html:dock')||'{}'); return d.compiledH; });
    check('I5d: compiledH saved to dockState after drag', savedH != null && savedH >= 80);
    await pi5.reload(); await pi5.waitForTimeout(150);
    // show compiled again to see restored height
    await pi5.click('.mm-handle').catch(()=>{});
    await pi5.evaluate(() => { if(!document.querySelector('.mm-panel').classList.contains('mm-open')) document.querySelector('.mm-handle').click(); });
    await pi5.click('.mm-compile'); await pi5.waitForTimeout(40);
    const reloadH = await pi5.evaluate(() => document.querySelector('.mm-compiled').offsetHeight);
    check('I5d: compiled height restores after reload', Math.abs(reloadH - persistH) <= 2);

    // I5e: grip hidden when compiled is hidden again
    await pi5.click('.mm-compile'); await pi5.waitForTimeout(40);
    check('I5e: splitgrip hidden again when compiled is hidden', await pi5.evaluate(() => {
      const g = document.querySelector('.mm-splitgrip');
      return !g.classList.contains('mm-show');
    }));

    // I5f: button row (.mm-btns) stays above the compiled area while dragging
    await pi5.click('.mm-compile'); await pi5.waitForTimeout(40); // show compiled
    const newGripBB = await (await pi5.$('.mm-splitgrip')).boundingBox();
    await pi5.mouse.move(newGripBB.x + newGripBB.width/2, newGripBB.y + newGripBB.height/2);
    await pi5.mouse.down();
    await pi5.mouse.move(newGripBB.x + newGripBB.width/2, newGripBB.y + newGripBB.height/2 - 50, { steps: 6 });
    const layout = await pi5.evaluate(() => ({
      btnsBottom: document.querySelector('.mm-btns').getBoundingClientRect().bottom,
      compiledTop: document.querySelector('.mm-compiled').getBoundingClientRect().top
    }));
    await pi5.mouse.up();
    await pi5.waitForTimeout(40);
    check('I5f: button row stays above compiled area while dragging', layout.btnsBottom <= layout.compiledTop + 20);

    await ci5.close();
  }

  // I3: copy-ref pointer chip — chip appears near pointer/selection, no corner toast for copy-ref,
  //     corner toast still appears for non-copy-ref messages (fresh context)
  {
    const URL = `http://127.0.0.1:${PORT}/index.html`;
    const ci3 = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const pi3 = await ci3.newPage();
    await pi3.goto(URL);
    await pi3.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pi3.reload(); await pi3.waitForTimeout(120);

    // seed one note so we can test "Reference inserted" corner toast too (panel already open in default right-rail)
    await pi3.click('.mm-modebtn'); await pi3.waitForTimeout(40);
    await pi3.click('.card'); await pi3.waitForTimeout(60);
    await pi3.fill('.mm-pop textarea', 'chip test note'); await pi3.click('.mm-pop .mm-save'); await pi3.waitForTimeout(60);

    // I3a: chip element exists in DOM with correct base properties
    check('I3a: .mm-refchip present in DOM', await pi3.evaluate(() => !!document.querySelector('.mm-refchip')));
    check('I3a: .mm-refchip has mm-ui class', await pi3.evaluate(() => document.querySelector('.mm-refchip').classList.contains('mm-ui')));
    check('I3a: .mm-refchip is position:fixed', await pi3.evaluate(() => getComputedStyle(document.querySelector('.mm-refchip')).position === 'fixed'));

    // I3b/I3c: element + text copy-ref chip  [QUARANTINED: copy-ref button hidden]
    if (COPY_REF_ENABLED) {
    // I3b: element copy-ref — chip appears near pointer coords, corner toast does NOT show
    await pi3.click('.mm-copyref'); await pi3.waitForTimeout(30); // enter copy-ref mode
    // click .card at known position
    const cardBox = await pi3.$eval('.card', el => { const r = el.getBoundingClientRect(); return { cx: r.left + r.width/2, cy: r.top + r.height/2 }; });
    await pi3.mouse.click(cardBox.cx, cardBox.cy);
    await pi3.waitForTimeout(80);
    const chipStateElem = await pi3.evaluate(() => {
      const chip = document.querySelector('.mm-refchip');
      const toast = document.querySelector('.mm-toast');
      return {
        chipVisible: chip.classList.contains('mm-show'),
        chipLeft: parseFloat(chip.style.left),
        chipTop: parseFloat(chip.style.top),
        toastVisible: toast.classList.contains('mm-show')
      };
    });
    check('I3b: chip shows (mm-show) on element copy-ref click', chipStateElem.chipVisible);
    check('I3b: chip left is near pointer x (within 80px)', Math.abs(chipStateElem.chipLeft - cardBox.cx) <= 80);
    check('I3b: chip top is near pointer y (within 80px)', Math.abs(chipStateElem.chipTop - cardBox.cy) <= 80);
    check('I3b: corner toast does NOT show on element copy-ref', !chipStateElem.toastVisible);

    // I3c: text selection copy-ref — chip appears near selection rect end, corner toast does NOT show
    // re-enter copy-ref mode (it stays on)
    await pi3.evaluate(() => {
      const p = document.querySelector('.sub');
      const t = p.firstChild;
      const sel = window.getSelection(); sel.removeAllRanges();
      const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 8);
      sel.addRange(r);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await pi3.waitForTimeout(100);
    const chipStateTxt = await pi3.evaluate(() => {
      const chip = document.querySelector('.mm-refchip');
      const toast = document.querySelector('.mm-toast');
      return {
        chipVisible: chip.classList.contains('mm-show'),
        toastVisible: toast.classList.contains('mm-show')
      };
    });
    check('I3c: chip shows (mm-show) on text selection copy-ref', chipStateTxt.chipVisible);
    check('I3c: corner toast does NOT show on text copy-ref', !chipStateTxt.toastVisible);
    }

    // I3d: corner toast STILL appears for a non-copy-ref message ("Reference inserted" in comment mode)
    // exit copy-ref, open a note editor, Alt+click an element to insert a ref — should trigger "Reference inserted" corner toast
    await pi3.evaluate(() => { if(document.querySelector('.mm-copyref').classList.contains('mm-primary')) document.querySelector('.mm-copyref').click(); }); // exit copy-ref
    await pi3.waitForTimeout(30);
    // open the existing note for editing (dblclick)
    await pi3.dblclick('.mm-row[data-id="1"]'); await pi3.waitForTimeout(60);
    // Alt+click an element to insert a ref while editor is open
    await pi3.click('.card', { modifiers: ['Alt'] }); await pi3.waitForTimeout(60);
    const toastStateRefInserted = await pi3.evaluate(() => document.querySelector('.mm-toast').classList.contains('mm-show'));
    check('I3d: corner toast appears for "Reference inserted" (non-copy-ref message)', toastStateRefInserted);
    await pi3.keyboard.press('Escape'); await pi3.waitForTimeout(40);

    await ci3.close();
  }

  // T6: Light/Dark theme toggle — button + live flip + persistence + OS seed + config override (fresh contexts)
  {
    const URL = `http://127.0.0.1:${PORT}/index.html`;
    const ct6 = await browser.newContext();
    const pt6 = await ct6.newPage();
    await pt6.goto(URL);
    await pt6.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pt6.reload(); await pt6.waitForTimeout(120);
    // default is right-rail (panel already open); ensure panel open for theme button checks
    await pt6.evaluate(() => { if(!document.querySelector('.mm-panel').classList.contains('mm-open')) document.querySelector('.mm-handle').click(); }); await pt6.waitForTimeout(30);

    // T6a: theme control moved out of the header into the Appearance pane (D6); header has no sun/moon
    check('T6a: header no longer carries a theme toggle button', await pt6.evaluate(() => !document.querySelector('.mm-phead .mm-themebtn')));
    check('T6a: theme control is a light/dark/auto seg in the settings pane', await pt6.evaluate(() => document.querySelectorAll('.mm-themeseg .mm-segbtn[role="radio"]').length === 3));
    check('T6a: documentElement carries an explicit mm-theme-* class', await pt6.evaluate(() => { const c=document.documentElement.classList; return c.contains('mm-theme-light') || c.contains('mm-theme-dark'); }));

    // T6b: picking Dark vs Light in the Appearance seg flips the palette class live + changes effective --mm-bg
    await pt6.click('.mm-gearbtn'); await pt6.waitForTimeout(40);
    await pt6.click('.mm-themeseg .mm-segbtn[data-mode="dark"]'); await pt6.waitForTimeout(50);
    const darkBg = await pt6.evaluate(() => ({ dark: document.documentElement.classList.contains('mm-theme-dark'), bg: getComputedStyle(document.documentElement).getPropertyValue('--mm-bg').trim() }));
    await pt6.click('.mm-themeseg .mm-segbtn[data-mode="light"]'); await pt6.waitForTimeout(50);
    const lightBg = await pt6.evaluate(() => ({ light: document.documentElement.classList.contains('mm-theme-light'), bg: getComputedStyle(document.documentElement).getPropertyValue('--mm-bg').trim() }));
    check('T6b: Dark applies the dark palette class', darkBg.dark === true);
    check('T6b: Light applies the light palette class', lightBg.light === true);
    check('T6b: switching changes the effective --mm-bg', darkBg.bg !== lightBg.bg && !!darkBg.bg && !!lightBg.bg);
    check('T6b: exactly one mm-theme-* class is set', await pt6.evaluate(() => { const c=document.documentElement.classList; return c.contains('mm-theme-dark') !== c.contains('mm-theme-light'); }));

    // T6c: choice persists across reload (dockState.theme.mode)
    check('T6c: dockState.theme.mode persisted (light)', await pt6.evaluate(() => { const d=JSON.parse(localStorage.getItem('markup-mode:index.html:dock')||'{}'); return d.theme && d.theme.mode === 'light'; }));
    await pt6.reload(); await pt6.waitForTimeout(150);
    check('T6c: chosen theme survives reload', await pt6.evaluate(() => document.documentElement.classList.contains('mm-theme-light')));
    await ct6.close();

    // T6d: first-load seed matches OS preference on a token-less host (emulate both schemes)
    const cDark = await browser.newContext({ colorScheme: 'dark' });
    const pDark = await cDark.newPage();
    await pDark.goto(URL);
    await pDark.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pDark.reload(); await pDark.waitForTimeout(150);
    check('T6d: OS dark seeds the dark palette on a token-less host', await pDark.evaluate(() => document.documentElement.classList.contains('mm-theme-dark')));
    await cDark.close();

    const cLight = await browser.newContext({ colorScheme: 'light' });
    const pLight = await cLight.newPage();
    await pLight.goto(URL);
    await pLight.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pLight.reload(); await pLight.waitForTimeout(150);
    check('T6d: OS light seeds the light palette on a token-less host', await pLight.evaluate(() => document.documentElement.classList.contains('mm-theme-light')));
    await cLight.close();

    // T6e: MarkupModeConfig color override still wins after toggling
    const cCfg = await browser.newContext();
    const pCfg = await cCfg.newPage();
    await pCfg.addInitScript(() => { window.MarkupModeConfig = { bg: 'rgb(1, 2, 3)' }; });
    await pCfg.goto(URL);
    await pCfg.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pCfg.reload(); await pCfg.waitForTimeout(150);
    check('T6e: config bg override applied on first load', /1,\s*2,\s*3/.test(await pCfg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mm-bg'))));
    await pCfg.evaluate(() => { if(!document.querySelector('.mm-panel').classList.contains('mm-open')) document.querySelector('.mm-handle').click(); }); await pCfg.waitForTimeout(30);
    await pCfg.click('.mm-gearbtn'); await pCfg.waitForTimeout(40);
    await pCfg.click('.mm-themeseg .mm-segbtn[data-mode="dark"]'); await pCfg.waitForTimeout(40);
    check('T6e: config bg override still wins after switching to Dark', /1,\s*2,\s*3/.test(await pCfg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mm-bg'))));
    await pCfg.click('.mm-themeseg .mm-segbtn[data-mode="light"]'); await pCfg.waitForTimeout(40);
    check('T6e: config bg override still wins after switching to Light', /1,\s*2,\s*3/.test(await pCfg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mm-bg'))));
    await cCfg.close();

    // T6f: text/glyphs ON the accent use the --mm-on-accent token and clear AA against the accent fill — both themes.
    // Indigo default: light accent #4f46e5 is dark, so on-accent flips to WHITE rgb(255,255,255) (white-on-#4f46e5 = 6.29:1).
    // Dark accent #818cf8 is light, so on-accent is the dark token #1e1b2e -> rgb(30, 27, 46) (dark-on-#818cf8 = 5.63:1).
    const cf6 = await browser.newContext();
    const pf6 = await cf6.newPage();
    await pf6.goto(URL);
    await pf6.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pf6.reload(); await pf6.waitForTimeout(120);
    // seed one note so a .mm-num number badge (drawn on the accent) exists (panel already open in rail mode)
    await pf6.click('.mm-modebtn'); await pf6.waitForTimeout(40);
    await pf6.click('.card'); await pf6.waitForTimeout(60);
    await pf6.fill('.mm-pop textarea', 'on-accent contrast note'); await pf6.click('.mm-pop .mm-save'); await pf6.waitForTimeout(60);
    // shared AA check: the on-accent text color must clear 4.5:1 against the accent fill it sits on
    const aaOnAccent = (numColor, accentColor) => {
      const toLin = c => { c/=255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
      const lum = ([r,g,b]) => 0.2126*toLin(r) + 0.7152*toLin(g) + 0.0722*toLin(b);
      const rgb = s => s.match(/\d+(\.\d+)?/g).slice(0,3).map(Number);
      const L1 = lum(rgb(numColor)) + 0.05, L2 = lum(rgb(accentColor)) + 0.05;
      return Math.max(L1,L2)/Math.min(L1,L2);
    };
    const onAccentLight = await pf6.evaluate(() => {
      const r = document.documentElement; r.classList.remove('mm-theme-dark'); r.classList.add('mm-theme-light');
      const num = document.querySelector('.mm-num');
      return { num: getComputedStyle(num).color, accent: getComputedStyle(num).backgroundColor };
    });
    check('T6f: number badge on-accent color is white (rgb(255, 255, 255)) in light theme', /rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/.test(onAccentLight.num));
    check('T6f: on-accent text clears AA (>=4.5:1) on the light accent fill', aaOnAccent(onAccentLight.num, onAccentLight.accent) >= 4.5);
    const onAccentDark = await pf6.evaluate(() => {
      const r = document.documentElement; r.classList.remove('mm-theme-light'); r.classList.add('mm-theme-dark');
      const num = document.querySelector('.mm-num');
      return { num: getComputedStyle(num).color, accent: getComputedStyle(num).backgroundColor };
    });
    check('T6f: number badge on-accent color is the dark token (rgb(30, 27, 46)) in dark theme', /rgb\(\s*30\s*,\s*27\s*,\s*46\s*\)/.test(onAccentDark.num));
    check('T6f: on-accent color is NOT white in dark theme', !/rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/.test(onAccentDark.num));
    check('T6f: on-accent text clears AA (>=4.5:1) on the dark accent fill', aaOnAccent(onAccentDark.num, onAccentDark.accent) >= 4.5);
    await cf6.close();
  }

  // T7: inline-SVG icons — changed buttons render an <svg>, icon-only buttons keep aria-labels,
  //     decorative svgs are aria-hidden, currentColor inheritance, zero-dep preserved (fresh context)
  {
    const URL = `http://127.0.0.1:${PORT}/index.html`;
    const ct7 = await browser.newContext();
    const pt7 = await ct7.newPage();
    await pt7.goto(URL);
    await pt7.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pt7.reload(); await pt7.waitForTimeout(120);
    // default is right-rail; float then minimize so the handle is visible for the normal interaction tests
    await pt7.click('.mm-dockbtn-float'); await pt7.waitForTimeout(40);
    await pt7.click('.mm-close'); await pt7.waitForTimeout(40); // minimize to pill
    await pt7.click('.mm-handle'); await pt7.click('.mm-modebtn'); await pt7.waitForTimeout(40);
    // seed one note so row action buttons + footer buttons exist/enabled
    await pt7.click('.card'); await pt7.waitForTimeout(60);
    await pt7.fill('.mm-pop textarea', 'icon test note'); await pt7.click('.mm-pop .mm-save'); await pt7.waitForTimeout(60);
    // show compiled so .mm-copy/.mm-compile(Hide) are present, then back so all are reachable
    await pt7.click('.mm-compile'); await pt7.waitForTimeout(40);

    // T7a: every changed button renders an inline <svg>
    const svgButtons = ['.mm-close', '.mm-dockbtn-float', '.mm-dockbtn-left', '.mm-dockbtn-right', '.mm-gearbtn', '.mm-modebtn', '.mm-copyref', '.mm-compile', '.mm-cornercopy', '.mm-exportbtn'];
    for (const sel of svgButtons) {
      check('T7a: ' + sel + ' contains an inline <svg>', await pt7.evaluate((s) => { const b=document.querySelector(s); return !!(b && b.querySelector('svg')); }, sel));
    }
    check('T7a: row edit button (.mm-redit) contains an inline <svg>', await pt7.evaluate(() => !!document.querySelector('.mm-row[data-id="1"] .mm-redit svg')));
    check('T7a: row delete button (.mm-rdel) contains an inline <svg>', await pt7.evaluate(() => !!document.querySelector('.mm-row[data-id="1"] .mm-rdel svg')));
    check('T7a: NO legacy unicode glyphs remain in dock controls (⤢ ⤡ ⧉ ✎ ✕ ● ■)', await pt7.evaluate(() => {
      const txt = ['.mm-close','.mm-dockbtn-float','.mm-dockbtn-left','.mm-dockbtn-right','.mm-modebtn','.mm-copyref','.mm-compile','.mm-cornercopy','.mm-exportbtn','.mm-row[data-id="1"] .mm-redit','.mm-row[data-id="1"] .mm-rdel']
        .map(s => (document.querySelector(s)||{}).textContent || '').join(' ');
      return !/[⤢⤡⧉✎✕●■]/.test(txt);
    }));

    // T7b: icon-only buttons retain a non-empty aria-label
    const iconOnly = ['.mm-close', '.mm-dockbtn-float', '.mm-dockbtn-left', '.mm-dockbtn-right', '.mm-gearbtn'];
    for (const sel of iconOnly) {
      check('T7b: icon-only ' + sel + ' has a non-empty aria-label', await pt7.evaluate((s) => { const b=document.querySelector(s); return !!(b && (b.getAttribute('aria-label')||'').trim()); }, sel));
    }
    check('T7b: row edit/delete keep id-bearing aria-labels after icon swap', await pt7.evaluate(() => {
      const e=document.querySelector('.mm-row[data-id="1"] .mm-redit'), d=document.querySelector('.mm-row[data-id="1"] .mm-rdel');
      return /1/.test(e.getAttribute('aria-label')||'') && /1/.test(d.getAttribute('aria-label')||'');
    }));

    // T7c: every dock svg is decorative — aria-hidden="true"
    check('T7c: all dock <svg> are aria-hidden="true"', await pt7.evaluate(() =>
      [...document.querySelectorAll('.mm-dock svg')].length > 0 &&
      [...document.querySelectorAll('.mm-dock svg')].every(s => s.getAttribute('aria-hidden') === 'true')));

    // T7d: icons inherit currentColor (no hard-coded fill/stroke colors) so --mm-* theming + light/dark work
    check('T7d: dock svgs use currentColor (stroke or fill), no hard-coded hex', await pt7.evaluate(() =>
      [...document.querySelectorAll('.mm-dock svg')].every(s => {
        const st = s.getAttribute('stroke')||'', fi = s.getAttribute('fill')||'';
        const usesCurrent = st === 'currentColor' || fi === 'currentColor';
        const noHex = !/#[0-9a-f]{3,6}/i.test(st) && !/#[0-9a-f]{3,6}/i.test(fi);
        return usesCurrent && noHex;
      })));
    // computed color of an icon stroke tracks the button color (currentColor resolution)
    check('T7d: gear-icon svg computed color equals its button color (currentColor)', await pt7.evaluate(() => {
      const b=document.querySelector('.mm-gearbtn'), s=b.querySelector('svg');
      return getComputedStyle(s).color === getComputedStyle(b).color;
    }));

    // T7e: Clear all is an icon control; the mode button keeps its text label beside the icon
    check('T7e: Clear-all is an icon-only control (svg, no text label)', await pt7.evaluate(() => { const b=document.querySelector('.mm-clear'); return !!b.querySelector('svg') && !b.textContent.trim(); }));
    // mode is armed in this block; exit it so the button shows its off-state label, then verify text stays
    await pt7.evaluate(() => { if(document.body.classList.contains('mm-armed')) document.querySelector('.mm-modebtn').click(); });
    await pt7.waitForTimeout(40);
    check('T7e: "Start Markup Mode" keeps its text label beside the icon', await pt7.evaluate(() => /Start Markup Mode/.test(document.querySelector('.mm-modebtn').textContent) && !!document.querySelector('.mm-modebtn svg')));

    // T7f: ZERO-DEP — no <link>, no external src/href to fonts/CDNs, no @import in the markup-mode layer
    check('T7f: no <link> elements anywhere (no external stylesheets/fonts)', await pt7.evaluate(() => document.querySelectorAll('link').length === 0));
    check('T7f: no external src/href referencing http(s)/fonts/cdn anywhere', await pt7.evaluate(() =>
      ![...document.querySelectorAll('[src],[href]')].some(n => {
        const v = (n.getAttribute('src')||n.getAttribute('href')||'');
        return /^https?:|fonts\.|cdn\.|googleapis|unpkg|jsdelivr|cdnjs/i.test(v);
      })));
    check('T7f: no @import in any <style> block', await pt7.evaluate(() => ![...document.querySelectorAll('style')].some(s => /@import/i.test(s.textContent))));
    check('T7f: no <use xlink:href> external icon-sprite references', await pt7.evaluate(() =>
      ![...document.querySelectorAll('use')].some(u => /^https?:|\.svg/i.test(u.getAttribute('href')||u.getAttribute('xlink:href')||''))));

    // T7g: dock-position buttons — in float state both dockbtn-left and dockbtn-right are visible;
    //      after docking right, dockbtn-right is hidden and dockbtn-float/left are visible
    check('T7g: in float state dockbtn-right is visible (inactive position)', await pt7.evaluate(() => { const b=document.querySelector('.mm-dockbtn-right'); return b && b.style.display !== 'none'; }));
    check('T7g: in float state dockbtn-left is visible (inactive position)', await pt7.evaluate(() => { const b=document.querySelector('.mm-dockbtn-left'); return b && b.style.display !== 'none'; }));
    check('T7g: in float state dockbtn-float is hidden (current position)', await pt7.evaluate(() => { const b=document.querySelector('.mm-dockbtn-float'); return b && b.style.display === 'none'; }));
    await pt7.click('.mm-dockbtn-right'); await pt7.waitForTimeout(40); // dock right
    check('T7g: after docking right, dockbtn-right is hidden (current position)', await pt7.evaluate(() => { const b=document.querySelector('.mm-dockbtn-right'); return b && b.style.display === 'none'; }));
    check('T7g: after docking right, dockbtn-left is visible (inactive position)', await pt7.evaluate(() => { const b=document.querySelector('.mm-dockbtn-left'); return b && b.style.display !== 'none'; }));
    check('T7g: after docking right, dockbtn-float is visible (inactive position)', await pt7.evaluate(() => { const b=document.querySelector('.mm-dockbtn-float'); return b && b.style.display !== 'none'; }));
    check('T7g: dock buttons each have a non-empty aria-label', await pt7.evaluate(() => ['.mm-dockbtn-float','.mm-dockbtn-left','.mm-dockbtn-right'].every(s => { const b=document.querySelector(s); return !!(b && (b.getAttribute('aria-label')||'').trim()); })));
    await pt7.click('.mm-dockbtn-float'); await pt7.waitForTimeout(40); // back to float

    // T7h: (theme sun/moon button retired in D6 — theme now lives in the Appearance light/dark/auto seg)

    // T7i: rail-width grip carries a decorative aria-hidden svg (item 5 grip) when in rail mode
    check('T7i: rail grip contains an aria-hidden decorative svg', await pt7.evaluate(() => {
      const s = document.querySelector('.mm-railgrip svg');
      return !!s && s.getAttribute('aria-hidden') === 'true';
    }));

    await ct7.close();
  }

  // P1: dock-position icons — always-exposed set, direct navigation, minimize glyph, default+backcompat (fresh contexts)
  {
    const URL = `http://127.0.0.1:${PORT}/index.html`;

    // P1a: first-open default is right-railed (no stored dockState)
    {
      const cp = await browser.newContext(); const pp = await cp.newPage();
      await pp.goto(URL);
      await pp.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
      await pp.reload(); await pp.waitForTimeout(150);
      check('P1a: first-open default is right-railed (marginRight set)', await pp.evaluate(() => document.body.style.marginRight !== ''));
      check('P1a: first-open default has mm-rail class on dock', await pp.evaluate(() => document.querySelector('.mm-dock').classList.contains('mm-rail')));
      check('P1a: first-open panel is open in rail mode', await pp.evaluate(() => document.querySelector('.mm-panel').classList.contains('mm-open')));
      await cp.close();
    }

    // P1b: back-compat — a stored dockState of float loads as float (not overridden to right-rail)
    {
      const cp = await browser.newContext(); const pp = await cp.newPage();
      await pp.goto(URL);
      await pp.evaluate(() => {
        Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k));
        localStorage.setItem('markup-mode:index.html:dock', JSON.stringify({ mode: 'float' }));
      });
      await pp.reload(); await pp.waitForTimeout(150);
      check('P1b: stored float state loads as float (back-compat)', await pp.evaluate(() => !document.querySelector('.mm-dock').classList.contains('mm-rail') && document.body.style.marginRight === ''));
      check('P1b: stored float state reopens the floating panel by default', await pp.evaluate(() => document.querySelector('.mm-panel').classList.contains('mm-open')));
      await cp.close();
    }

    // P1c: position icon set — always shows exactly the two inactive positions
    {
      const cp = await browser.newContext(); const pp = await cp.newPage();
      await pp.goto(URL);
      await pp.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
      await pp.reload(); await pp.waitForTimeout(150);
      // default: right-rail → float and dock-left should be visible; dock-right hidden
      check('P1c: in right-rail state, dockbtn-float is visible', await pp.evaluate(() => { const b=document.querySelector('.mm-dockbtn-float'); return b && b.style.display !== 'none'; }));
      check('P1c: in right-rail state, dockbtn-left is visible', await pp.evaluate(() => { const b=document.querySelector('.mm-dockbtn-left'); return b && b.style.display !== 'none'; }));
      check('P1c: in right-rail state, dockbtn-right is hidden (current)', await pp.evaluate(() => { const b=document.querySelector('.mm-dockbtn-right'); return b && b.style.display === 'none'; }));
      // click dock-left → now left-railed → float and dock-right should be visible; dock-left hidden
      await pp.click('.mm-dockbtn-left'); await pp.waitForTimeout(40);
      check('P1c: after dock-left, dockbtn-float is visible', await pp.evaluate(() => { const b=document.querySelector('.mm-dockbtn-float'); return b && b.style.display !== 'none'; }));
      check('P1c: after dock-left, dockbtn-right is visible', await pp.evaluate(() => { const b=document.querySelector('.mm-dockbtn-right'); return b && b.style.display !== 'none'; }));
      check('P1c: after dock-left, dockbtn-left is hidden (current)', await pp.evaluate(() => { const b=document.querySelector('.mm-dockbtn-left'); return b && b.style.display === 'none'; }));
      check('P1c: dock-left sets marginLeft + clears marginRight', await pp.evaluate(() => document.body.style.marginLeft !== '' && document.body.style.marginRight === ''));
      // click float → now floating → dock-left and dock-right should be visible; float hidden
      await pp.click('.mm-dockbtn-float'); await pp.waitForTimeout(40);
      check('P1c: after float, dockbtn-left is visible', await pp.evaluate(() => { const b=document.querySelector('.mm-dockbtn-left'); return b && b.style.display !== 'none'; }));
      check('P1c: after float, dockbtn-right is visible', await pp.evaluate(() => { const b=document.querySelector('.mm-dockbtn-right'); return b && b.style.display !== 'none'; }));
      check('P1c: after float, dockbtn-float is hidden (current)', await pp.evaluate(() => { const b=document.querySelector('.mm-dockbtn-float'); return b && b.style.display === 'none'; }));
      check('P1c: float clears both margins', await pp.evaluate(() => document.body.style.marginLeft === '' && document.body.style.marginRight === ''));
      // click dock-right → now right-railed → marginRight set, dock-right hidden
      await pp.click('.mm-dockbtn-right'); await pp.waitForTimeout(40);
      check('P1c: clicking dockbtn-right moves to right-rail (marginRight set)', await pp.evaluate(() => document.body.style.marginRight !== ''));
      check('P1c: after dock-right, dockbtn-right is hidden (current)', await pp.evaluate(() => { const b=document.querySelector('.mm-dockbtn-right'); return b && b.style.display === 'none'; }));
      await pp.reload(); await pp.waitForTimeout(150);
      check('P1c: dock-right persists across reload', await pp.evaluate(() => document.querySelector('.mm-dock').classList.contains('mm-rail') && !document.querySelector('.mm-dock').classList.contains('mm-rail-left') && document.body.style.marginRight !== ''));
      await pp.click('.mm-dockbtn-left'); await pp.waitForTimeout(40);
      await pp.reload(); await pp.waitForTimeout(150);
      check('P1c: dock-left persists across reload', await pp.evaluate(() => document.querySelector('.mm-dock').classList.contains('mm-rail-left') && document.body.style.marginLeft !== ''));
      await pp.click('.mm-dockbtn-float'); await pp.waitForTimeout(40);
      await pp.reload(); await pp.waitForTimeout(150);
      check('P1c: float persists across reload', await pp.evaluate(() => !document.querySelector('.mm-dock').classList.contains('mm-rail') && document.querySelector('.mm-panel').classList.contains('mm-open') && document.body.style.marginLeft === '' && document.body.style.marginRight === ''));
      // all position buttons have aria-labels
      check('P1c: dockbtn-float aria-label is "Float"', await pp.evaluate(() => (document.querySelector('.mm-dockbtn-float').getAttribute('aria-label')||'') === 'Float'));
      check('P1c: dockbtn-left aria-label is "Dock left"', await pp.evaluate(() => (document.querySelector('.mm-dockbtn-left').getAttribute('aria-label')||'') === 'Dock left'));
      check('P1c: dockbtn-right aria-label is "Dock right"', await pp.evaluate(() => (document.querySelector('.mm-dockbtn-right').getAttribute('aria-label')||'') === 'Dock right'));
      await cp.close();
    }

    // P1d: minimize button — uses minimize glyph (inline svg), aria-label "Minimize", still collapses to pill
    {
      const cp = await browser.newContext(); const pp = await cp.newPage();
      await pp.goto(URL);
      await pp.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
      await pp.reload(); await pp.waitForTimeout(150);
      check('P1d: minimize button (.mm-close) has aria-label "Minimize"', await pp.evaluate(() => document.querySelector('.mm-close').getAttribute('aria-label') === 'Minimize'));
      check('P1d: minimize button contains an inline <svg>', await pp.evaluate(() => !!document.querySelector('.mm-close svg')));
      check('P1d: minimize button does NOT contain the X-close unicode glyph ✕', await pp.evaluate(() => !/✕/.test(document.querySelector('.mm-close').textContent)));
      // in rail mode, clicking minimize collapses to the pill but preserves the stored rail position
      check('P1d: panel is open in default right-rail mode', await pp.evaluate(() => document.querySelector('.mm-panel').classList.contains('mm-open')));
      await pp.click('.mm-close'); await pp.waitForTimeout(50);
      check('P1d: after minimize in rail mode, dock is no longer railed', await pp.evaluate(() => !document.querySelector('.mm-dock').classList.contains('mm-rail')));
      check('P1d: after minimize, handle pill is visible', await pp.evaluate(() => { const h=document.querySelector('.mm-handle'); return h && getComputedStyle(h).display !== 'none'; }));
      await pp.reload(); await pp.waitForTimeout(150);
      check('P1d: minimized rail reloads minimized, without reserving rail margin', await pp.evaluate(() => !document.querySelector('.mm-dock').classList.contains('mm-rail') && !document.querySelector('.mm-panel').classList.contains('mm-open') && document.body.style.marginRight === ''));
      await pp.click('.mm-handle'); await pp.waitForTimeout(80);
      check('P1d: reopening after reload restores the stored right rail', await pp.evaluate(() => document.querySelector('.mm-dock').classList.contains('mm-rail') && document.body.style.marginRight !== ''));
      await cp.close();
    }
  }

  // MD: one-command Markdown route — apply.sh renders .md -> markup.html (no browser needed)
  {
    const repo = path.join(__dirname, '..');
    const applier = path.join(repo, 'scripts', 'apply.sh');
    const fixture = path.join(repo, 'tests', 'fixtures', 'sample.md');
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-md-'));
    const cleanup = [];
    const run = (args) => execFileSync('bash', [applier, ...args], { cwd: outDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    // MD1: default run renders + passes the static self-check
    let summary = '';
    try { summary = run([fixture]); } catch (e) { summary = (e.stdout || '') + (e.stderr || ''); check('MD1: apply.sh sample.md exits 0', false); }
    const out = path.join(outDir, 'sample.markup.html');
    cleanup.push(out);
    check('MD1: apply.sh sample.md produced sample.markup.html', fs.existsSync(out));
    check('MD1: static self-check passed ("apply + static self-check passed")', /apply \+ static self-check passed/.test(summary));
    check('MD1: summary names the engine used', /engine\s*:/.test(summary));

    const html = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    // MD2: review layer is present (same block the HTML route splices)
    check('MD2: markup-mode layer present (mm-style + __mmLayer)', /id="mm-style"/.test(html) && /__mmLayer/.test(html));
    // MD3: real rendered content — catches a converter silently degrading to plain text
    check('MD3: rendered <h1> present (real heading, not literal #)', /<h1[^>]*>\s*Sample\s*<\/h1>/.test(html));
    check('MD3: rendered <table> present (GFM table, not literal pipes)', /<table/.test(html));
    // MD4: Source = abs path of the ORIGINAL fixture .md (not the temp preview)
    check('MD4: MarkupModeConfig sourcePath = abs path of fixture .md', new RegExp('"?sourcePath"?:\\s*"' + fixture.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(html));
    // MD5: relative image rewritten to file://, fragment + external links left untouched
    check('MD5: relative image rewritten to file://.../img/x.png', new RegExp('src="file://[^"]*' + path.join('img', 'x.png').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(html));
    check('MD5: fragment link (#sample) left untouched', /href="#sample"/.test(html));
    check('MD5: external https link left untouched', /href="https:\/\/example\.com\/page"/.test(html));
    const spacedMd = path.join(outDir, 'spaced.md');
    fs.writeFileSync(spacedMd, '# Spaced\n\n<img src="img/with space%23literal.png" alt="alt">\n\n<a href="docs/a b.md?x=1#sec two">query</a>\n');
    cleanup.push(spacedMd);
    let spacedHtml = '';
    try { run([spacedMd]); spacedHtml = fs.readFileSync(path.join(outDir, 'spaced.markup.html'), 'utf8'); cleanup.push(path.join(outDir, 'spaced.markup.html')); } catch (e) {}
    check('MD5b: relative image file:// URL encodes spaces and literal # in path', /src="file:\/\/[^"]*img\/with%20space%23literal\.png"/.test(spacedHtml));
    check('MD5b: relative link preserves encoded query + fragment on file:// URL', /href="file:\/\/[^"]*docs\/a%20b\.md\?x=1#sec%20two"/.test(spacedHtml));
    // MD6: bare URL autolinked (GFM fidelity), front-matter stripped
    check('MD6: bare URL autolinked', /href="https:\/\/example\.com\/bare"/.test(html));
    check('MD6: YAML front-matter stripped (no "author: regression")', !/author:\s*regression/.test(html));
    // MD7: title HTML-escaping — render a fixture whose H1 has & < > and assert it is escaped in <title>
    const tmpMd = path.join(outDir, 'amp.md');
    fs.writeFileSync(tmpMd, '# A & B <C>\n\nbody\n');
    cleanup.push(tmpMd);
    let ampHtml = '';
    try { run([tmpMd]); ampHtml = fs.readFileSync(path.join(outDir, 'amp.markup.html'), 'utf8'); cleanup.push(path.join(outDir, 'amp.markup.html')); } catch (e) {}
    check('MD7: title is HTML-escaped in <title> (& -> &amp;, < -> &lt;)', /<title>A &amp; B &lt;C&gt;<\/title>/.test(ampHtml));

    // MD8: --safe strips raw script/style/on*/js-url; default passes raw through
    const unsafeMd = path.join(outDir, 'unsafe.md');
    fs.writeFileSync(unsafeMd, '# Unsafe\n\n<script>alert(\'pwn\')</script>\n\n<style>body{visibility:hidden}</style>\n\n<a href="javascript:alert(1)">x</a>\n\n<div onclick="go()">y</div>\n');
    cleanup.push(unsafeMd);
    let safeHtml = '', rawHtml = '';
    try { run([unsafeMd, '--safe']); safeHtml = fs.readFileSync(path.join(outDir, 'unsafe.markup.html'), 'utf8'); } catch (e) {}
    check('MD8: --safe strips raw <script> from the doc', !/alert\('pwn'\)/.test(safeHtml));
    check('MD8: --safe strips raw doc <style> (body{visibility:hidden})', !/body\{visibility:hidden\}/.test(safeHtml));
    check('MD8: --safe neutralizes javascript: href', !/javascript:alert/.test(safeHtml));
    check('MD8: --safe strips on* handler (onclick)', !/onclick=/.test(safeHtml));
    try { run([unsafeMd]); rawHtml = fs.readFileSync(path.join(outDir, 'unsafe.markup.html'), 'utf8'); cleanup.push(path.join(outDir, 'unsafe.markup.html')); } catch (e) {}
    check('MD8: default (no --safe) passes raw <script> through', /alert\('pwn'\)/.test(rawHtml));

    // MD9: --md-engine python is explicit-only — either prints the reduced-fidelity warning (if installed)
    //      or exits non-zero with an install hint (no-converter branch behaves correctly).
    let pyOut = '', pyOk = false;
    try { pyOut = run([fixture, '--md-engine', 'python']); pyOk = true; cleanup.push(out); } catch (e) { pyOut = (e.stdout || '') + (e.stderr || ''); }
    check('MD9: --md-engine python either warns on reduced GFM fidelity OR exits with an install hint',
      (pyOk && /reduced GFM fidelity/.test(pyOut)) || (!pyOk && /pip install markdown/.test(pyOut)));

    // MD10: unknown --md-engine value is rejected non-zero
    let badOk = false, badOut = '';
    try { run([fixture, '--md-engine', 'bogus']); badOk = true; } catch (e) { badOut = (e.stderr || '') + (e.stdout || ''); }
    check('MD10: unknown --md-engine value exits non-zero with a clear error', !badOk && /--md-engine must be/.test(badOut));

    // MD11: generated Markdown previews bias prose-block clicks to whole-block TEXT anchors.
    if (html) {
      const mdServer = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
      await new Promise(r => mdServer.listen(0, '127.0.0.1', r));
      const mdPort = mdServer.address().port;
      const cm = await browser.newContext();
      const pm = await cm.newPage();
      await pm.goto(`http://127.0.0.1:${mdPort}/sample.markup.html`);
      await pm.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
      await pm.reload(); await pm.waitForTimeout(120);
      await pm.click('.mm-modebtn'); await pm.waitForTimeout(40);
      await pm.evaluate(() => {
        const p=[...document.querySelectorAll('.doc p')].find(el => /Below the break/.test(el.textContent));
        const r=p.getBoundingClientRect();
        p.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+8,clientY:r.top+8}));
      });
      await pm.waitForTimeout(80);
      check('MD11: clicking Markdown paragraph opens a TEXT note', await pm.evaluate(() =>
        document.querySelector('.mm-pop').classList.contains('mm-open') &&
        document.querySelector('.mm-popkind').textContent === 'TEXT' &&
        /Below the break/.test(document.querySelector('.mm-popquote').textContent)));
      await pm.keyboard.press('Escape'); await pm.waitForTimeout(40);
      await pm.click('a[href="https://example.com/page"]'); await pm.waitForTimeout(80);
      check('MD11: clicking Markdown link remains an ELEMENT note', await pm.evaluate(() =>
        document.querySelector('.mm-pop').classList.contains('mm-open') &&
        document.querySelector('.mm-popkind').textContent === 'ELEMENT' &&
        /a/.test(document.querySelector('.mm-popwhere').textContent)));
      await pm.keyboard.press('Escape'); await pm.waitForTimeout(40);
      await pm.evaluate(() => {
        const pre=document.querySelector('.doc pre');
        const r=pre.getBoundingClientRect();
        pre.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+8,clientY:r.top+8}));
      });
      await pm.waitForTimeout(80);
      check('MD11: clicking Markdown code block opens a TEXT note for the block', await pm.evaluate(() =>
        document.querySelector('.mm-pop').classList.contains('mm-open') &&
        document.querySelector('.mm-popkind').textContent === 'TEXT' &&
        /def hello/.test(document.querySelector('.mm-popquote').textContent)));
      await cm.close();
      await new Promise(r => mdServer.close(r));
    }

    for (const f of cleanup) { try { fs.unlinkSync(f); } catch (e) {} }
    try { fs.rmdirSync(outDir, { recursive: true }); } catch (e) {}
  }

  // RH: Reviewed-HTML — seed-on-mount precedence + Export reviewed HTML round-trip + no phantom note
  {
    const URL = `http://127.0.0.1:${PORT}/index.html`;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-rh-'));
    const tmpFiles = [];
    const writeTmp = (name, body) => { const f = path.join(tmpDir, name); fs.writeFileSync(f, body); tmpFiles.push(f); return 'file://' + f; };
    const embed = (notesArr) => '<script type="application/json" id="mm-notes">' + JSON.stringify(notesArr) + '</' + 'script>';
    // an embedded block placed just before the layer's <style id="mm-style"> (same spot the exporter writes)
    const withEmbedded = (notesArr) => html.replace('<style id="mm-style">', embed(notesArr) + '\n<style id="mm-style">');
    const seedNotes = [
      { id: 1, comment: 'seeded text note', ts: 1, anchors: [{ kind: 'text', selector: '.sub', quote: 'review mode', where: 'p "Turn on…"' }] },
      { id: 2, comment: 'seeded element note', ts: 2, anchors: [{ kind: 'element', selector: '.card', quote: 'Text anchor', where: 'div.card' }] }
    ];

    // RH1: seed-on-mount — embedded #mm-notes + empty localStorage ⇒ notes rehydrate (rows + pins)
    {
      const u = writeTmp('seed.reviewed.html', withEmbedded(seedNotes));
      const c = await browser.newContext(); const p = await c.newPage();
      await p.goto(u);
      await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('markup-mode')).forEach(k => localStorage.removeItem(k)));
      await p.reload(); await p.waitForTimeout(150);
      check('RH1: embedded #mm-notes present in the file', await p.evaluate(() => !!document.getElementById('mm-notes')));
      check('RH1: notes seeded from embedded block when localStorage empty (in-memory count)', await p.evaluate(() => {
        // dock count badge reflects the live `notes` array even before any persist
        return /Markup · 2/.test(document.querySelector('.mm-handle .mm-count').textContent);
      }));
      // panel already open in default right-rail mode; no need to click handle
      await p.waitForTimeout(40);
      check('RH1: two dock rows rendered from seed', (await p.$$('.mm-row')).length === 2);
      check('RH1: pins built from seed (>=2)', (await p.$$('.mm-overlay .mm-pin')).length >= 2);
      check('RH1: seeded comment text appears in a row', await p.evaluate(() => /seeded text note/.test(document.querySelector('.mm-list').textContent)));
      await c.close();
    }

    // RH2: precedence — localStorage WINS; the stale embedded block is ignored when localStorage has notes
    {
      const u = writeTmp('precedence.reviewed.html', withEmbedded(seedNotes));
      const c = await browser.newContext(); const p = await c.newPage();
      await p.goto(u);
      // pre-seed localStorage for THIS file's namespace with a single, different note
      await p.evaluate(() => {
        Object.keys(localStorage).filter(k => k.startsWith('markup-mode')).forEach(k => localStorage.removeItem(k));
        const ns = 'markup-mode:' + (location.pathname.split('/').pop());
        localStorage.setItem(ns + ':notes', JSON.stringify([{ id: 9, comment: 'localStorage wins', ts: 1, anchors: [{ kind: 'element', selector: '.card', quote: 'x', where: 'div.card' }] }]));
      });
      await p.reload(); await p.waitForTimeout(150);
      // panel already open in default right-rail mode
      await p.waitForTimeout(40);
      check('RH2: localStorage wins — only the localStorage note (1 row), embedded ignored', (await p.$$('.mm-row')).length === 1);
      check('RH2: localStorage note content is shown (not the embedded seed)', await p.evaluate(() => {
        const t = document.querySelector('.mm-list').textContent; return /localStorage wins/.test(t) && !/seeded text note/.test(t);
      }));
      await c.close();
    }

    // RH3: round-trip — create notes on the live page, Export reviewed HTML, reopen the captured file, assert rehydrate + clean snapshot + self-contained
    {
      const c = await browser.newContext({ acceptDownloads: true }); const p = await c.newPage();
      await p.goto(URL);
      await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('markup-mode')).forEach(k => localStorage.removeItem(k)));
      await p.reload(); await p.waitForTimeout(120);
      // make a text note + an element note (panel already open in default right-rail mode)
      await p.click('.mm-modebtn'); await p.waitForTimeout(40);
      await p.evaluate(() => {
        const t = document.querySelector('.sub').firstChild;
        const sel = window.getSelection(); sel.removeAllRanges();
        const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 4);
        sel.addRange(r); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
      await p.waitForTimeout(60);
      await p.fill('.mm-pop textarea', 'roundtrip text note'); await p.click('.mm-pop .mm-save'); await p.waitForTimeout(60);
      await p.evaluate(() => window.getSelection().removeAllRanges());
      await p.click('.card'); await p.waitForTimeout(60);
      await p.fill('.mm-pop textarea', 'roundtrip element note'); await p.click('.mm-pop .mm-save'); await p.waitForTimeout(60);
      // exit comment mode, then Export reviewed HTML and capture the download
      await p.evaluate(() => { if (document.body.classList.contains('mm-armed')) document.querySelector('.mm-modebtn').click(); });
      await p.waitForTimeout(40);
      await p.evaluate(() => { window.showSaveFilePicker = undefined; });
      await p.click('.mm-exportbtn'); await p.waitForTimeout(20);
      const [dl] = await Promise.all([
        p.waitForEvent('download'),
        p.click('.mm-mi-html')
      ]);
      check('RH3: download filename ends with .reviewed.html', /\.reviewed\.html$/.test(dl.suggestedFilename()));
      const dlPath = await dl.path();
      const exported = fs.readFileSync(dlPath, 'utf8');
      const expFile = path.join(tmpDir, 'captured.reviewed.html');
      fs.writeFileSync(expFile, exported); tmpFiles.push(expFile);

      // clean-snapshot assertions on the captured HTML (static text checks)
      check('RH3: exported carries an #mm-notes JSON block', /<script type="application\/json" id="mm-notes">/.test(exported));
      check('RH3: exported #mm-notes contains both notes', /roundtrip text note/.test(exported) && /roundtrip element note/.test(exported));
      check('RH3: exactly one #mm-notes block (idempotent, no stacking)', (exported.match(/<script type="application\/json" id="mm-notes">/g) || []).length === 1);
      check('RH3: self-contained — inline layer present (mm-style + __mmLayer)', /id="mm-style"/.test(exported) && /__mmLayer/.test(exported));
      // CLEAN: runtime-injected nodes must NOT be baked into the static markup
      check('RH3: no baked .mm-dock node in exported markup', !/class="mm-ui mm-dock"|class="mm-dock/.test(exported));
      check('RH3: no baked .mm-overlay node in exported markup', !/class="mm-overlay/.test(exported));
      check('RH3: no baked .mm-pop / .mm-toast / .mm-refchip nodes', !/class="mm-ui mm-pop|class="mm-ui mm-toast|class="mm-ui mm-refchip/.test(exported));
      check('RH3: no leftover rail body margin baked into <body>', !/<body[^>]*style="[^"]*margin-(left|right)/i.test(exported));

      // reopen the captured file in a FRESH context with empty localStorage ⇒ notes rehydrate from baked block
      const c2 = await browser.newContext({ acceptDownloads: true }); const p2 = await c2.newPage();
      await p2.goto('file://' + expFile);
      await p2.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('markup-mode')).forEach(k => localStorage.removeItem(k)));
      await p2.reload(); await p2.waitForTimeout(150);
      check('RH3: reopened file mounts the layer exactly once (1 dock)', (await p2.$$('.mm-dock')).length === 1);
      check('RH3: reopened file has exactly one overlay (no duplicate injection)', (await p2.$$('.mm-overlay')).length === 1);
      // panel already open in default right-rail mode on reopened file
      await p2.waitForTimeout(40);
      check('RH3: notes rehydrate from baked block on reopen (2 rows)', (await p2.$$('.mm-row')).length === 2);
      check('RH3: rehydrated rows show both comments', await p2.evaluate(() => {
        const t = document.querySelector('.mm-list').textContent; return /roundtrip text note/.test(t) && /roundtrip element note/.test(t);
      }));
      check('RH3: pins rebuilt on reopen (>=2)', (await p2.$$('.mm-overlay .mm-pin')).length >= 2);
      // RH3 re-export idempotency: exporting the already-reviewed/already-mounted file replaces (not stacks) the block
      await p2.evaluate(() => { window.showSaveFilePicker = undefined; });
      await p2.click('.mm-exportbtn'); await p2.waitForTimeout(20);
      const [dl2] = await Promise.all([ p2.waitForEvent('download'), p2.click('.mm-mi-html') ]);
      const reExported = fs.readFileSync(await dl2.path(), 'utf8');
      check('RH3: re-exporting an already-reviewed file keeps exactly one #mm-notes block', (reExported.match(/<script type="application\/json" id="mm-notes">/g) || []).length === 1);
      check('RH3: re-export still self-contained + clean (no baked dock/overlay)', /id="mm-style"/.test(reExported) && !/class="mm-overlay/.test(reExported) && !/class="mm-ui mm-dock"/.test(reExported));
      await c2.close();
      await c.close();
    }

    // RH4: no phantom note when exporting reviewed HTML — comment mode AND copy-ref mode
    {
      const c = await browser.newContext({ acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
      const p = await c.newPage();
      await p.goto(URL);
      await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('markup-mode')).forEach(k => localStorage.removeItem(k)));
      await p.reload(); await p.waitForTimeout(120);
      // panel already open in default right-rail mode
      await p.click('.mm-modebtn'); await p.waitForTimeout(40);
      await p.click('.card'); await p.waitForTimeout(60);
      await p.fill('.mm-pop textarea', 'rh4 seed note'); await p.click('.mm-pop .mm-save'); await p.waitForTimeout(60);
      const before = await p.evaluate(() => JSON.parse(localStorage.getItem('markup-mode:index.html:notes') || '[]').length);
      // comment mode export
      await p.evaluate(() => { window.showSaveFilePicker = undefined; });
      await p.click('.mm-exportbtn'); await p.waitForTimeout(20);
      const dl1 = p.waitForEvent('download'); await p.click('.mm-mi-html'); await dl1; await p.waitForTimeout(80);
      const afterComment = await p.evaluate(() => JSON.parse(localStorage.getItem('markup-mode:index.html:notes') || '[]').length);
      const popupOpen = await p.evaluate(() => document.querySelector('.mm-pop').classList.contains('mm-open'));
      check('RH4: Export reviewed HTML in comment mode creates no phantom note', afterComment === before);
      check('RH4: Export reviewed HTML in comment mode does not open the popup', !popupOpen);
      // copy-ref mode export  [QUARANTINED: copy-ref button hidden]
      if (COPY_REF_ENABLED) {
      await p.evaluate(() => navigator.clipboard && navigator.clipboard.writeText('rh4-sentinel'));
      await p.click('.mm-copyref'); await p.waitForTimeout(30);
      await p.evaluate(() => { window.showSaveFilePicker = undefined; });
      await p.click('.mm-exportbtn'); await p.waitForTimeout(20);
      const dl2 = p.waitForEvent('download'); await p.click('.mm-mi-html'); await dl2; await p.waitForTimeout(80);
      const afterCopyRef = await p.evaluate(() => JSON.parse(localStorage.getItem('markup-mode:index.html:notes') || '[]').length);
      const clip = await p.evaluate(() => navigator.clipboard ? navigator.clipboard.readText().catch(() => '') : '');
      check('RH4: Export reviewed HTML in copy-ref mode creates no phantom note', afterCopyRef === before);
      check('RH4: Export reviewed HTML in copy-ref mode does not write a ref token to clipboard', !/\[ref:/.test(clip));
      }
      await c.close();
    }

    // RH5: hostile-payload round-trip — a note whose comment contains </script>, <!--, and an onerror= payload
    //      must NOT break out of the embedded JSON block (no stored XSS, no silent corruption).
    {
      const PAYLOAD = "the </script><img src=x onerror=\"window.__pwned=1\"> tag and <!-- comment --> are misplaced";
      const c = await browser.newContext({ acceptDownloads: true }); const p = await c.newPage();
      await p.goto(URL);
      await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('markup-mode')).forEach(k => localStorage.removeItem(k)));
      await p.reload(); await p.waitForTimeout(120);
      // panel already open in default right-rail mode
      await p.click('.mm-modebtn'); await p.waitForTimeout(40);
      await p.click('.card'); await p.waitForTimeout(60);
      await p.fill('.mm-pop textarea', PAYLOAD); await p.click('.mm-pop .mm-save'); await p.waitForTimeout(60);
      await p.evaluate(() => { if (document.body.classList.contains('mm-armed')) document.querySelector('.mm-modebtn').click(); });
      await p.waitForTimeout(40);
      await p.evaluate(() => { window.showSaveFilePicker = undefined; });
      await p.click('.mm-exportbtn'); await p.waitForTimeout(20);
      const [dlh] = await Promise.all([ p.waitForEvent('download'), p.click('.mm-mi-html') ]);
      const hostile = fs.readFileSync(await dlh.path(), 'utf8');
      const hostileFile = path.join(tmpDir, 'hostile.reviewed.html');
      fs.writeFileSync(hostileFile, hostile); tmpFiles.push(hostileFile);
      // static: the embedded block must have escaped < so no real </script> or <!-- appears inside it
      check('RH5: embedded #mm-notes escapes < (no raw </script> inside the JSON block)', await (async () => {
        const m = hostile.match(/<script type="application\/json" id="mm-notes">([\s\S]*?)<\/script>/);
        return !!m && !/<\/script/i.test(m[1]) && !/<!--/.test(m[1]) && /\\u003c/.test(m[1]);
      })());

      // reopen the hostile file in a FRESH context with empty localStorage
      const c2 = await browser.newContext(); const p2 = await c2.newPage();
      const pageErrs = []; p2.on('pageerror', e => pageErrs.push(String(e)));
      await p2.goto('file://' + hostileFile);
      await p2.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('markup-mode')).forEach(k => localStorage.removeItem(k)));
      await p2.reload(); await p2.waitForTimeout(150);
      // (a) the layer is alive
      check('RH5: layer alive after reopen (__mmLayer set + dock present)', await p2.evaluate(() => window.__mmLayer === true) && (await p2.$('.mm-dock')) !== null);
      // (c) no injected handler ran — sentinel stays undefined; and the parser did not see an injected <img>
      check('RH5: onerror payload did NOT execute (window.__pwned undefined)', await p2.evaluate(() => typeof window.__pwned === 'undefined'));
      check('RH5: no injected <img src=x onerror=...> node exists in the DOM', await p2.evaluate(() => !document.querySelector('img[onerror],img[src="x"]')));
      // (b) note count intact + comment text round-trips verbatim (panel already open in right-rail)
      await p2.waitForTimeout(40);
      check('RH5: exactly one note rehydrated (JSON not truncated)', (await p2.$$('.mm-row')).length === 1);
      check('RH5: comment text round-trips verbatim (includes </script>, <!--, onerror=)', await p2.evaluate(() => {
        const t = document.querySelector('.mm-list').textContent;
        return /<\/script><img src=x onerror=/.test(t) && /<!-- comment -->/.test(t);
      }));
      check('RH5: no uncaught page error on reopening the hostile file', pageErrs.length === 0);
      await c2.close();
      await c.close();
    }

    for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (e) {} }
    try { fs.rmdirSync(tmpDir, { recursive: true }); } catch (e) {}
  }

  // PW: popup width resize — min-width, drag widens, persists to dockState.popW, applied on next open, clamped on reload, stays on-screen (fresh context)
  {
    const URL = `http://127.0.0.1:${PORT}/index.html`;
    const cpw = await browser.newContext();
    const ppw = await cpw.newPage();
    await ppw.goto(URL);
    await ppw.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await ppw.reload(); await ppw.waitForTimeout(120);

    // seed one note (opens popup) so we can inspect it (panel already open in default right-rail mode)
    await ppw.click('.mm-modebtn'); await ppw.waitForTimeout(40);
    await ppw.click('.card'); await ppw.waitForTimeout(60);

    // PW1: popup opens at default width (300) and has min-width 300 in CSS
    const defaultW = await ppw.evaluate(() => document.querySelector('.mm-pop').offsetWidth);
    check('PW1: popup opens at default width (300px)', defaultW === 300);
    check('PW1: popup CSS min-width is 300px', await ppw.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.mm-pop'));
      return parseInt(cs.minWidth, 10) === 300;
    }));
    check('PW1: popup CSS max-width clamps at min(540px,90vw)', await ppw.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.mm-pop'));
      const mw = cs.maxWidth;
      return /540px|min\(|90vw/.test(mw) || parseInt(mw, 10) <= 540;
    }));

    // PW2: .mm-popgrip exists inside .mm-pop, is aria-hidden, has no tabindex
    check('PW2: .mm-popgrip exists inside popup', await ppw.evaluate(() => !!document.querySelector('.mm-pop .mm-popgrip')));
    check('PW2: grip is aria-hidden (not a tab stop)', await ppw.evaluate(() => {
      const g = document.querySelector('.mm-popgrip');
      return g.getAttribute('aria-hidden') === 'true' && g.tabIndex < 0;
    }));

    // PW3: drag grip right — popup widens and stays >= 300 (min enforced)
    const grip = await ppw.$('.mm-popgrip');
    const gb = await grip.boundingBox();
    await ppw.mouse.move(gb.x + gb.width/2, gb.y + gb.height/2);
    await ppw.mouse.down();
    await ppw.mouse.move(gb.x + gb.width/2 + 80, gb.y + gb.height/2, { steps: 6 });
    await ppw.mouse.up();
    await ppw.waitForTimeout(40);
    const widenedW = await ppw.evaluate(() => document.querySelector('.mm-pop').offsetWidth);
    check('PW3: dragging grip right increases popup width', widenedW > defaultW);
    check('PW3: widened width is still >= 300 (min enforced)', widenedW >= 300);

    // PW4: persisted to dockState.popW after drag release
    const savedPopW = await ppw.evaluate(() => { const d=JSON.parse(localStorage.getItem('markup-mode:index.html:dock')||'{}'); return d.popW; });
    check('PW4: dockState.popW saved after drag', savedPopW != null && savedPopW >= 300);
    check('PW4: saved popW matches popup offsetWidth', Math.abs(savedPopW - widenedW) <= 1);

    // save the note, open a new one, confirm persisted width applies on open
    await ppw.fill('.mm-pop textarea', 'pw test note'); await ppw.click('.mm-pop .mm-save'); await ppw.waitForTimeout(60);
    await ppw.click('.cards .card:nth-of-type(2)'); await ppw.waitForTimeout(60);
    const reopenW = await ppw.evaluate(() => document.querySelector('.mm-pop').offsetWidth);
    check('PW4: next popup opens at the persisted width', Math.abs(reopenW - widenedW) <= 1);
    await ppw.keyboard.press('Escape'); await ppw.waitForTimeout(40);

    // PW5: popup stays within the viewport after widening (left + width <= innerWidth)
    check('PW5: popup stays within viewport (left+width <= innerWidth)', await ppw.evaluate(() => {
      const pop = document.querySelector('.mm-pop');
      const l = parseFloat(pop.style.left) || 0, w = pop.offsetWidth;
      return (l + w) <= innerWidth + 1;
    }));

    // PW6: a stored popW below default (300) is clamped to 300 on open — force a bad value, reload, open popup
    await ppw.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('markup-mode:index.html:dock')||'{}');
      d.popW = 150; // below min
      localStorage.setItem('markup-mode:index.html:dock', JSON.stringify(d));
    });
    await ppw.reload(); await ppw.waitForTimeout(150);
    // panel already open (dock persisted as rail or default rail); ensure mode is on
    await ppw.evaluate(() => { if(!document.querySelector('.mm-panel').classList.contains('mm-open')) document.querySelector('.mm-handle').click(); });
    await ppw.click('.mm-modebtn'); await ppw.waitForTimeout(40);
    await ppw.click('.card'); await ppw.waitForTimeout(60);
    const clampedW = await ppw.evaluate(() => document.querySelector('.mm-pop').offsetWidth);
    check('PW6: stored popW below 300 is clamped to min-width 300 on open', clampedW >= 300);
    await ppw.keyboard.press('Escape'); await ppw.waitForTimeout(40);

    // PW7: focus trap and role=dialog still intact after resize
    check('PW7: popup role=dialog intact', await ppw.evaluate(() => document.querySelector('.mm-pop').getAttribute('role') === 'dialog'));
    check('PW7: popup aria-modal=false (non-modal by design)', await ppw.evaluate(() => document.querySelector('.mm-pop').getAttribute('aria-modal') === 'false'));

    await cpw.close();
  }

  // PT: pin hover tooltip — shows/hides, mode-gated, text-content only, click/dblclick intact (fresh context)
  {
    const URL = `http://127.0.0.1:${PORT}/index.html`;
    const cpt = await browser.newContext();
    const ppt = await cpt.newPage();
    await ppt.goto(URL);
    await ppt.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await ppt.reload(); await ppt.waitForTimeout(120);

    // seed one element note (panel already open in default right-rail mode)
    await ppt.click('.mm-modebtn'); await ppt.waitForTimeout(40);
    await ppt.click('.card'); await ppt.waitForTimeout(60);
    await ppt.fill('.mm-pop textarea', 'hello tooltip note'); await ppt.click('.mm-pop .mm-save'); await ppt.waitForTimeout(60);

    // exit comment mode
    await ppt.evaluate(() => { if(document.body.classList.contains('mm-armed')) document.querySelector('.mm-modebtn').click(); });
    await ppt.waitForTimeout(40);

    // PT1: tooltip element is in DOM with correct structure
    check('PT1: .mm-pintip present in DOM', await ppt.evaluate(() => !!document.querySelector('.mm-pintip')));
    check('PT1: .mm-pintip has mm-ui class', await ppt.evaluate(() => document.querySelector('.mm-pintip').classList.contains('mm-ui')));
    check('PT1: .mm-pintip is position:fixed', await ppt.evaluate(() => getComputedStyle(document.querySelector('.mm-pintip')).position === 'fixed'));
    check('PT1: tooltip has no "Mark N" label and no hint node (note-only)', await ppt.evaluate(() => !document.querySelector('.mm-pintip-mark') && !document.querySelector('.mm-pintip-hint')));

    // PT2: hover a pin with mode OFF → tooltip shows, contains comment text, mark label, and hint
    const pinBox = await ppt.$eval('.mm-overlay .mm-pin[data-id="1"]', el => { const r=el.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; });
    await ppt.mouse.move(pinBox.x, pinBox.y);
    await ppt.waitForTimeout(80);
    const tipState = await ppt.evaluate(() => {
      const t = document.querySelector('.mm-pintip');
      return {
        shown: t.classList.contains('mm-show'),
        bodyText: t.querySelector('.mm-pintip-body').textContent,
        full: t.textContent.trim(),
        opacity: parseFloat(getComputedStyle(t).opacity),
        background: getComputedStyle(t).backgroundColor,
        rect: (() => { const r=t.getBoundingClientRect(); return {left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height}; })()
      };
    });
    check('PT2: hovering pin (mode off) shows tooltip (mm-show)', tipState.shown);
    check('PT2: tooltip body contains the note comment', tipState.bodyText === 'hello tooltip note');
    check('PT2: tooltip shows the note text ONLY (no "Mark N", no hint)', tipState.full === 'hello tooltip note');
    check('PT2: tooltip is slightly translucent', tipState.opacity < 1);
    check('PT2: tooltip appears near the activation cursor', Math.hypot((tipState.rect.left + tipState.rect.width/2) - pinBox.x, (tipState.rect.top + tipState.rect.height/2) - pinBox.y) < 260);
    check('PT2: tooltip avoids covering the marked element when space allows', await ppt.evaluate(() => {
      const t=document.querySelector('.mm-pintip'), target=document.querySelector('.card');
      const tr=t.getBoundingClientRect(), ar=target.getBoundingClientRect();
      const x=Math.max(0, Math.min(tr.right,ar.right)-Math.max(tr.left,ar.left));
      const y=Math.max(0, Math.min(tr.bottom,ar.bottom)-Math.max(tr.top,ar.top));
      return x*y === 0;
    }));

    // PT3: pointer-leave hides the tooltip
    await ppt.mouse.move(0, 0);
    await ppt.waitForTimeout(80);
    check('PT3: pointer-leave hides tooltip (no mm-show)', await ppt.evaluate(() => !document.querySelector('.mm-pintip').classList.contains('mm-show')));

    // PT4: comment containing HTML markup is rendered as plain text (not parsed as HTML)
    // add a second note with markup in the comment
    await ppt.evaluate(() => { if(!document.body.classList.contains('mm-armed')) document.querySelector('.mm-modebtn').click(); });
    await ppt.waitForTimeout(40);
    await ppt.click('.cards .card:nth-of-type(2)'); await ppt.waitForTimeout(60);
    await ppt.fill('.mm-pop textarea', '<b>bold</b> & <i>italic</i>'); await ppt.click('.mm-pop .mm-save'); await ppt.waitForTimeout(60);
    await ppt.evaluate(() => { if(document.body.classList.contains('mm-armed')) document.querySelector('.mm-modebtn').click(); });
    await ppt.waitForTimeout(40);

    const pin2Box = await ppt.$eval('.mm-overlay .mm-pin[data-id="2"]', el => { const r=el.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; });
    await ppt.mouse.move(pin2Box.x, pin2Box.y);
    await ppt.waitForTimeout(80);
    check('PT4: comment with HTML tags rendered as plain text (textContent, not innerHTML)', await ppt.evaluate(() => {
      const body = document.querySelector('.mm-pintip-body');
      return body.textContent === '<b>bold</b> & <i>italic</i>' && body.querySelector('b') === null;
    }));
    await ppt.mouse.move(0, 0); await ppt.waitForTimeout(40);

    // PT5: with comment mode ON, hovering a pin does NOT show the tooltip
    await ppt.evaluate(() => { if(!document.body.classList.contains('mm-armed')) document.querySelector('.mm-modebtn').click(); });
    await ppt.waitForTimeout(40);
    await ppt.mouse.move(pinBox.x, pinBox.y);
    await ppt.waitForTimeout(80);
    check('PT5: hovering pin with mode ON does NOT show tooltip', await ppt.evaluate(() => !document.querySelector('.mm-pintip').classList.contains('mm-show')));
    await ppt.evaluate(() => { if(document.body.classList.contains('mm-armed')) document.querySelector('.mm-modebtn').click(); });
    await ppt.waitForTimeout(40);

    // PT6: single-click on pin still reveals/selects (no editor) — tooltip doesn't break gestures
    await ppt.click('.mm-overlay .mm-pin[data-id="1"]');
    await ppt.waitForFunction(() => document.querySelector('.mm-row[data-id="1"]')?.classList.contains('mm-row-active'), null, { timeout: 2000 });
    check('PT6: pin single-click still reveals+selects (mm-row-active, no popup)', await ppt.evaluate(() =>
      document.querySelector('.mm-row[data-id="1"]').classList.contains('mm-row-active') &&
      !document.querySelector('.mm-pop').classList.contains('mm-open')));

    // PT7: double-click on pin still opens editor
    await ppt.dblclick('.mm-overlay .mm-pin[data-id="1"]'); await ppt.waitForTimeout(60);
    check('PT7: pin double-click still opens editor (popup open)', await ppt.evaluate(() => document.querySelector('.mm-pop').classList.contains('mm-open')));
    await ppt.keyboard.press('Escape'); await ppt.waitForTimeout(40);

    await cpt.close();
  }

  // APPLY: apply.sh bakes --theme + --shortcut into MarkupModeConfig, inlined (no runtime fetch) (T2.5)
  {
    const root = process.cwd();
    const aTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-apply-'));
    const srcHtml = path.join(aTmp, 'src.html');
    const outHtml = path.join(aTmp, 'src.markup.html');
    fs.writeFileSync(srcHtml, '<!DOCTYPE html><html><head><title>Apply Test</title></head><body><h1>hi</h1></body></html>');
    let applyOk = true, applied = '';
    try {
      execFileSync('bash', [path.join(root,'scripts/apply.sh'), srcHtml, '--theme', path.join(root,'themes/paper.json'), '--shortcut', 'mod+shift+j', '--out', outHtml], { stdio: 'pipe' });
      applied = fs.readFileSync(outHtml, 'utf8');
    } catch (e) { applyOk = false; applied = (e.stdout?e.stdout.toString():'')+(e.stderr?e.stderr.toString():''); }
    check('APPLY1 apply.sh --theme/--shortcut runs to success', applyOk);
    check('APPLY2 generated config carries a baked theme block', /MarkupModeConfig\s*=\s*\{[\s\S]*"theme":\s*\{/.test(applied));
    check('APPLY2 baked theme inlines the paper accent (#8a6d3b)', /"accent"\s*:\s*"#8a6d3b"/.test(applied));
    check('APPLY3 generated config carries the j toggle shortcut (mod+shift)', /"shortcut":\s*\{[^}]*"key":\s*"j"/.test(applied) && /"shortcut":\s*\{[^}]*"mod":\s*true/.test(applied) && /"shortcut":\s*\{[^}]*"shift":\s*true/.test(applied));
    if (applyOk) {
      const cgen = await browser.newContext(); const pgen = await cgen.newPage();
      await pgen.goto('file://' + outHtml);
      await pgen.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
      await pgen.reload(); await pgen.waitForTimeout(120);
      check('APPLY4 opening the baked artifact applies the paper accent to --mm-accent', await pgen.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mm-accent').trim().toLowerCase() === '#8a6d3b'));
      check('APPLY4 baked typeface applies to the chrome (Georgia)', await pgen.evaluate(() => getComputedStyle(document.querySelector('.mm-panel')).fontFamily.indexOf('Georgia') >= 0));
      await cgen.close();
    } else { check('APPLY4 (skipped — apply.sh failed; see APPLY1 output)', false); }
    try { fs.rmSync(aTmp, { recursive: true, force: true }); } catch(e) {}
  }

  // HOSTGUARD: apply.sh refuses client-rendered app shells (Databricks/SPA) by default with an
  // explanation, proceeds under --force, and does NOT false-flag a normal static document.
  {
    const root = process.cwd();
    const gTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-guard-'));
    const applier = path.join(root, 'scripts/apply.sh');
    // returns { code, out } where code is the process exit status (0 on success)
    const tryApply = (args) => { try { const out = execFileSync('bash', [applier, ...args], { cwd: gTmp, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }); return { code: 0, out }; }
      catch (e) { return { code: e.status==null?1:e.status, out: (e.stdout||'')+(e.stderr||'') }; } };

    // 1) Databricks-shaped shell → refused, exit 3, with guidance; no output written.
    const dbx = path.join(gTmp, 'notebook.html');
    fs.writeFileSync(dbx, '<!DOCTYPE html><html><head><meta name="databricks-html-version" content="1"><title>nb</title><script>var __DATABRICKS_NOTEBOOK_MODEL=\'eyJ4IjoxfQ==\';</script></head><body>  <script src="https://cdn.example/notebook-main.js"></script></body></html>');
    const r1 = tryApply([dbx, '--out', gTmp]);
    check('HOSTGUARD Databricks export is refused (non-zero exit)', r1.code === 3);
    check('HOSTGUARD refusal names the host type + suggests a fix', /Databricks notebook export/.test(r1.out) && /Save Page As|export the source as Markdown/.test(r1.out));
    check('HOSTGUARD refusal writes no output file', !fs.existsSync(path.join(gTmp, 'notebook.markup.html')));

    // 2) --force overrides → applies + self-check passes.
    const r2 = tryApply([dbx, '--out', gTmp, '--force']);
    check('HOSTGUARD --force overrides the refusal and applies', r2.code === 0 && /OK — apply \+ static self-check passed/.test(r2.out));

    // 3) Generic SPA shell (root mount + external bundle, no prose) → refused.
    const spa = path.join(gTmp, 'spa.html');
    fs.writeFileSync(spa, '<!DOCTYPE html><html><head><title>app</title></head><body><div id="root"></div><script src="https://cdn.example/bundle.js"></script></body></html>');
    const r3 = tryApply([spa, '--out', gTmp]);
    check('HOSTGUARD generic client-rendered shell is refused', r3.code === 3 && /client-rendered app shell/.test(r3.out));

    // 4) Normal static document → NOT flagged (no false positive).
    const stat = path.join(gTmp, 'static.html');
    fs.writeFileSync(stat, '<!DOCTYPE html><html><head><title>Doc</title></head><body><h1>Report</h1><p>'+ 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. '.repeat(6) +'</p></body></html>');
    const r4 = tryApply([stat, '--out', gTmp]);
    check('HOSTGUARD static document is not false-flagged (applies)', r4.code === 0 && /OK — apply \+ static self-check passed/.test(r4.out));

    try { fs.rmSync(gTmp, { recursive: true, force: true }); } catch(e) {}
  }

  // CFG: the pre-build settings file (markup-mode.config.jsonc) governs every apply.
  //   config.sh validates + writes; apply.sh reads it as the default source for
  //   accent/shortcut/keymap/behavior; an explicit flag overrides it per key;
  //   --no-config ignores it. Behavior keys seed runtime prefs on first open.
  {
    const root = process.cwd();
    const cTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-cfg-'));
    const cfgFile = path.join(cTmp, 'mm.config.jsonc');
    const srcHtml = path.join(cTmp, 'doc.html');
    fs.writeFileSync(srcHtml, '<!DOCTYPE html><html><head><title>Cfg Test</title></head><body><h1>hi</h1></body></html>');
    fs.copyFileSync(path.join(root, 'markup-mode.config.jsonc'), cfgFile);
    const configSh = path.join(root, 'scripts', 'config.sh');
    const setKey = (k, v) => execFileSync('bash', [configSh, 'set', k, v], { env: { ...process.env, MARKUP_MODE_CONFIG: cfgFile }, stdio: 'pipe', encoding: 'utf8' });
    const apply = (extra, outName) => { const out = path.join(cTmp, outName || 'out.html'); execFileSync('bash', [path.join(root,'scripts/apply.sh'), srcHtml, '--config', cfgFile, '--out', out, ...extra], { stdio: 'pipe' }); return fs.readFileSync(out, 'utf8'); };
    // Extract just the baked `window.MarkupModeConfig = { … };` object body. The
    // settings panel now ships a static config EXAMPLE (with "accent": "#6366f1") in
    // its build-time help block, so scanning the whole artifact would false-match;
    // assertions about the baked config must look only at the config script itself.
    const mmCfgOf = (html) => { const m = html.match(/window\.MarkupModeConfig\s*=\s*\{([\s\S]*?)\};/); return m ? m[1] : ''; };

    // CFG0: a fresh (effectively empty) config file → today's defaults (no accent/theme baked)
    let baseOk = true, baseHtml = '';
    try { baseHtml = apply([]); } catch (e) { baseOk = false; }
    check('CFG0 apply with the shipped (empty) config runs to success', baseOk);
    check('CFG0 empty config bakes no accent (defaults preserved)', baseOk && !/"accent"\s*:/.test(mmCfgOf(baseHtml)));

    // CFG1: config.sh set validates + writes (comment header preserved across writes)
    let setOk = true;
    try { setKey('accent', '#3b82f6'); setKey('shortcut', 'mod+shift+j'); setKey('keymap.addRef.mod', 'shift'); setKey('behavior.themeMode', 'dark'); }
    catch (e) { setOk = false; }
    check('CFG1 config.sh set writes accent/shortcut/keymap/behavior', setOk);
    const cfgText = fs.readFileSync(cfgFile, 'utf8');
    check('CFG1 config.sh preserves the annotated comment header across set', /Markup Mode — pre-build settings surface/.test(cfgText) && /^\s*\/\//m.test(cfgText));
    // CFG1b: invalid value is rejected with no write (strict on set)
    let badRejected = false;
    try { setKey('keymap.addRef.mod', 'hyper'); } catch (e) { badRejected = (e.status === 2); }
    check('CFG1b config.sh set rejects an invalid enum value (exit 2, no write)', badRejected);
    check('CFG1b rejected set did not corrupt the file (addRef.mod still shift)', /"mod":\s*"shift"/.test(fs.readFileSync(cfgFile, 'utf8')));

    // CFG2: apply.sh bakes the config values into MarkupModeConfig
    let cfgHtml = '', cfgApplyOk = true;
    try { cfgHtml = apply([]); } catch (e) { cfgApplyOk = false; }
    check('CFG2 apply reads config: accent #3b82f6 baked', cfgApplyOk && /"accent"\s*:\s*"#3b82f6"/.test(mmCfgOf(cfgHtml)));
    check('CFG2 apply reads config: j toggle shortcut baked', /"shortcut":\s*\{[^}]*"key":\s*"j"/.test(mmCfgOf(cfgHtml)));
    check('CFG2 apply reads config: keymap.addRef.mod=shift baked', /"keymap":\s*\{[\s\S]*"addRef":\s*\{[^}]*"mod":\s*"shift"/.test(mmCfgOf(cfgHtml)));
    check('CFG2 apply reads config: behavior seeds prefs.themeMode=dark', /"prefs":\s*\{[^}]*"themeMode":\s*"dark"/.test(mmCfgOf(cfgHtml)));

    // CFG3: an explicit flag overrides the config file per key (distinct out file
    // so it does not clobber the config-only out.html that CFG6 reopens)
    let ovHtml = '';
    try { ovHtml = apply(['--accent', '#ff0000'], 'override.html'); } catch (e) {}
    check('CFG3 --accent flag overrides config accent (top-level)', /"accent"\s*:\s*"#ff0000"/.test(mmCfgOf(ovHtml)) && !/"accent"\s*:\s*"#3b82f6"/.test(mmCfgOf(ovHtml)));

    // CFG4: --no-config ignores the file (defaults + flags only)
    let ncHtml = '', ncOk = true;
    try { const out = path.join(cTmp, 'nc.html'); execFileSync('bash', [path.join(root,'scripts/apply.sh'), srcHtml, '--config', cfgFile, '--no-config', '--out', out], { stdio: 'pipe' }); ncHtml = fs.readFileSync(out, 'utf8'); } catch (e) { ncOk = false; }
    check('CFG4 --no-config ignores the settings file (no baked accent)', ncOk && !/"accent"\s*:\s*"#3b82f6"/.test(mmCfgOf(ncHtml)));

    // CFG5: malformed config is loud-but-non-fatal — apply still succeeds, falls back to defaults
    const badCfg = path.join(cTmp, 'bad.jsonc');
    fs.writeFileSync(badCfg, '// header\n{ "accent": "#fff" "bg": "#000" }\n');
    let badApplyOk = true, badStderr = '';
    try { const out = path.join(cTmp, 'bad.html'); execFileSync('bash', [path.join(root,'scripts/apply.sh'), srcHtml, '--config', badCfg, '--out', out], { stdio: 'pipe' }); } catch (e) { badApplyOk = false; badStderr = (e.stderr?e.stderr.toString():''); }
    check('CFG5 malformed config does not crash apply (loud-but-non-fatal)', badApplyOk);

    // CFG6: the behavior seed actually applies at runtime (themeMode dark → mm-theme-dark on <html>)
    if (cfgApplyOk) {
      const out = path.join(cTmp, 'out.html');
      const cc = await browser.newContext(); const pc = await cc.newPage();
      await pc.goto('file://' + out);
      await pc.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
      await pc.reload(); await pc.waitForTimeout(120);
      check('CFG6 baked config accent applies to --mm-accent at runtime', await pc.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mm-accent').trim().toLowerCase() === '#3b82f6'));
      check('CFG6 behavior seed applies themeMode dark (html.mm-theme-dark)', await pc.evaluate(() => document.documentElement.classList.contains('mm-theme-dark')));
      await cc.close();
    } else { check('CFG6 (skipped — config apply failed)', false); }

    try { fs.rmSync(cTmp, { recursive: true, force: true }); } catch(e) {}
  }

  // THM: theme config surface covers typeface + font scale + ink/focus/danger (T2.3)
  {
    const cth = await browser.newContext();
    await cth.addInitScript(() => { window.MarkupModeConfig = { theme: { font: 'Georgia, serif', accent: '#3b82f6', accentInk: '#1e40af', focus: '#1e40af', danger: '#b91c1c', fontScale: 1.15 } }; });
    const pth = await cth.newPage();
    await pth.goto(`http://127.0.0.1:${PORT}/index.html`);
    await pth.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pth.reload(); await pth.waitForTimeout(120);
    check('THM1 --mm-font set from theme.font', await pth.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mm-font').indexOf('Georgia') >= 0));
    check('THM1 .mm-ui chrome resolves to Georgia', await pth.evaluate(() => getComputedStyle(document.querySelector('.mm-panel')).fontFamily.indexOf('Georgia') >= 0));
    check('THM2 --mm-accent applied from theme.accent', await pth.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mm-accent').trim() === '#3b82f6'));
    check('THM2 --mm-accent-ink / --mm-focus / --mm-danger applied', await pth.evaluate(() => { const cs=getComputedStyle(document.documentElement); return cs.getPropertyValue('--mm-accent-ink').trim()==='#1e40af' && cs.getPropertyValue('--mm-focus').trim()==='#1e40af' && cs.getPropertyValue('--mm-danger').trim()==='#b91c1c'; }));
    check('THM3 --mm-fs-base scaled by fontScale (~12.5*1.15)', await pth.evaluate(() => Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mm-fs-base')) - 12.5*1.15) < 0.25));
    check('THM3 compiled box stays monospace despite theme.font', await pth.evaluate(() => /mono|fira/i.test(getComputedStyle(document.querySelector('.mm-compiled')).fontFamily)));
    await cth.close();
  }
  // THM4: absent config ⇒ defaults unchanged
  {
    const cth2 = await browser.newContext();
    const pth2 = await cth2.newPage();
    await pth2.goto(`http://127.0.0.1:${PORT}/index.html`);
    await pth2.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pth2.reload(); await pth2.waitForTimeout(120);
    check('THM4 no config → --mm-fs-base stays 12.5px', await pth2.evaluate(() => Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mm-fs-base')) - 12.5) < 0.25));
    check('THM4 no config → chrome falls back to system sans (no Georgia)', await pth2.evaluate(() => getComputedStyle(document.querySelector('.mm-panel')).fontFamily.indexOf('Georgia') < 0));
    await cth2.close();
  }

  // APP: Appearance pane — reduce-motion, light/dark/auto seg, accent override + live contrast (T2.4)
  {
    const cap = await browser.newContext();
    const pap = await cap.newPage();
    await pap.goto(`http://127.0.0.1:${PORT}/index.html`);
    await pap.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pap.reload(); await pap.waitForTimeout(120);
    check('APP0 header sun/moon theme button removed (D6)', await pap.evaluate(() => !document.querySelector('.mm-themebtn')));
    await pap.click('.mm-gearbtn'); await pap.waitForTimeout(40);
    // reduce motion
    check('APP1 reduce-motion control is a role=switch', await pap.evaluate(() => document.querySelector('.mm-reducemotion').getAttribute('role')==='switch'));
    await pap.click('.mm-reducemotion'); await pap.waitForTimeout(40);
    check('APP1 reduce-motion sets :root class + aria-checked', await pap.evaluate(() => document.documentElement.classList.contains('mm-reduce-motion') && document.querySelector('.mm-reducemotion').getAttribute('aria-checked')==='true'));
    check('APP1 reduce-motion persists to :prefs', await pap.evaluate(() => JSON.parse(localStorage.getItem('markup-mode:index.html:prefs')||'{}').reduceMotion===true));
    // theme mode seg
    check('APP2 theme seg defaults to Auto', await pap.evaluate(() => document.querySelector('.mm-themeseg .mm-segbtn[data-mode="auto"]').getAttribute('aria-checked')==='true'));
    await pap.click('.mm-themeseg .mm-segbtn[data-mode="dark"]'); await pap.waitForTimeout(50);
    check('APP2 picking Dark applies dark palette + persists mode', await pap.evaluate(() => { const d=JSON.parse(localStorage.getItem('markup-mode:index.html:dock')||'{}'); return d.theme && d.theme.mode==='dark' && document.documentElement.classList.contains('mm-theme-dark'); }));
    await pap.click('.mm-themeseg .mm-segbtn[data-mode="light"]'); await pap.waitForTimeout(50);
    check('APP2 picking Light applies light palette + persists', await pap.evaluate(() => { const d=JSON.parse(localStorage.getItem('markup-mode:index.html:dock')||'{}'); return d.theme.mode==='light' && document.documentElement.classList.contains('mm-theme-light'); }));
    // accent override — known-good dark teal: derives soft/ink, contrast passes
    await pap.evaluate(() => { const i=document.querySelector('.mm-accentinput'); i.value='#0f766e'; i.dispatchEvent(new Event('input',{bubbles:true})); }); await pap.waitForTimeout(50);
    check('APP3 accent override sets --mm-accent + derives soft (rgba) + ink', await pap.evaluate(() => { const cs=getComputedStyle(document.documentElement); return cs.getPropertyValue('--mm-accent').trim().toLowerCase()==='#0f766e' && /rgba?\(/.test(cs.getPropertyValue('--mm-accent-soft')) && cs.getPropertyValue('--mm-accent-ink').trim()!==''; }));
    check('APP3 good accent passes the live contrast check (no warning)', await pap.evaluate(() => { const c=document.querySelector('.mm-contrast'); return !c.classList.contains('mm-contrast-warn') && /AA|✓/.test(c.textContent); }));
    // known-bad — very light yellow: low-contrast ink → warning raised
    await pap.evaluate(() => { const i=document.querySelector('.mm-accentinput'); i.value='#fff7cc'; i.dispatchEvent(new Event('input',{bubbles:true})); }); await pap.waitForTimeout(50);
    check('APP4 low-contrast accent raises a contrast warning', await pap.evaluate(() => document.querySelector('.mm-contrast').classList.contains('mm-contrast-warn')));
    check('APP4 accent Reset clears the override (back to theme default)', await (async () => {
      await pap.click('.mm-accentreset'); await pap.waitForTimeout(40);
      return await pap.evaluate(() => document.documentElement.style.getPropertyValue('--mm-accent')==='');
    })());
    await cap.close();
  }

  // SET: settings slide-over shell — opens over the list in all dock states, back/Esc close + focus round-trip (T2.2)
  {
    const cset = await browser.newContext();
    const pset = await cset.newPage();
    await pset.goto(`http://127.0.0.1:${PORT}/index.html`);
    await pset.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pset.reload(); await pset.waitForTimeout(120);
    const coversList = () => pset.evaluate(() => {
      const s=document.querySelector('.mm-settings'), l=document.querySelector('.mm-list');
      if(!s.classList.contains('mm-open') || getComputedStyle(s).display==='none') return false;
      const sr=s.getBoundingClientRect(), lr=l.getBoundingClientRect();
      return sr.top<=lr.top+1 && sr.left<=lr.left+1 && sr.right>=lr.right-1 && sr.bottom>=lr.bottom-1;
    });
    // float
    await pset.evaluate(() => document.querySelector('.mm-dockbtn-float').click()); await pset.waitForTimeout(40);
    await pset.click('.mm-gearbtn'); await pset.waitForTimeout(40);
    check('SET1 gear opens settings covering the list (float)', await coversList());
    check('SET1 focus moves into settings (back button) on open', await pset.evaluate(() => document.activeElement === document.querySelector('.mm-setback')));
    check('SET1 gear aria-expanded=true when open', await pset.evaluate(() => document.querySelector('.mm-gearbtn').getAttribute('aria-expanded')==='true'));
    await pset.click('.mm-setback'); await pset.waitForTimeout(40);
    check('SET2 back button closes settings', await pset.evaluate(() => !document.querySelector('.mm-settings').classList.contains('mm-open')));
    check('SET2 focus restores to the gear on close', await pset.evaluate(() => document.activeElement === document.querySelector('.mm-gearbtn')));
    // left rail
    await pset.evaluate(() => document.querySelector('.mm-dockbtn-left').click()); await pset.waitForTimeout(40);
    await pset.click('.mm-gearbtn'); await pset.waitForTimeout(40);
    check('SET3 settings covers the list (left rail)', await coversList());
    await pset.keyboard.press('Escape'); await pset.waitForTimeout(40);
    check('SET3 Esc closes settings (left rail)', await pset.evaluate(() => !document.querySelector('.mm-settings').classList.contains('mm-open')));
    // right rail
    await pset.evaluate(() => document.querySelector('.mm-dockbtn-right').click()); await pset.waitForTimeout(40);
    await pset.click('.mm-gearbtn'); await pset.waitForTimeout(40);
    check('SET4 settings covers the list (right rail)', await coversList());
    check('SET4 Appearance + Keys + Behavior sections present', await pset.evaluate(() => { const t=document.querySelector('.mm-settings').textContent; return document.querySelectorAll('.mm-settings .mm-setsection').length>=3 && /Appearance/.test(t) && /Keys/.test(t) && /Behavior/.test(t); }));
    // SET4b: the Keys section tells the reviewer that keys/colors/fonts are baked
    // at build time via the config file, and how to apply it (config.sh / ask agent).
    check('SET4b build-time settings block is present in the panel', await pset.evaluate(() => !!document.querySelector('.mm-settings .mm-setdetails')));
    check('SET4b block names the config file markup-mode.config.jsonc', await pset.evaluate(() => /markup-mode\.config\.jsonc/.test(document.querySelector('.mm-settings').textContent)));
    check('SET4b block names config.sh set as the apply path', await pset.evaluate(() => /config\.sh set/.test(document.querySelector('.mm-settings').textContent)));
    check('SET4b block offers the ask-your-agent path', await pset.evaluate(() => /ask your agent/i.test(document.querySelector('.mm-settings').textContent)));
    check('SET4b block frames it as build-time (before the page is built / regenerate)', await pset.evaluate(() => { const t=document.querySelector('.mm-settings').textContent; return /before the page is built/i.test(t) || /regenerate/i.test(t); }));
    check('SET4b shows a config example (keymap.toggle)', await pset.evaluate(() => { const p=document.querySelector('.mm-settings .mm-setpre'); return !!p && /"keymap"/.test(p.textContent) && /"toggle"/.test(p.textContent); }));
    await pset.keyboard.press('Escape'); await pset.waitForTimeout(40);
    check('SET4 list reachable again after close', await pset.evaluate(() => { const l=document.querySelector('.mm-list'); return l.offsetParent !== null && !document.querySelector('.mm-settings').classList.contains('mm-open'); }));
    await cset.close();
  }

  // RESP/PREF: rail minimize realigns marks; behavior settings persist and act
  {
    const crp = await browser.newContext();
    const prp = await crp.newPage();
    await prp.goto(`http://127.0.0.1:${PORT}/index.html`);
    await prp.evaluate(() => {
      Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k));
      localStorage.setItem('markup-mode:index.html:notes', JSON.stringify([{ id:1, comment:'rail align', ts:Date.now(), anchors:[{ kind:'element', selector:'.card', where:'card', quote:'example' }] }]));
    });
    await prp.reload(); await prp.waitForTimeout(160);
    const aligned = () => prp.evaluate(() => {
      const pin=document.querySelector('.mm-pin[data-id="1"]'), target=document.querySelector('.card');
      const pr=pin.getBoundingClientRect(), tr=target.getBoundingClientRect();
      return Math.abs((pr.left + pr.width/2) - tr.left) < 3 && Math.abs((pr.top + pr.height/2) - tr.top) < 3;
    });
    check('RESP1 seeded rail mark starts aligned to shifted page content', await aligned());
    await prp.setViewportSize({ width:1400, height:1400 }); await prp.waitForTimeout(80);
    const noScrollWheelStable = async () => {
      const before = await prp.evaluate(() => {
        const pin=document.querySelector('.mm-pin[data-id="1"]'), target=document.querySelector('.card');
        const pr=pin.getBoundingClientRect(), tr=target.getBoundingClientRect();
        return { scrollY, dx:Math.round(pr.left+pr.width/2)-Math.round(tr.left), dy:Math.round(pr.top+pr.height/2)-Math.round(tr.top) };
      });
      await prp.mouse.wheel(0, 80); await prp.waitForTimeout(80);
      const after = await prp.evaluate(() => {
        const pin=document.querySelector('.mm-pin[data-id="1"]'), target=document.querySelector('.card');
        const pr=pin.getBoundingClientRect(), tr=target.getBoundingClientRect();
        return { scrollY, dx:Math.round(pr.left+pr.width/2)-Math.round(tr.left), dy:Math.round(pr.top+pr.height/2)-Math.round(tr.top) };
      });
      return before.scrollY === 0 && after.scrollY === 0 && before.dx === after.dx && before.dy === after.dy;
    };
    check('RESP1 no-scroll wheel input keeps mark locked to target', await noScrollWheelStable());
    await prp.click('.mm-close'); await prp.waitForTimeout(120);
    check('RESP1 minimizing right rail clears reserved body margin', await prp.evaluate(() => document.body.style.marginRight === '' && !document.querySelector('.mm-panel').classList.contains('mm-open')));
    check('RESP1 minimizing right rail realigns mark without scroll/resize', await aligned());

    await prp.click('.mm-handle'); await prp.waitForTimeout(60);
    await prp.click('.mm-gearbtn'); await prp.waitForTimeout(40);
    check('PREF1 behavior switches are present', await prp.evaluate(() => !!document.querySelector('.mm-markvis') && !!document.querySelector('.mm-openreveal')));
    const hlBefore = await prp.evaluate(() => !!(window.CSS && CSS.highlights && CSS.highlights.has('mm-note')));
    await prp.click('.mm-markvis'); await prp.waitForTimeout(40);
    check('PREF1 Show marks switch persists false and hides pin', await prp.evaluate(() => {
      const prefs=JSON.parse(localStorage.getItem('markup-mode:index.html:prefs')||'{}');
      return prefs.pinsVisible===false && document.querySelector('.mm-markvis').getAttribute('aria-checked')==='false' && getComputedStyle(document.querySelector('.mm-pin[data-id="1"]')).display==='none';
    }));
    // Hiding marks must also clear TEXT highlights (the underline/fill), not just pins/boxes.
    check('PREF1 hiding marks clears text highlights (mm-note unregistered)', await prp.evaluate(() => !(window.CSS && CSS.highlights && CSS.highlights.has('mm-note'))));
    await prp.click('.mm-markvis'); await prp.waitForTimeout(40);
    check('PREF1 showing marks restores text highlights (round-trip)', await prp.evaluate(h => !!(window.CSS && CSS.highlights && CSS.highlights.has('mm-note')) === h, hlBefore));
    await prp.click('.mm-openreveal'); await prp.waitForTimeout(40);
    await prp.click('.mm-setback'); await prp.waitForTimeout(30);
    await prp.click('.mm-close'); await prp.waitForTimeout(80);
    await prp.click('.mm-pin[data-id="1"]'); await prp.waitForTimeout(260);
    check('PREF2 Open dock on reveal=false keeps dock minimized after pin reveal', await prp.evaluate(() => {
      const prefs=JSON.parse(localStorage.getItem('markup-mode:index.html:prefs')||'{}');
      return prefs.openOnReveal===false && !document.querySelector('.mm-panel').classList.contains('mm-open');
    }));
    await prp.setViewportSize({ width:390, height:760 }); await prp.waitForTimeout(80);
    await prp.click('.mm-handle'); await prp.waitForTimeout(120);
    check('RESP2 compact rail uses full viewport width without reserving body margin', await prp.evaluate(() => {
      const r=document.querySelector('.mm-panel').getBoundingClientRect();
      return Math.round(r.width)===390 && document.body.style.marginLeft==='' && document.body.style.marginRight==='';
    }));
    await crp.close();
  }

  // SEG: sort segmented control mechanics — role=radio, arrow-key nav (focus), Space commits, grip glyph (T2.1)
  {
    const cseg = await browser.newContext();
    const pseg = await cseg.newPage();
    await pseg.goto(`http://127.0.0.1:${PORT}/index.html`);
    await pseg.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pseg.reload(); await pseg.waitForTimeout(120);
    check('SEG1 three radio segments render (role=radio)', await pseg.evaluate(() => document.querySelectorAll('.mm-sort .mm-segbtn[role="radio"]').length === 3));
    check('SEG1 container is a radiogroup', await pseg.evaluate(() => document.querySelector('.mm-sort').getAttribute('role') === 'radiogroup'));
    check('SEG1 Created checked by default', await pseg.evaluate(() => document.querySelector('.mm-sort .mm-segbtn[data-sort="created"]').getAttribute('aria-checked') === 'true'));
    check('SEG2 Manual segment carries the drag-grip glyph', await pseg.evaluate(() => !!document.querySelector('.mm-sort .mm-segbtn[data-sort="manual"] svg')));
    await pseg.evaluate(() => document.querySelector('.mm-sort .mm-segbtn[data-sort="created"]').focus());
    await pseg.keyboard.press('ArrowRight'); await pseg.waitForTimeout(30);
    check('SEG3 ArrowRight moves focus to Position (no commit yet)', await pseg.evaluate(() => document.activeElement === document.querySelector('.mm-sort .mm-segbtn[data-sort="document"]') && JSON.parse(localStorage.getItem('markup-mode:index.html:dock')||'{}').sort !== 'document'));
    await pseg.keyboard.press(' '); await pseg.waitForTimeout(50);
    check('SEG3 Space commits the focused segment (sort=document, checked)', await pseg.evaluate(() => { const d=JSON.parse(localStorage.getItem('markup-mode:index.html:dock')||'{}'); return d.sort === 'document' && document.querySelector('.mm-sort .mm-segbtn[data-sort="document"]').getAttribute('aria-checked')==='true'; }));
    await cseg.close();
  }

  // SORT: display-ordinal sort control — Created (default) / Document order / Manual, decoupled from stable id (fresh context)
  {
    const URL = `http://127.0.0.1:${PORT}/index.html`;
    const cso = await browser.newContext();
    const pso = await cso.newPage();
    await pso.goto(URL);
    await pso.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pso.reload(); await pso.waitForTimeout(120);

    const ns = await pso.evaluate(() => 'markup-mode:' + (location.pathname.split('/').pop()));
    const numFor = async (id) => pso.$eval('.mm-row[data-id="'+id+'"] .mm-num', el => el.textContent);
    const pinTextFor = async (id) => pso.$eval('.mm-overlay .mm-pin[data-id="'+id+'"]', el => el.textContent.trim());
    const pinLabelFor = async (id) => pso.$eval('.mm-overlay .mm-pin[data-id="'+id+'"]', el => el.getAttribute('aria-label') || '');
    const rowOrderIds = () => pso.$$eval('.mm-row', els => els.map(e => +e.dataset.id));

    // seed three notes OUT of document order:
    //   id 1 = 2nd card (lower in DOM), id 2 = 1st card (higher), id 3 = .sub paragraph (top of all)
    await pso.click('.mm-modebtn'); await pso.waitForTimeout(40);
    await pso.click('.cards .card:nth-of-type(2)'); await pso.waitForTimeout(60);
    await pso.fill('.mm-pop textarea', 'note on second card'); await pso.click('.mm-pop .mm-save'); await pso.waitForTimeout(60);
    await pso.click('.cards .card:nth-of-type(1)'); await pso.waitForTimeout(60);
    await pso.fill('.mm-pop textarea', 'note on first card'); await pso.click('.mm-pop .mm-save'); await pso.waitForTimeout(60);
    await pso.evaluate(() => {
      const t = document.querySelector('.sub').firstChild;
      const sel = window.getSelection(); sel.removeAllRanges();
      const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 4); sel.addRange(r);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await pso.waitForTimeout(60);
    await pso.fill('.mm-pop textarea', 'note on sub paragraph'); await pso.click('.mm-pop .mm-save'); await pso.waitForTimeout(60);
    await pso.evaluate(() => { if(document.body.classList.contains('mm-armed')) document.querySelector('.mm-modebtn').click(); });
    await pso.waitForTimeout(40);

    // SORT1: control exists with an aria-label, defaults to Created
    check('SORT1: .mm-sort control present', await pso.$('.mm-sort') !== null);
    check('SORT1: .mm-sort has an aria-label', await pso.evaluate(() => !!document.querySelector('.mm-sort').getAttribute('aria-label')));
    check('SORT1: default sort is Created', await pso.evaluate(() => document.querySelector('.mm-sort .mm-segbtn[aria-checked="true"]').dataset.sort === 'created'));
    check('SORT1: dockState.sort persisted as created', await pso.evaluate((ns) => (JSON.parse(localStorage.getItem(ns+':dock')||'{}').sort) === 'created', ns));

    // SORT2: Created — ordinal == creation order; row nums carry order, on-page marks stay unnumbered
    check('SORT2: Created — row 1 numbered 1', (await numFor(1)) === '1');
    check('SORT2: Created — row 2 numbered 2', (await numFor(2)) === '2');
    check('SORT2: Created — row 3 numbered 3', (await numFor(3)) === '3');
    check('SORT2: Created — on-page mark for id 1 is unnumbered but labeled for assistive tech', (await pinTextFor(1)) === '' && /note 1/.test(await pinLabelFor(1)));
    check('SORT2: Created — dock row order is creation order [1,2,3]', JSON.stringify(await rowOrderIds()) === JSON.stringify([1,2,3]));

    // SORT3: switch to Document order — renumbers top-to-bottom by DOM position
    //   .sub (id 3) is topmost ⇒ 1; first card (id 2) ⇒ 2; second card (id 1) ⇒ 3
    await pso.click('.mm-sort .mm-segbtn[data-sort="document"]'); await pso.waitForTimeout(80);
    check('SORT3: Document — dock rows reorder by DOM position [3,2,1]', JSON.stringify(await rowOrderIds()) === JSON.stringify([3,2,1]));
    check('SORT3: Document — id 3 (.sub, topmost) numbered 1', (await numFor(3)) === '1');
    check('SORT3: Document — id 2 (first card) numbered 2', (await numFor(2)) === '2');
    check('SORT3: Document — id 1 (second card) numbered 3', (await numFor(1)) === '3');
    check('SORT3: Document — on-page mark for id 3 remains visually unnumbered', (await pinTextFor(3)) === '');
    check('SORT3: Document — on-page mark aria-label follows current note ordinal', /note 3/.test(await pinLabelFor(1)));

    // SORT3b: ordinal-coherence — the edit popup header must read the ORDINAL, not the stale id.
    //   id 1 → ordinal 3 (second card); id 2 → ordinal 2 (first card). The hover tooltip is now note-text-only.
    const pinBox1 = await pso.$eval('.mm-overlay .mm-pin[data-id="1"]', el => { const r=el.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; });
    await pso.mouse.move(pinBox1.x, pinBox1.y); await pso.waitForTimeout(80);
    check('SORT3b: hover tooltip for id 1 shows note text only (no "Mark N" node)', await pso.evaluate(() => {
      const t = document.querySelector('.mm-pintip'); return t.classList.contains('mm-show') && !t.querySelector('.mm-pintip-mark') && t.textContent.trim().length > 0;
    }));
    await pso.mouse.move(0, 0); await pso.waitForTimeout(40);
    const pinBox2 = await pso.$eval('.mm-overlay .mm-pin[data-id="2"]', el => { const r=el.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; });
    await pso.mouse.move(pinBox2.x, pinBox2.y); await pso.waitForTimeout(80);
    check('SORT3b: hover tooltip for id 2 also shows note text only (no "Mark N" node)', await pso.evaluate(() => { const t=document.querySelector('.mm-pintip'); return t.classList.contains('mm-show') && !t.querySelector('.mm-pintip-mark'); }));
    await pso.mouse.move(0, 0); await pso.waitForTimeout(40);
    // edit popup header for id 1 must show the ordinal (Editing · Note 3), not the stale id 1
    await pso.dblclick('.mm-row[data-id="1"]'); await pso.waitForTimeout(80);
    check('SORT3b: edit popup header for id 1 reads "Editing · Note 3" (ordinal, not stale id 1)', await pso.evaluate(() => {
      const pm = document.querySelector('.mm-popmode'); const dlg = document.querySelector('.mm-pop');
      return pm.textContent === 'Editing · Note 3' && /Editing · Note 3/.test(dlg.getAttribute('aria-label') || '');
    }));
    await pso.keyboard.press('Escape'); await pso.waitForTimeout(40);
    await pso.evaluate(() => { if(document.body.classList.contains('mm-armed')) document.querySelector('.mm-modebtn').click(); });
    await pso.waitForTimeout(40);

    // SORT4: compile() emits notes in active (document) order with matching numbers
    const compiledDoc = await pso.evaluate(() => {
      document.querySelector('.mm-compile').click();
      const v = document.querySelector('.mm-compiled').value;
      document.querySelector('.mm-compile').click();
      return v;
    });
    check('SORT4: compile — first heading is "## Note 1 · text" (the .sub note)', /## Note 1 · text/.test(compiledDoc));
    check('SORT4: compile — note order matches document order (sub, then first card, then second card)', (() => {
      const i1 = compiledDoc.indexOf('note on sub paragraph');
      const i2 = compiledDoc.indexOf('note on first card');
      const i3 = compiledDoc.indexOf('note on second card');
      return i1 >= 0 && i2 > i1 && i3 > i2;
    })());
    check('SORT4: compile — headings numbered 1,2,3 in active order', (() => {
      const heads = (compiledDoc.match(/## Note \d+/g) || []).map(s => s.replace('## Note ',''));
      return JSON.stringify(heads) === JSON.stringify(['1','2','3']);
    })());

    // SORT5: stable id preserved — serialization is still keyed by id (not renumbered)
    check('SORT5: serialized note ids stay [1,2,3] regardless of sort', await pso.evaluate((ns) => {
      const arr = JSON.parse(localStorage.getItem(ns+':notes')||'[]');
      return JSON.stringify(arr.map(n => n.id).sort((a,b)=>a-b)) === JSON.stringify([1,2,3]);
    }, ns));
    check('SORT5: dataset.id on rows stays the stable id (set still {1,2,3})', await pso.evaluate(() => {
      const ids = Array.from(document.querySelectorAll('.mm-row')).map(r => +r.dataset.id).sort((a,b)=>a-b);
      return JSON.stringify(ids) === JSON.stringify([1,2,3]);
    }));

    // SORT6: chosen mode persists across reload (applied on mount)
    await pso.reload(); await pso.waitForTimeout(150);
    check('SORT6: sort=document persisted in dockState after reload', await pso.evaluate((ns) => (JSON.parse(localStorage.getItem(ns+':dock')||'{}').sort) === 'document', ns));
    check('SORT6: control reflects persisted document mode after reload', await pso.evaluate(() => document.querySelector('.mm-sort .mm-segbtn[aria-checked="true"]').dataset.sort === 'document'));
    check('SORT6: dock rows still in document order [3,2,1] after reload', JSON.stringify(await rowOrderIds()) === JSON.stringify([3,2,1]));

    // SORT7: Manual drag — switch to Manual (seeds from current shown order [3,2,1]), drag last row to top, verify reorder+renumber+persist
    await pso.click('.mm-sort .mm-segbtn[data-sort="manual"]'); await pso.waitForTimeout(80);
    check('SORT7: Manual seeds order from current view [3,2,1]', await pso.evaluate((ns) => JSON.stringify(JSON.parse(localStorage.getItem(ns+':dock')||'{}').manualOrder) === JSON.stringify([3,2,1]), ns));
    check('SORT7: Manual — drag grips become visible (list has mm-manual class)', await pso.evaluate(() => document.querySelector('.mm-list').classList.contains('mm-manual')));
    // drag the grip of the LAST row (id 1, currently ordinal 3) above the FIRST row (id 3)
    const gripBox = await pso.$eval('.mm-row[data-id="1"] .mm-rgrip', el => { const r=el.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; });
    const topRowBox = await pso.$eval('.mm-row[data-id="3"]', el => { const r=el.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top + 3}; });
    await pso.mouse.move(gripBox.x, gripBox.y);
    await pso.mouse.down();
    await pso.mouse.move(topRowBox.x, topRowBox.y - 6, { steps: 6 });
    await pso.mouse.up();
    await pso.waitForTimeout(80);
    check('SORT7: Manual drag moved id 1 to the top [1,3,2]', JSON.stringify(await rowOrderIds()) === JSON.stringify([1,3,2]));
    check('SORT7: Manual — dragged row renumbered to 1', (await numFor(1)) === '1');
    check('SORT7: Manual — on-page mark for id 1 stays unnumbered after reorder', (await pinTextFor(1)) === '');
    check('SORT7: Manual order persisted [1,3,2]', await pso.evaluate((ns) => JSON.stringify(JSON.parse(localStorage.getItem(ns+':dock')||'{}').manualOrder) === JSON.stringify([1,3,2]), ns));

    // SORT8: Manual order survives reload + undo of a delete is still keyed by stable id
    await pso.reload(); await pso.waitForTimeout(150);
    check('SORT8: Manual order [1,3,2] persists across reload', JSON.stringify(await rowOrderIds()) === JSON.stringify([1,3,2]));
    // delete id 3 (middle), then Undo — undo restores by id, manualOrder re-includes it
    await pso.click('.mm-row[data-id="3"] .mm-rdel'); await pso.waitForTimeout(60);
    check('SORT8: after deleting id 3, rows are [1,2]', JSON.stringify(await rowOrderIds()) === JSON.stringify([1,2]));
    await pso.click('.mm-toastbtn'); await pso.waitForTimeout(80);
    check('SORT8: Undo restores id 3 (undo keyed by stable id)', await pso.evaluate(() => !!document.querySelector('.mm-row[data-id="3"]')));
    check('SORT8: serialized ids back to full set {1,2,3} after undo', await pso.evaluate((ns) => {
      const arr = JSON.parse(localStorage.getItem(ns+':notes')||'[]');
      return JSON.stringify(arr.map(n => n.id).sort((a,b)=>a-b)) === JSON.stringify([1,2,3]);
    }, ns));

    await cso.close();
  }

  // VOCAB: new "mark"/"Markup" terminology is wired into the visible surface (rename guard)
  {
    const cv = await browser.newContext(); const pv = await cv.newPage();
    const uv = `http://127.0.0.1:${PORT}/index.html`;
    await pv.goto(uv);
    await pv.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('markup-mode')).forEach(k => localStorage.removeItem(k)));
    await pv.reload(); await pv.waitForTimeout(150);
    // default right-rail: panel is open
    check('VOCAB: dock title reads "Markup Mode"', await pv.evaluate(() => document.querySelector('.mm-title').textContent.trim() === 'Markup Mode'));
    check('VOCAB: panel region aria-label is "Markup"', await pv.evaluate(() => document.querySelector('.mm-panel').getAttribute('aria-label') === 'Markup'));
    check('VOCAB: marks visibility lives in Settings ("Show marks" switch), not a header toggle', await pv.evaluate(() => !document.querySelector('.mm-pins') && document.querySelector('.mm-markvis') && document.querySelector('.mm-markvis').getAttribute('aria-label') === 'Show marks'));
    // seed a note + hover its pin → tooltip mark label uses "Mark N"
    await pv.click('.mm-modebtn'); await pv.waitForTimeout(40);
    await pv.evaluate(() => {
      const p = document.querySelector('.sub'); const t = p.firstChild;
      const sel = window.getSelection(); sel.removeAllRanges();
      const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 4);
      sel.addRange(r);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await pv.waitForTimeout(60);
    await pv.fill('.mm-pop textarea', 'vocab mark note'); await pv.click('.mm-pop .mm-save'); await pv.waitForTimeout(60);
    await pv.evaluate(() => { if (document.body.classList.contains('mm-armed')) document.querySelector('.mm-modebtn').click(); });
    await pv.waitForTimeout(40);
    check('VOCAB: collapsed-pill count uses "Markup · N"', await pv.evaluate(() => /^Markup · 1$/.test(document.querySelector('.mm-handle .mm-count').textContent.trim())));
    const pinBoxV = await pv.$eval('.mm-overlay .mm-pin', el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; });
    await pv.mouse.move(pinBoxV.x, pinBoxV.y); await pv.waitForTimeout(80);
    check('VOCAB: on-page mark tooltip shows the note text only (no Mark/hint)', await pv.evaluate(() => { const t=document.querySelector('.mm-pintip'); return t.classList.contains('mm-show') && t.textContent.trim() === 'vocab mark note' && !t.querySelector('.mm-pintip-mark') && !t.querySelector('.mm-pintip-hint'); }));
    await cv.close();
  }

  // KM: keymap engine + precedence (built-in < MarkupModeConfig < localStorage prefs)
  {
    const URL = `http://127.0.0.1:${PORT}/index.html`;
    // KM1: default toggle (Ctrl/Cmd+Shift+K) arms mode
    const cKM = await browser.newContext(); const pKM = await cKM.newPage();
    await pKM.goto(URL);
    await pKM.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pKM.reload(); await pKM.waitForTimeout(120);
    await pKM.keyboard.press('Control+Shift+KeyK'); await pKM.waitForTimeout(60);
    check('KM1 default Ctrl+Shift+K arms mode', await pKM.evaluate(() => document.body.classList.contains('mm-armed')));
    await cKM.close();

    // KM2: author override via MarkupModeConfig.shortcut (set before scripts run)
    const cKM2 = await browser.newContext(); const pKM2 = await cKM2.newPage();
    await pKM2.addInitScript(() => { window.MarkupModeConfig = { shortcut: { key:'j', mod:true, shift:true } }; });
    await pKM2.goto(URL);
    await pKM2.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pKM2.reload(); await pKM2.waitForTimeout(120);
    await pKM2.keyboard.press('Control+Shift+KeyK'); await pKM2.waitForTimeout(40);
    check('KM2 config override: old default does NOT arm', !(await pKM2.evaluate(() => document.body.classList.contains('mm-armed'))));
    await pKM2.keyboard.press('Control+Shift+KeyJ'); await pKM2.waitForTimeout(60);
    check('KM2 config override: Ctrl+Shift+J arms', await pKM2.evaluate(() => document.body.classList.contains('mm-armed')));
    await cKM2.close();

    // KM3: user prefs (localStorage) win over config
    const cKM3 = await browser.newContext(); const pKM3 = await cKM3.newPage();
    await pKM3.addInitScript(() => { window.MarkupModeConfig = { shortcut: { key:'j', mod:true, shift:true } }; });
    await pKM3.goto(URL);
    await pKM3.evaluate(() => {
      Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k));
      const ns = 'markup-mode:index.html';
      localStorage.setItem(ns+':prefs', JSON.stringify({ keymap: { toggle: { key:'m', mod:true, shift:true } } }));
    });
    await pKM3.reload(); await pKM3.waitForTimeout(120);
    await pKM3.keyboard.press('Control+Shift+KeyJ'); await pKM3.waitForTimeout(40);
    check('KM3 user override: config chord does NOT arm', !(await pKM3.evaluate(() => document.body.classList.contains('mm-armed'))));
    await pKM3.keyboard.press('Control+Shift+KeyM'); await pKM3.waitForTimeout(60);
    check('KM3 user override: Ctrl+Shift+M arms (prefs win)', await pKM3.evaluate(() => document.body.classList.contains('mm-armed')));
    await cKM3.close();

    // KM4: resize still routes through keymap default (ArrowUp selects parent)
    const cKM4 = await browser.newContext(); const pKM4 = await cKM4.newPage();
    await pKM4.goto(URL);
    await pKM4.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pKM4.reload(); await pKM4.waitForTimeout(120);
    await pKM4.evaluate(() => document.querySelector('.mm-modebtn') && document.querySelector('.mm-modebtn').click());
    await pKM4.waitForTimeout(40);
    await pKM4.hover('.card h3').catch(()=>{});
    await pKM4.evaluate(() => { const h = document.querySelector('.card h3'); if (h) h.dispatchEvent(new MouseEvent('mousemove', { bubbles:true })); });
    await pKM4.waitForTimeout(30);
    const beforeTag = await pKM4.evaluate(() => (window.getSelection&&'') || document.querySelector('.card h3') ? 'ok' : 'ok');
    await pKM4.keyboard.press('ArrowUp'); await pKM4.waitForTimeout(40);
    check('KM4 ArrowUp resize still wired (no error, mode still armed)', await pKM4.evaluate(() => document.body.classList.contains('mm-armed')));
    await cKM4.close();
  }

  // MD-ESC: control chars in note content don't corrupt the compiled Markdown
  {
    const cEsc = await browser.newContext();
    const pEsc = await cEsc.newPage();
    await pEsc.goto(`http://127.0.0.1:${PORT}/index.html`);
    await pEsc.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('markup-mode')).forEach(k=>localStorage.removeItem(k)));
    await pEsc.reload(); await pEsc.waitForTimeout(120);
    // Seed a note using the CURRENT anchors-array schema so compile() renders it.
    // quote and comment both contain Markdown structural chars: backtick, asterisk, underscore.
    await pEsc.evaluate(() => {
      const notes = [{
        id: 1,
        comment: 'see `x` and *y*',
        ts: Date.now(),
        anchors: [{
          kind: 'element',
          selector: 'h1',
          where: 'x',
          quote: 'a `code` _x_ * star "q"',
          desc: '',
        }]
      }];
      localStorage.setItem('markup-mode:index.html:notes', JSON.stringify(notes));
    });
    await pEsc.reload(); await pEsc.waitForTimeout(120);
    // ensure panel is open (default right-rail has it open)
    await pEsc.evaluate(() => { if(!document.querySelector('.mm-panel').classList.contains('mm-open')) document.querySelector('.mm-handle').click(); });
    await pEsc.click('.mm-compile'); await pEsc.waitForTimeout(40);
    const escOut = await pEsc.inputValue('.mm-compiled');

    // The Quote value must NOT contain a bare unescaped backtick sequence "`code`"
    // and must NOT contain bare "_x_" (unescaped emphasis run) in the Quote line.
    // After mdEsc, the expected forms are "\`code\`" and "\_x\_".
    const quoteLine = escOut.split('\n').find(l => l.startsWith('Quote:')) || '';
    check('MD-ESC: Quote line present in output', quoteLine.length > 0);
    check('MD-ESC: Quote does not contain bare unescaped backtick run `code`',
      !quoteLine.includes('`code`'));
    check('MD-ESC: Quote does not contain bare unescaped emphasis run _x_',
      !quoteLine.includes('_x_'));

    // Comment block must NOT contain bare `x` or *y* inside blockquote lines
    const commentLines = escOut.split('\n').filter(l => l.startsWith('> '));
    const commentText = commentLines.join('\n');
    check('MD-ESC: Comment does not contain bare backtick run `x`',
      !commentText.includes('`x`'));
    check('MD-ESC: Comment does not contain bare asterisk emphasis *y*',
      !commentText.includes('*y*'));

    await cEsc.close();
  }

  // ---- PINPOS: multi-line text mark anchors at the START of the text, not the union top-left ----
  // Regression for the "mark snaps to the paragraph's left margin" bug. A text selection that
  // begins mid-line and wraps across lines must place its pin at range.getClientRects()[0]
  // (where the text starts), not getBoundingClientRect() (the union box, whose left edge is the
  // wrapped block's left margin). anchorPin() handles this for text anchors only.
  {
    const cPin = await browser.newContext(); const pPin = await cPin.newPage();
    await pPin.goto(`http://127.0.0.1:${PORT}/index.html`); await pPin.waitForTimeout(120);
    await pPin.click('.mm-modebtn'); await pPin.waitForTimeout(50);
    await pPin.evaluate(() => {
      const p = document.querySelector('.sub'); const t = p.firstChild;
      const sel = window.getSelection(); sel.removeAllRanges();
      const r = document.createRange(); r.setStart(t, 40); r.setEnd(t, Math.min(150, t.length));
      sel.addRange(r);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await pPin.waitForTimeout(60);
    await pPin.fill('.mm-pop textarea', 'multi-line text note'); await pPin.click('.mm-pop .mm-save');
    await pPin.waitForTimeout(60);
    const pinPos = await pPin.evaluate(() => {
      const note = JSON.parse(localStorage.getItem('markup-mode:index.html:notes')||'[]')[0];
      const pin = document.querySelector('.mm-overlay .mm-pin[data-id="1"]');
      if (!note || !pin) return null;
      const a = note.anchors[0];
      const root = (a.selector && document.querySelector(a.selector)) || document.body;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      let pos = 0, sc, so, ec, eo, n;
      while ((n = w.nextNode())) { const len = n.nodeValue.length;
        if (sc == null && pos + len >= a.startOff) { sc = n; so = a.startOff - pos; }
        if (pos + len >= a.endOff) { ec = n; eo = a.endOff - pos; break; } pos += len; }
      const rg = document.createRange(); rg.setStart(sc, so); rg.setEnd(ec, eo);
      const rl = rg.getClientRects(), u = rg.getBoundingClientRect();
      return { pinLeft: parseInt(pin.style.left, 10), pinTop: parseInt(pin.style.top, 10),
        firstLeft: Math.round(rl[0].left), firstTop: Math.round(rl[0].top),
        unionLeft: Math.round(u.left), lines: rl.length };
    });
    check('PINPOS multi-line text selection wraps (sanity)', !!pinPos && pinPos.lines > 1);
    check('PINPOS pin at text start (first line-rect), not union left', !!pinPos &&
      pinPos.pinLeft === pinPos.firstLeft && pinPos.pinTop === pinPos.firstTop);
    check('PINPOS first-rect left differs from union left (bug would put pin at union left)', !!pinPos &&
      pinPos.firstLeft !== pinPos.unionLeft && pinPos.pinLeft !== pinPos.unionLeft);

    // SALIENCE: 3-tier, bidirectional peek/pin model. Note 1 is the multi-line TEXT note above;
    // add note 2 as an ELEMENT note so the box-tier classes can be checked too.
    await pPin.click('.card'); await pPin.waitForTimeout(60);
    await pPin.fill('.mm-pop textarea', 'second note'); await pPin.click('.mm-pop .mm-save'); await pPin.waitForTimeout(60);
    // PIN note 1 (single-click reveal; 220ms debounce). It becomes the persistent active/selected note.
    await pPin.click('.mm-row[data-id="1"]'); await pPin.waitForTimeout(300);
    const sel = await pPin.evaluate(() => {
      const pin = (id) => document.querySelector('.mm-overlay .mm-pin[data-id="'+id+'"]');
      const op = (id) => { const p=pin(id); return p ? parseFloat(getComputedStyle(p, '::before').opacity) : null; };
      const boxEl = document.querySelector('.mm-overlay .mm-out.mm-out-mark'); // the single element note's box
      const row = (id) => document.querySelector('.mm-row[data-id="'+id+'"]');
      return {
        activeHL: !!(window.CSS && CSS.highlights && CSS.highlights.has('mm-note-active')),
        p1op: op(1), p2op: op(2),
        p1cls: (pin(1)||{}).className||'', p2cls: (pin(2)||{}).className||'',
        boxActive: !!boxEl && /mm-out-active/.test(boxEl.className),
        boxResting: !!boxEl && !/mm-out-active|mm-out-focus/.test(boxEl.className),
        row1: (row(1)||{}).className||'', row2: (row(2)||{}).className||''
      };
    });
    check('SALIENCE active text note registers a separate mm-note-active highlight', sel.activeHL);
    check('SALIENCE pinned mark full opacity, resting mark dimmed', sel.p1op === 1 && sel.p2op !== null && sel.p2op < 1);
    check('SALIENCE pinned pin = mm-pin-active (not mm-pin-focus, which is hover-only)', /mm-pin-active/.test(sel.p1cls) && !/mm-pin-focus/.test(sel.p1cls));
    check('SALIENCE pinned row = mm-row-active', /mm-row-active/.test(sel.row1));
    check('SALIENCE resting element box carries no focus/active tier', sel.boxResting);
    // BIDIRECTIONAL — hover the dock row for note 2: its on-page mark + box light up (peek), note 1 stays pinned.
    await pPin.hover('.mm-row[data-id="2"]'); await pPin.waitForTimeout(120);
    const hov = await pPin.evaluate(() => {
      const pin2 = document.querySelector('.mm-overlay .mm-pin[data-id="2"]');
      const boxEl = document.querySelector('.mm-overlay .mm-out.mm-out-mark');
      return { p2cls: (pin2||{}).className||'', p2op: parseFloat(getComputedStyle(pin2, '::before').opacity),
        boxFocus: !!boxEl && /mm-out-focus/.test(boxEl.className),
        row1: (document.querySelector('.mm-row[data-id="1"]')||{}).className||'',
        hoverHL: !!(window.CSS && CSS.highlights && CSS.highlights.has('mm-note-hover')) };
    });
    check('BIDIR row-hover peeks its mark (mm-pin-focus + full opacity)', /mm-pin-focus/.test(hov.p2cls) && hov.p2op === 1);
    check('BIDIR row-hover peeks its element box (mm-out-focus)', hov.boxFocus);
    check('BIDIR pinned note 1 stays active while note 2 is peeked', /mm-row-active/.test(hov.row1));
    // mark→row direction: hover note 1's pin → its row gets the peek class is moot (it is active);
    // instead hover note 2's pin and confirm its row lights.
    await pPin.hover('.mm-overlay .mm-pin[data-id="2"]'); await pPin.waitForTimeout(120);
    check('BIDIR mark-hover lights the matching dock row (mm-row-focus)', await pPin.evaluate(() =>
      /mm-row-focus/.test((document.querySelector('.mm-row[data-id="2"]')||{}).className||'')));
    await cPin.close();
  }

  check('No uncaught console/page errors', errors.length === 0);
  if (errors.length) console.log('  errors:', errors.slice(0,5));

  await browser.close(); server.close();
  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — ${pass} passed, ${fail} failed` + (fails.length ? `\nFailed: ${fails.join(' | ')}` : ''));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR:', e); server.close(); process.exit(2); });
