/* Behavioural suite: the deck, the visibility rules, the New Session click path,
 * and the settings page that edits the pool. */
const {
  Component, Settings,
  store, workspace, ctx, disposers,
  zh, en, t,
  blankSession, props, textOf, assertCenteredMarkup,
  mount, mountSettings, find, unmount,
  render, flush, advance,
  CONFIG_KEY,
} = require('./harness.js')

/* ------------------------------------------------------------- assertions -- */

/* 1. Hero draws on mount, and the row is dot | text | dot. */
const first = mount('s0')
if (first.node === null) throw new Error('hero must render on a blank Session')
assertCenteredMarkup(first.node)
console.log('')
console.log('first line:', textOf(first))

/* 2. Each new Session (fresh mount) draws a different line. */
const lines = [textOf(first)]
const mounted = [first]
for (let i = 1; i < 41; i += 1) {
  const next = mount('s' + i)
  if (next.node === null) throw new Error('hero hid for session s' + i)
  assertCenteredMarkup(next.node)
  lines.push(textOf(next))
  mounted.push(next)
}
let previous = mounted[mounted.length - 1]
/* Only the newest row is on screen in production; retire the rest. */
for (let i = 0; i < mounted.length - 1; i += 1) unmount(mounted[i])
let repeats = 0
for (let i = 1; i < lines.length; i += 1) if (lines[i] === lines[i - 1]) repeats += 1
console.log('new sessions drawn:', lines.length, '/ consecutive repeats:', repeats)
if (repeats !== 0) throw new Error('consecutive duplicate line')
const distinct = new Set(lines.slice(0, 40)).size
console.log('distinct lines in the first 40 new sessions:', distinct)
if (distinct !== 40) throw new Error('deck repeated inside one full cycle')

/* 3. Clicking the line redraws it in place. */
const beforeClick = textOf(previous)
previous.node.children[1].props.onClick()
flush()
const afterClick = textOf(previous)
console.log('respin:', beforeClick, '->', afterClick)
if (beforeClick === afterClick) throw new Error('clicking the line did not redraw it')
unmount(previous)

/* 4. New Session while the hero is already blank and the id is unchanged. */
const sameId = mount('sticky')
const sameFirst = textOf(sameId)
workspace.startSession(undefined)
flush()
const immediate = textOf(sameId)
advance(400)
const settled = textOf(sameId)
console.log('same-session New Session:', sameFirst, '-> immediate', immediate, '-> settled', settled)
if (settled === sameFirst) throw new Error('a New Session on an already-blank hero did not change the line')

/* 5. A different Session id draws without waiting for a click. */
const other = mount('different-id')
const otherLine = textOf(other)
console.log('switching Session id draws:', otherLine)
if (otherLine === settled) throw new Error('switching Sessions did not draw a new line')

/* 6. Visibility. */
const cases = [
  ['session has content', props('x', { blank: false, awaitingFirstTurn: false, running: false, promptAttempted: false, openState: 'open' })],
  ['prompt already attempted', props('x', { blank: true, awaitingFirstTurn: true, running: false, promptAttempted: true, openState: 'open' })],
  ['conversation target active', props('x', blankSession('x'), new Set(['chat']))],
  ['turn running', props('x', { blank: true, awaitingFirstTurn: true, running: true, promptAttempted: false, openState: 'open' })],
  ['session still loading', props('x', { blank: true, awaitingFirstTurn: true, running: false, promptAttempted: false, openState: 'loading' })],
]
for (const [label, caseProps] of cases) {
  const instance = { hooks: [], hooksApi: null, alive: true }
  render(Component, caseProps, instance)
  flush()
  if (instance.node !== null) throw new Error('hero must hide when ' + label)
  unmount(instance)
}
console.log('hidden for:', cases.map(([label]) => label).join(' / '))

/* 7. Missing conversation snapshot still counts as an idle hero. */
const noConv = { hooks: [], hooksApi: null, alive: true }
render(Component, { sessionId: 'noc', t, useSession: (sel) => sel(blankSession('noc')), useConversation: (sel) => sel(undefined) }, noConv)
flush()
if (noConv.node === null) throw new Error('a missing conversation snapshot must still show the hero line')
console.log('missing conversation snapshot: shown')
unmount(noConv)

/* The three rows from sections 4–5 are still alive; retire them so the reload
 * check below draws from a clean runtime. */
unmount(sameId)
unmount(other)

/* 8. The persisted deck is a permutation and reload continues it. */
const persisted = JSON.parse(store.get('dsh-hero-inspiration:v1'))
const permutation = persisted.order.every((n) => Number.isInteger(n) && n >= 0 && n < 40)
  && new Set(persisted.order).size === 40
if (!permutation) throw new Error('persisted order is not a permutation of the deck')
console.log('persisted deck: cursor', persisted.cursor, '/ last', persisted.last,
  '/ unique', new Set(persisted.order).size)
const snapshot = store.get('dsh-hero-inspiration:v1')
const reloaded = mount('after-reload')
if (store.get('dsh-hero-inspiration:v1') === snapshot) throw new Error('a draw after reload did not persist')
console.log('deck continues across reload: cursor', JSON.parse(store.get('dsh-hero-inspiration:v1')).cursor)
unmount(reloaded)

/* ------------------------------------------------------- settings section -- */

console.log('')
console.log('--- settings section ---')

const BUILTIN_TEXT = Object.keys(zh)
  .filter((k) => /^l\d+$/.test(k))
  .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  .map((k) => zh[k])
  .join('\n')

const panel = mountSettings()
if (panel.node === null) throw new Error('the settings section must render')

const area = find(panel.node, (node) => node.props && node.props.className === 'dsh-his-area')
if (area === null) throw new Error('the settings section must render the textarea')
if (area.props.value !== BUILTIN_TEXT) {
  throw new Error('the textarea must start filled with the 40 built-in lines')
}
if (area.props.value.split('\n').length !== 40) {
  throw new Error('the textarea must show all 40 built-in lines, got '
    + area.props.value.split('\n').length)
}

const toggle = find(panel.node, (node) => node.props && node.props.className === 'dsh-his-switch')
if (toggle === null) throw new Error('the settings section must render the enable switch')
if (toggle.props.checked !== true) throw new Error('the switch must start on')
console.log('panel: textarea prefilled with the 40 built-in lines, switch on')
console.log('  first prefilled line:', area.props.value.split('\n')[0])

/* The prefilled defaults are still the built-in pool: nothing extra is stored
 * until the reader actually edits them. */
if (store.get(CONFIG_KEY) !== undefined) {
  const initial = JSON.parse(store.get(CONFIG_KEY))
  if (initial.custom.length !== 0) throw new Error('showing the defaults must not become a custom pool')
}
console.log('  stored pool still built-in:', store.get(CONFIG_KEY) === undefined
  || JSON.parse(store.get(CONFIG_KEY)).custom.length === 0)

/* Editing one built-in line in place is the main path this change enables. */
const editedBuiltin = area.props.value.split('\n')
editedBuiltin[0] = '我改过的第一句'
const EDITED = editedBuiltin.join('\n')
area.props.onChange({ target: { value: EDITED } })
flush()
const afterEdit = JSON.parse(store.get(CONFIG_KEY))
if (afterEdit.custom.length !== 40) {
  throw new Error('editing one built-in line must keep all 40 lines, got ' + afterEdit.custom.length)
}
if (afterEdit.custom[0] !== '我改过的第一句') throw new Error('the edited line was not stored')
if (afterEdit.custom[1] !== zh.l2) throw new Error('the untouched lines must keep their text')
console.log('edited line 1 of the built-in pool; pool is now', afterEdit.custom.length, 'lines')

/* Typing the defaults back verbatim returns to the built-in pool. */
const area2 = find(panel.node, (node) => node.props && node.props.className === 'dsh-his-area')
area2.props.onChange({ target: { value: BUILTIN_TEXT } })
flush()
if (JSON.parse(store.get(CONFIG_KEY)).custom.length !== 0) {
  throw new Error('typing the built-in lines verbatim must not persist a custom pool')
}
console.log('typing the defaults back verbatim returns to the built-in pool')

/* Typing a genuine custom pool replaces it. */
const area3 = find(panel.node, (node) => node.props && node.props.className === 'dsh-his-area')
const CUSTOM = '第一句自定义\n第二句自定义\n第三句自定义'
area3.props.onChange({ target: { value: CUSTOM } })
flush()
console.log('typed 3 lines; stored config:', store.get(CONFIG_KEY))
const stored = JSON.parse(store.get(CONFIG_KEY))
if (stored.custom.length !== 3) throw new Error('three lines must persist, got ' + stored.custom.length)
if (stored.custom[0] !== '第一句自定义') throw new Error('line text was not preserved')
if (stored.enabled !== true) throw new Error('editing lines must keep the switch on')

/* The hero now draws only from the custom pool. */
const heroNow = mount('after-custom')
if (heroNow.node === null) throw new Error('the hero must still render with a custom pool')
assertCenteredMarkup(heroNow.node)
const customSeen = new Set()
for (let i = 0; i < 9; i += 1) {
  customSeen.add(textOf(mount('custom-' + i)))
}
console.log('hero draws from the custom pool only:', [...customSeen].join(' | '))
for (const seen of customSeen) {
  if (!CUSTOM.split('\n').includes(seen)) {
    throw new Error('the hero drew a line outside the custom pool: ' + seen)
  }
}
if (customSeen.size !== 3) throw new Error('the custom pool cycles through all three lines')

/* Blank lines and ragged whitespace are dropped and collapsed. */
const withNoise = find(panel.node, (node) => node.props && node.props.className === 'dsh-his-area')
withNoise.props.onChange({ target: { value: '  a  \n\n  b\tc  \n' } })
flush()
const noisy = JSON.parse(store.get(CONFIG_KEY))
console.log('whitespace handling:', JSON.stringify(noisy.custom))
if (noisy.custom.length !== 2) throw new Error('blank lines must be dropped, got ' + noisy.custom.length)
if (noisy.custom[0] !== 'a') throw new Error('leading and trailing spaces must be trimmed')
if (noisy.custom[1] !== 'b c') throw new Error('inner runs must collapse to one space')

/* Over-long lines are clipped, and the pool is capped. */
const longLine = 'x'.repeat(500)
const afterLong = find(panel.node, (node) => node.props && node.props.className === 'dsh-his-area')
afterLong.props.onChange({ target: { value: longLine } })
flush()
const clipped = JSON.parse(store.get(CONFIG_KEY)).custom[0]
console.log('a 500-character line is clipped to', clipped.length, 'characters')
if (clipped.length !== 200) throw new Error('a line must be clipped to 200 characters')

/* Many lines are capped at 200 entries. */
const many = Array.from({ length: 320 }, (_, i) => 'line ' + i).join('\n')
const afterMany = find(panel.node, (node) => node.props && node.props.className === 'dsh-his-area')
afterMany.props.onChange({ target: { value: many } })
flush()
const capped = JSON.parse(store.get(CONFIG_KEY)).custom
console.log('320 pasted lines are capped to', capped.length)
if (capped.length !== 200) throw new Error('the pool must cap at 200 lines')

/* The switch hides the hero line. */
const switchOff = find(panel.node, (node) => node.props && node.props.className === 'dsh-his-switch')
switchOff.props.onChange({ target: { checked: false } })
flush()
if (JSON.parse(store.get(CONFIG_KEY)).enabled !== false) throw new Error('the switch did not persist')
const hidden = mount('switch-off')
if (hidden.node !== null) throw new Error('the hero must hide when the switch is off')
console.log('switch off: hero hidden, config persisted')

/* Turning it back on shows the line again. */
const switchOn = find(panel.node, (node) => node.props && node.props.className === 'dsh-his-switch')
switchOn.props.onChange({ target: { checked: true } })
flush()
const shownAgain = mount('switch-on')
if (shownAgain.node === null) throw new Error('the hero must come back when the switch is on')
console.log('switch on: hero shown again')

/* Reset restores the built-in pool. */
const resetBtn = find(panel.node, (node) => (
  node.props && node.props.className === 'dsh-his-btn'
))
if (resetBtn === null) throw new Error('the settings section must render the reset button')
if (resetBtn.props.disabled !== false) throw new Error('reset must be enabled while a custom pool is set')
resetBtn.props.onClick()
flush()
const afterReset = JSON.parse(store.get(CONFIG_KEY))
console.log('reset: custom lines', afterReset.custom.length, '- built-in pool restored')
if (afterReset.custom.length !== 0) throw new Error('reset must clear the custom pool')
const builtInAgain = mount('after-reset')
const builtInText = textOf(builtInAgain)
if (!/^l\d+$/.test(zh.l1) && !Object.values(zh).includes(builtInText)) {
  throw new Error('after reset the hero must draw a built-in line, got ' + builtInText)
}
const resetDisabled = find(panel.node, (node) => node.props && node.props.className === 'dsh-his-btn')
if (resetDisabled.props.disabled !== true) throw new Error('reset must disable when the pool is built-in')
console.log('reset button disabled again:', resetDisabled.props.disabled)

/* Reset puts the built-in lines back into the box. */
const afterResetArea = find(panel.node, (node) => node.props && node.props.className === 'dsh-his-area')
if (afterResetArea.props.value !== BUILTIN_TEXT) {
  throw new Error('reset must refill the box with the 40 built-in lines')
}
console.log('reset refilled the box with the 40 built-in lines')

/* The textarea is never empty on a fresh mount, in either locale. */
const englishPanel = { hooks: [], hooksApi: null, alive: true }
const enT = (key) => (en[key] !== undefined ? en[key] : key)
render(Settings, { t: enT, close() {} }, englishPanel)
flush()
const enArea = find(englishPanel.node, (node) => node.props && node.props.className === 'dsh-his-area')
const enFirst = enArea.props.value.split('\n')[0]
if (enFirst !== en.l1) throw new Error('the prefilled defaults must follow the locale, got ' + enFirst)
console.log('english panel prefills the english defaults:', enFirst.slice(0, 42) + '…')
unmount(englishPanel)

/* The preview mirrors the active pool. */
const sampleText = find(panel.node, (node) => node.props && node.props.className === 'dsh-his-sample-text')
if (sampleText === null) throw new Error('the preview row must render')
console.log('preview sample:', sampleText.children[0])
unmount(panel)

/* ---------------------------------------------------------------- dispose -- */

console.log('')
const tappedStart = workspace.startSession
for (const d of disposers) if (typeof d === 'function') d()
console.log('dispose restored startSession:', workspace.startSession !== tappedStart)

console.log('')
console.log('OK')

