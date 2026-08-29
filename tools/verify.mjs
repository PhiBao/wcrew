#!/usr/bin/env node
/**
 * wcrew — verify.mjs
 * Runs engine tests + basic static checks (WebMCP tool surface, file presence).
 * Exit 0 = ship, non-zero = block.
 */
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

let fails = 0;
function check(ok, msg) {
  if (ok) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); fails++; }
}

console.log('[wcrew] verify\n');

// 1) engine tests
console.log('— engine.test.mjs');
const r = spawnSync(process.execPath, ['tools/engine.test.mjs'], { stdio: 'inherit' });
if (r.status !== 0) { console.error('[verify] engine tests failed'); fails++; }

// 2) file presence
console.log('\n— file presence');
const need = [
  'index.html',
  'src/model.js',
  'src/engine.js',
  'src/store.js',
  'src/webmcp.js',
  'src/app.js',
  'package.json',
];
for (const p of need) {
  try { await readFile(p); check(true, p); } catch { check(false, `missing ${p}`); }
}

// 3) package.json sanity
try {
  const pkg = JSON.parse(await readFile('package.json','utf8'));
  check(pkg.name === 'wcrew', 'package.json name === wcrew');
  check(pkg.type === 'module', 'type: module');
  check(!!pkg.scripts?.dev, 'scripts.dev exists');
} catch (e) { check(false, 'package.json parse: '+e.message); }

// 4) WebMCP surface static check: webmcp.js should register exactly 15 tools
try {
  const src = await readFile('src/webmcp.js','utf8');
  const direct = (src.match(/registerTool/g) ?? []).length;
  const viaHelper = (src.match(/await reg\(\{/g) ?? []).length;
  const count = Math.max(direct, viaHelper);
  const EXPECTED_TOOLS = 15;
  check(count >= 8, `webmcp.js tools ≥8 (found ${viaHelper} via reg + ${direct} direct)`);
  check(count === EXPECTED_TOOLS, `webmcp.js registers exactly ${EXPECTED_TOOLS} tools (found ${count})`);
  check(src.includes('document.modelContext'), 'uses document.modelContext');
  check(src.includes('inputSchema'), 'has inputSchema');
  check(src.includes('untrusted'), 'mentions untrusted content handling');
  // ensure we have key tools
  for (const must of ['get_roster','check_compliance','auto_fill','assign_shift','publish_roster']) {
    check(src.includes(`name: '${must}'`), `webmcp has ${must}`);
  }
} catch (e) { check(false, 'webmcp.js check: '+e.message); }

// 5) index.html should load app and mention WebMCP
try {
  const html = await readFile('index.html','utf8');
  check(html.includes('src/app.js') || html.includes('app.js'), 'index.html loads app');
  check(html.includes('modelContext') || html.includes('WebMCP') || html.includes('wcrew'), 'index.html mentions app/WebMCP');
  check(html.includes('15 tools'), 'index.html advertises 15 tools');
} catch (e) { check(false, 'index.html check: '+e.message); }

// 6) README should not ship dummyimage placeholder and should advertise 15 tools
try {
  const readme = await readFile('README.md','utf8');
  check(!readme.includes('dummyimage.com'), 'README has no dummyimage placeholder');
  check(readme.includes('15 structured tools') || readme.includes('15 tools'), 'README advertises 15 tools');
} catch (e) { check(false, 'README check: '+e.message); }

console.log(`\n[wcrew] verify: ${fails ? fails+' check(s) failed' : 'all checks passed'} `);
process.exit(fails ? 1 : 0);
