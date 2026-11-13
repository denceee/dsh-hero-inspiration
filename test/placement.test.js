/* Verify the placement cascade against a reconstructed hero column.
 *
 * The shell's blank-session composer bar is a column flex box. Its boxes are, in
 * DOM order:
 *   1. the headline block          (fish + 「探索未至之境」 + 预览版)
 *   2. the workspace row
 *   3. the conversation.input.dock outlet   (display: contents)
 *   4. the conversation.composer.bar outlet (display: contents → composer card)
 *
 * Both outlets are display:contents, so their children become items of the same
 * column. This script builds that tree with the plugin's real CSS and confirms
 * the resulting flex order puts the line between the headline and the workspace
 * row, and leaves the tree untouched when the line is absent.
 */
const fs = require('fs')
const path = require('path')

const clientPath = path.join(__dirname, '..', 'client.js')
const source = fs.readFileSync(clientPath, 'utf8')

/* Pull the exact CSS string the bundle installs. */
const marker = 'const CSS = ['
const start = source.indexOf(marker)
if (start < 0) throw new Error('CSS block not found')
const end = source.indexOf("].join('')", start)
if (end < 0) throw new Error('CSS block end not found')
const literal = source.slice(start + marker.length, end)
const parts = []
for (const line of literal.split('\n')) {
  const m = line.match(/^\s*'((?:[^'\\]|\\.)*)',?\s*$/)
  if (m) parts.push(m[1].replace(/\\'/g, "'"))
}
const css = parts.join('')
if (!css.includes('.dsh-hi{')) throw new Error('CSS did not assemble')

/* ---------------------------------------------------------------- selectors -- */

/** Minimal matcher for the selector forms this bundle actually uses. */
function matchesSimple(el, text) {
  /* text is one compound selector; support .class, [attr="v"], :not(...), :first-child, :has(...) */
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '.') {
      const m = /^\.([A-Za-z0-9_-]+)/.exec(text.slice(i))
      if (!m) return false
      if (!el.classes.includes(m[1])) return false
      i += m[0].length
    } else if (ch === '[') {
      const m = /^\[([A-Za-z0-9_-]+)(?:="([^"]*)")?\]/.exec(text.slice(i))
      if (!m) return false
      const [, attr, value] = m
      if (!(attr in el.attrs)) return false
      if (value !== undefined && el.attrs[attr] !== value) return false
      i += m[0].length
    } else if (ch === ':') {
      if (text.startsWith(':first-child', i)) {
        if (el.parent === null) return false
        if (el.parent.children.indexOf(el) !== 0) return false
        i += ':first-child'.length
      } else if (text.startsWith(':not(', i)) {
        const close = text.indexOf(')', i)
        const inner = text.slice(i + 5, close)
        if (matchesCompound(el, inner)) return false
        i = close + 1
      } else if (text.startsWith(':has(', i)) {
        let depth = 0
        let close = i
        for (let k = i; k < text.length; k += 1) {
          if (text[k] === '(') depth += 1
          if (text[k] === ')') {
            depth -= 1
            if (depth === 0) { close = k; break }
          }
        }
        const inner = text.slice(i + 5, close)
        if (!hasDescendantMatching(el, inner)) return false
        i = close + 1
      } else {
        return false
      }
    } else if (ch === '*') {
      i += 1
    } else {
      return false
    }
  }
  return true
}

function matchesCompound(el, text) {
  return matchesSimple(el, text)
}

/** Split on `>` that sits outside parentheses: `:has(...)` carries its own. */
function splitTop(selector) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of selector) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === '>' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current.trim())
  return parts.filter(Boolean)
}

/* `>`-separated chains only, which is all this CSS uses. */
function matchesComplex(el, selector) {
  const parts = splitTop(selector)
  if (parts.length === 0) return false
  if (!matchesSimple(el, parts[parts.length - 1])) return false
  let current = el
  for (let k = parts.length - 2; k >= 0; k -= 1) {
    const parent = current.parent
    if (parent === null) return false
    if (!matchesSimple(parent, parts[k])) return false
    current = parent
  }
  return true
}

function hasDescendantMatching(root, inner) {
  const chain = splitTop(inner)
  function walk(el, depth) {
    if (depth === chain.length) return true
    const next = chain[depth]
    return el.children.some((child) => {
      if (!matchesSimple(child, next)) return false
      if (depth === chain.length - 1) return true
      return walk(child, depth + 1)
    })
  }
  return walk(root, 0)
}

/* --------------------------------------------------------------- the rules -- */

const rules = []
{
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    const decls = {}
    for (const decl of m[2].split(';')) {
      const idx = decl.indexOf(':')
      if (idx < 0) continue
      decls[decl.slice(0, idx).trim()] = decl.slice(idx + 1).trim()
    }
    rules.push({ selectors, decls })
  }
}

/* ------------------------------------------------------------- tree builder -- */

function el(tag, { classes = [], attrs = {}, children = [], display = 'block' } = {}) {
  const node = { tag, classes, attrs, children, parent: null, display, style: {} }
  for (const child of children) child.parent = node
  return node
}

function buildHero({ withLine }) {
  const line = withLine
    ? el('div', { classes: ['dsh-hi'], children: [el('span', { classes: ['dsh-hi-mark'] })] })
    : null

  const dockChildren = []
  if (line) dockChildren.push(line)

  const dock = el('div', {
    attrs: { 'data-slot': 'conversation.input.dock' },
    children: dockChildren,
    display: 'contents',
  })

  const composerCard = el('div', { classes: ['card'] })
  const composerBar = el('div', {
    attrs: { 'data-slot': 'conversation.composer.bar' },
    children: [composerCard],
    display: 'contents',
  })

  const headline = el('div', { classes: ['headline'], children: [el('span')] })
  const workspaceRow = el('div', { classes: ['workspaceRow'], children: [el('button')] })

  const column = el('div', {
    classes: ['stack'],
    children: withLine
      ? [headline, workspaceRow, dock, composerBar]
      : [headline, workspaceRow, composerBar],
    display: 'flex',
    attrs: { 'data-direction': 'column' },
  })

  return { column, headline, workspaceRow, dock, composerBar, composerCard, line }
}

/* Apply the cascade: collect every matching declaration, in source order. */
function applyRules(root) {
  const all = []
  ;(function walk(node) {
    all.push(node)
    for (const child of node.children) walk(child)
  })(root)

  for (const node of all) {
    node.style = {}
    node.order = 0
  }
  for (const rule of rules) {
    for (const node of all) {
      const matched = rule.selectors.some((selector) => {
        if (selector.startsWith('@')) return false
        if (selector.includes(':hover') || selector.includes(':focus')) return false
        return matchesComplex(node, selector)
      })
      if (!matched) continue
      for (const [prop, value] of Object.entries(rule.decls)) {
        if (prop === 'order') node.order = Number(value)
        node.style[prop] = value
      }
    }
  }
  return all
}

/* Flex ordering: a `display: contents` box generates no box, so its children are
 * promoted into the same formatting context. Flatten first, then sort the
 * surviving items by (own order, DOM position). */
function visualOrder(column) {
  const items = []
  ;(function collect(node) {
    for (const child of node.children) {
      if (child.display === 'contents') collect(child)
      else items.push(child)
    }
  })(column)
  const indexed = column.children.length >= 0 ? items.map((item, i) => ({ item, i })) : []
  indexed.sort((a, b) => (a.item.order - b.item.order) || (a.i - b.i))
  return indexed.map((entry) => entry.item)
}

function labelOf(node) {
  if (node === undefined) return 'nothing'
  if (node.classes.includes('dsh-hi')) return 'the line'
  if (node.classes.includes('headline')) return 'headline'
  if (node.classes.includes('workspaceRow')) return 'workspace row'
  if (node.classes.includes('card')) return 'composer card'
  return node.tag
}

/* ------------------------------------------------------------------ checks -- */

const withLine = buildHero({ withLine: true })
applyRules(withLine.column)
console.log('computed orders:', JSON.stringify(withLine.column.children.map((c) => ({
  cls: c.classes, slot: c.attrs['data-slot'] ?? null, order: c.order,
}))))
const shown = visualOrder(withLine.column)
console.log('with the line:', shown.map(labelOf).join(' | '))

const names = shown.map(labelOf)
const iLine = names.indexOf('the line')
const iHead = names.indexOf('headline')
const iWorkspace = names.indexOf('workspace row')
const iCard = names.indexOf('composer card')

if (iLine < 0) throw new Error('the line is not rendered in the hero column')
if (!(iHead === 0)) throw new Error('headline must stay first, got ' + names.join(','))
if (!(iLine === 1)) throw new Error('the line must come directly after the headline')
if (!(iWorkspace > iLine)) throw new Error('the workspace picker must sit below the line')
if (!(iCard > iWorkspace)) throw new Error('the composer card must stay below the workspace row')

const noLine = buildHero({ withLine: false })
applyRules(noLine.column)
const hidden = visualOrder(noLine.column)
console.log('without the line:', hidden.map(labelOf).join(' | '))
const hiddenNames = hidden.map(labelOf)
if (hiddenNames.join('|') !== 'headline|workspace row|composer card') {
  throw new Error('ordering must be untouched when the line is absent, got ' + hiddenNames.join(','))
}
if (hidden.every((n) => n.order === 0)) console.log('shipped order untouched when absent: every item order 0')

console.log('OK')
