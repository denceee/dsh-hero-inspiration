/* Real-engine geometry check.
 *
 * `centering.test.js` resolves the grid tracks from the stylesheet; this one goes
 * further and measures the component in an actual browser: it renders the row the
 * way the plugin returns it, in the plugin's own stylesheet, and asserts that the
 * text sits exactly halfway between the two dots with equal gaps on both sides.
 *
 * A browser is required (Chrome or Edge). Without one the check reports SKIP and
 * exits successfully, so `npm test` works on a machine that has none.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const suite = require('./harness.js')
const { Component, render, flush, props, store, blankSession } = suite

const TOTAL = 40

/* Pin the deck so the still shows a known line. */
store.set('dsh-hero-inspiration:v1', JSON.stringify({
  order: Array.from({ length: TOTAL }, (_, i) => i),
  cursor: 0,
  last: -1,
}))
store.set('dsh-hero-inspiration:config:v1', JSON.stringify({ enabled: true, custom: [] }))

const instance = { hooks: [], hooksApi: null, alive: true }
render(Component, props('geometry', blankSession('geometry')), instance)
flush()
if (instance.node === null) throw new Error('the row did not render')

function serialize(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  if (Array.isArray(node)) return node.map(serialize).join('')
  if (typeof node !== 'object') return ''
  const { type, props: p, children } = node
  const attrs = []
  for (const [key, value] of Object.entries(p || {})) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'onClick' || key === 'onChange') continue
    if (key === 'className') attrs.push('class="' + String(value).replace(/"/g, '&quot;') + '"')
    else if (key === 'type') attrs.push('type="' + value + '"')
    else if (key === 'aria-hidden') attrs.push('aria-hidden="true"')
  }
  const open = '<' + type + (attrs.length > 0 ? ' ' + attrs.join(' ') : '') + '>'
  return open + (children || []).map(serialize).join('') + '</' + type + '>'
}

function pluginCss() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8')
  const marker = 'const CSS = ['
  const start = source.indexOf(marker)
  const end = source.indexOf("].join('')", start)
  const parts = []
  for (const line of source.slice(start + marker.length, end).split('\n')) {
    const m = line.match(/^\s*'((?:[^'\\]|\\.)*)',?\s*$/)
    if (m) parts.push(m[1])
  }
  const css = parts.join('')
  if (!css.includes('.dsh-hi{')) throw new Error('could not extract the plugin stylesheet')
  return css
}

function findBrowser() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
  return candidates.find((p) => fs.existsSync(p))
}

const browser = findBrowser()
if (browser === undefined) {
  console.log('SKIP: no Chrome or Edge found; the geometry check needs a browser')
  process.exit(0)
}

const row = serialize(instance.node)
const measured = `
const box = (el) => el.getBoundingClientRect()
const row = document.getElementById('row')
const txt = document.getElementById('txt')
const dots = [...document.querySelectorAll('.dsh-hi-mark')]
const R = box(row), T = box(txt), D = dots.map(box)
const dotMid = (D[0].left + D[0].right + D[D.length - 1].left + D[D.length - 1].right) / 4
const out = {
  rowWidth: R.width,
  textCentreMinusRowCentre: T.left + T.width / 2 - (R.left + R.width / 2),
  textCentreMinusDotsMid: T.left + T.width / 2 - dotMid,
  gapLeft: T.left - D[0].right,
  gapRight: D[D.length - 1].left - T.right,
  dots: D.length,
}
document.title = 'measured'
const pre = document.createElement('pre')
pre.id = 'result'
pre.textContent = JSON.stringify(out)
document.body.appendChild(pre)
`

const page = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#fff}
  :root{
    --dsw-alias-bg-base:#ffffff; --dsw-alias-bg-layer-1:#fafafa; --dsw-alias-bg-layer-2:#f0f0f2;
    --dsw-alias-border-l1:#ebebef; --dsw-alias-border-l2:#d5d5db;
    --dsw-alias-brand-primary:#2b6bf3;
    --dsw-alias-label-primary:#17171c; --dsw-alias-label-secondary:#6b6b76;
  }
  .band{width:720px;margin:40px auto}
  .dsh-hi{animation:none !important}
  ${pluginCss()}
</style></head>
<body>
  <div class="band"><div id="row">${row.replace('<span class="dsh-hi-text"', '<span id="txt" class="dsh-hi-text"')}</div></div>
  <script>${measured}</script>
</body></html>`

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-geometry-'))
const pagePath = path.join(dir, 'row.html')
fs.writeFileSync(pagePath, page, 'utf8')

const dom = execFileSync(browser, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--virtual-time-budget=2000', '--window-size=800,300', '--dump-dom', pagePath,
], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })

try {
  fs.rmSync(dir, { recursive: true, force: true })
} catch {
  /* a leftover temp directory is harmless */
}

const m = /<pre id="result">([\s\S]*?)<\/pre>/.exec(dom)
if (m === null) throw new Error('the browser did not return measurements')

const data = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
console.log('row width          :', data.rowWidth.toFixed(2))
console.log('dots               :', data.dots)
console.log('text vs row centre :', data.textCentreMinusRowCentre.toFixed(3), 'px')
console.log('text vs dots mid   :', data.textCentreMinusDotsMid.toFixed(3), 'px')
console.log('gap left / right   :', data.gapLeft.toFixed(2), '/', data.gapRight.toFixed(2), 'px')

const tolerance = 0.05
if (data.dots !== 2) throw new Error('expected exactly two dots, got ' + data.dots)
if (Math.abs(data.textCentreMinusDotsMid) > tolerance) {
  throw new Error('text is ' + data.textCentreMinusDotsMid + 'px off the midpoint between the dots')
}
if (Math.abs(data.textCentreMinusRowCentre) > tolerance) {
  throw new Error('text is ' + data.textCentreMinusRowCentre + 'px off the row centre')
}
if (Math.abs(data.gapLeft - data.gapRight) > tolerance) {
  throw new Error('left and right gaps differ: ' + data.gapLeft + ' vs ' + data.gapRight)
}

console.log('measured in', path.basename(browser) + ': the text sits exactly between the two dots')
console.log('OK')
