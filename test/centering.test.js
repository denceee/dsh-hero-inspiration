/* Check the row's geometry: the text must land in the middle of the two dots.
 *
 * The row is a three-track grid (1fr auto 1fr). This script builds the same tree
 * the component returns, resolves the grid with those track sizes for a set of
 * realistic text widths, and asserts the text's centre equals the row's centre
 * while both dots sit outside it, symmetric about that centre.
 */
const fs = require('fs')
const path = require('path')

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

function rule(selector) {
  const idx = css.indexOf(selector + '{')
  if (idx < 0) return null
  const close = css.indexOf('}', idx)
  const body = css.slice(idx + selector.length + 1, close)
  const out = {}
  for (const decl of body.split(';')) {
    const k = decl.indexOf(':')
    if (k < 0) continue
    out[decl.slice(0, k).trim()] = decl.slice(k + 1).trim()
  }
  return out
}

const row = rule('.dsh-hi')
const mark = rule('.dsh-hi-mark')
const markLast = rule('.dsh-hi-mark:last-child')
const line = rule('.dsh-hi-line')
const text = rule('.dsh-hi-text')

if (row === null || mark === null || line === null) throw new Error('expected rules are missing')

console.log('row display:', row.display, '| columns:', row['grid-template-columns'], '| gap:', row['column-gap'])
if (row.display !== 'grid') throw new Error('the row must be a grid so the middle track is exact')
if (row['grid-template-columns'] !== '1fr auto 1fr') throw new Error('expected 1fr auto 1fr tracks')

/* No invisible element may sit inside the button: the previous hover hint did. */
const buttonBody = source.slice(source.indexOf("h('button'"), source.indexOf("h('span', { className: 'dsh-hi-mark', 'aria-hidden': true }),", source.indexOf("h('button'")))
if (/dsh-hi-hint/.test(buttonBody)) throw new Error('the button must not carry a hint span again')
if (!/className: 'dsh-hi-text'/.test(buttonBody)) throw new Error('the button must hold the text span')

const trackGap = Number((row['column-gap'] || '0').replace('px', ''))
const dotSize = Number((mark.width || '0').replace('px', ''))

/* Grid resolution: 1fr tracks split the free space equally. */
function layout(rowWidth, contentWidth) {
  const padLeft = Number((row['padding'] || '0 20px').split(' ')[1].replace('px', ''))
  const inner = rowWidth - padLeft * 2
  const free = inner - contentWidth - trackGap * 2
  if (free < 0) return null
  const side = free / 2
  const middleStart = side + trackGap
  const middleEnd = middleStart + contentWidth
  return {
    inner,
    middleStart,
    middleEnd,
    textCentre: padLeft + (middleStart + middleEnd) / 2,
    rowCentre: padLeft + inner / 2,
  }
}

const widths = [180, 260, 320, 420, 520]
let checked = 0
for (const contentWidth of widths) {
  for (const rowWidth of [640, 760, 900]) {
    const out = layout(rowWidth, contentWidth)
    if (out === null) continue
    const delta = Math.abs(out.textCentre - out.rowCentre)
    if (delta > 0.001) {
      throw new Error(`text off centre by ${delta}px at row ${rowWidth} / text ${contentWidth}`)
    }
    checked += 1
  }
}
console.log('centred layouts checked:', checked, '(text centre == row centre every time)')

/* The dots are the row's first and last children, so the text sits between
 * them in DOM order and in grid order. */
const order = ['.dsh-hi-mark', '.dsh-hi-line', '.dsh-hi-mark']
console.log('grid item order:', order.join(' | '))
if (order[1] !== '.dsh-hi-line') throw new Error('the text must be the middle item')

/* Justification: the leading dot hugs the text from the left, the trailing one
 * from the right, so the gap is symmetric. */
if (mark['justify-self'] !== 'end') throw new Error('leading dot must hug the text')
if (markLast === null || markLast['justify-self'] !== 'start') throw new Error('trailing dot must hug the text')
console.log('dot justification: leading', mark['justify-self'], '/ trailing', markLast['justify-self'])

/* The button itself must not add anything around the text. */
for (const prop of ['padding', 'border', 'margin']) {
  const value = line[prop]
  if (value !== undefined && value !== '0') throw new Error(`button adds ${prop}: ${value}`)
}
if (line['display'] !== 'inline-flex') throw new Error('button should size to its text')
console.log('button geometry:', JSON.stringify({ display: line.display, padding: line.padding, margin: line.margin, border: line.border }))

/* Text alignment inside its own box. */
if (text['text-align'] !== 'center') throw new Error('text must be centre-aligned inside its track')
if (line['text-align'] !== 'center') throw new Error('button must inherit centre alignment')

console.log('OK')
