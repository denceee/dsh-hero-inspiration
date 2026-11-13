/* Shared test runtime for the hero-inspiration bundle.
 *
 * Loads the real client bundle against a fake React hooks runtime and a fake
 * Cordis context, then exports the pieces every check needs. Importing this file
 * has no side effects beyond that bootstrap: it asserts nothing and prints
 * nothing, so a check can drive the components itself.
 */
/* Behavioural harness: run the plugin's client bundle against a small React hooks
 * runtime so the deck, the visibility rules, the New Session click path, and the
 * settings page that edits the pool are exercised for real instead of guessed. */
const fs = require('fs')
const path = require('path')

/* ------------------------------------------------------------ fake timers -- */
let now = 0
let timers = []
let nextTimerId = 1
function fakeSetTimeout(fn, ms) {
  const id = nextTimerId++
  timers.push({ id, at: now + (ms || 0), fn })
  return id
}
function fakeClearTimeout(id) {
  timers = timers.filter((t) => t.id !== id)
}
function advance(ms) {
  const target = now + ms
  for (;;) {
    const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)
    if (due.length === 0) break
    const next = due[0]
    timers = timers.filter((t) => t !== next)
    now = next.at
    next.fn()
    flush()
  }
  now = target
  flush()
}

/* ------------------------------------------------------------- fake react -- */
const pendingRerenders = []
let currentInstance = null
const allInstances = []

function makeHooks(instance) {
  let index = 0
  return {
    reset() { index = 0 },
    useState(init) {
      const i = index++
      const hooks = instance.hooks
      if (!(i in hooks)) hooks[i] = { value: typeof init === 'function' ? init() : init }
      const slot = hooks[i]
      const set = (next) => {
        const value = typeof next === 'function' ? next(slot.value) : next
        if (Object.is(value, slot.value)) return
        slot.value = value
        pendingRerenders.push(instance)
      }
      return [slot.value, set]
    },
    useRef(initial) {
      const i = index++
      const hooks = instance.hooks
      if (!(i in hooks)) hooks[i] = { value: { current: initial } }
      return hooks[i].value
    },
    useEffect(fn, deps) {
      const i = index++
      const hooks = instance.hooks
      const prev = hooks[i]
      const changed = prev === undefined || deps === undefined
        || prev.deps.length !== deps.length
        || deps.some((d, k) => !Object.is(d, prev.deps[k]))
      if (!changed) return
      if (prev !== undefined && typeof prev.cleanup === 'function') prev.cleanup()
      hooks[i] = { deps: deps || [], cleanup: undefined }
      hooks[i].wanted = fn
    },
    useMemo(fn) { index++; return fn() },
    useCallback(fn) { index++; return fn },
  }
}

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Fragment: 'Fragment',
  useState: (init) => currentInstance.hooksApi.useState(init),
  useRef: (v) => currentInstance.hooksApi.useRef(v),
  useEffect: (fn, deps) => currentInstance.hooksApi.useEffect(fn, deps),
  useMemo: (fn) => currentInstance.hooksApi.useMemo(fn),
  useCallback: (fn) => currentInstance.hooksApi.useCallback(fn),
}

function runEffects() {
  const pending = []
  for (const instance of allInstances) {
    instance.hooks.forEach((hook) => {
      if (hook && hook.wanted) pending.push({ hook, instance })
    })
  }
  for (const { hook, instance } of pending) {
    const fn = hook.wanted
    hook.wanted = undefined
    currentInstance = instance
    instance.hooksApi.reset()
    hook.cleanup = fn() || undefined
  }
  currentInstance = null
}

function render(Component, props, existing) {
  const instance = existing || { hooks: [], hooksApi: null, props, alive: true }
  if (instance.hooksApi === null) {
    instance.hooksApi = makeHooks(instance)
    allInstances.push(instance)
  }
  instance.props = props
  instance.component = Component
  currentInstance = instance
  instance.hooksApi.reset()
  const node = Component(props)
  currentInstance = null
  instance.node = node
  return instance
}

function flush() {
  let guard = 0
  while (pendingRerenders.length > 0) {
    const batch = pendingRerenders.splice(0, pendingRerenders.length)
    for (const instance of batch) {
      if (!instance.alive) continue
      render(instance.component, instance.props, instance)
    }
    runEffects()
    guard += 1
    if (guard > 400) throw new Error('render loop did not settle')
  }
  runEffects()
}

/* --------------------------------------------------------------- the plugin -- */
const store = new Map()
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
}

let captured = null
const window = { localStorage, __ModuleLoader__: { load(def) { captured = def } } }
const fakeDocument = {
  querySelector: () => null,
  createElement: () => ({ setAttribute() {}, textContent: '', parentNode: null }),
  head: { appendChild() {} },
}

const code = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8')
new Function('window', 'document', 'console', 'setTimeout', 'clearTimeout', code)(
  window, fakeDocument, console, fakeSetTimeout, fakeClearTimeout,
)

if (captured === null) throw new Error('module loader was not called')
if (captured.id !== 'dsh-hero-inspiration') throw new Error('unexpected id ' + captured.id)
const mod = captured.factory(() => React)
if (!Array.isArray(mod.inject)) throw new Error('missing inject')

const slots = {}
const dictionaries = {}
const disposers = []
const workspace = {
  calls: [],
  startSession(...args) { this.calls.push(args); return 'started' },
  openWorkspace(...args) { this.calls.push(args); return Promise.resolve() },
}
const ctx = {
  effect: (f) => { const d = f(); disposers.push(d); return d },
  inject: (names, run) => { run(ctx) },
  get: (key) => (key === 'uiWorkspace' ? workspace : undefined),
  locale: {
    register: (ns, loc, dict) => {
      if (dictionaries[ns + ':' + loc]) throw new Error('duplicate dictionary ' + ns + ':' + loc)
      dictionaries[ns + ':' + loc] = dict
      return () => {}
    },
    bind: (ns) => (key) => {
      const dict = dictionaries[ns + ':zh'] || {}
      return dict[key] !== undefined ? dict[key] : key
    },
  },
  slots: {
    inject: (name, cb) => cb(),
    register: (options, component) => {
      if (slots[options.name]) throw new Error('slot ' + options.name + ' registered twice')
      slots[options.name] = { options, component }
      return () => {}
    },
  },
}
mod.apply(ctx)

const zh = dictionaries['heroInspiration:zh']
const en = dictionaries['heroInspiration:en']
if (!zh || !en) throw new Error('dictionaries were not registered')
for (let i = 1; i <= 40; i += 1) {
  if (!zh['l' + i] || !en['l' + i]) throw new Error('missing line l' + i)
}
if (!zh.respin || !en.respin) throw new Error('missing respin label')
if (Object.keys(zh).length !== Object.keys(en).length) {
  throw new Error('zh and en dictionaries have different sizes')
}
for (const key of Object.keys(zh)) {
  if (en[key] === undefined) throw new Error('en is missing ' + key)
}
console.log('hero slot:', slots['conversation.input.dock'].options.id,
  '/ order', slots['conversation.input.dock'].options.order)
console.log('settings slot:', slots['settings.section'].options.id,
  '/ order', slots['settings.section'].options.order,
  '/ label', slots['settings.section'].options.label())
console.log('dictionaries:', Object.keys(zh).length, 'zh /', Object.keys(en).length, 'en')

const t = (key) => (zh[key] !== undefined ? zh[key] : key)
const Component = slots['conversation.input.dock'].component
const Settings = slots['settings.section'].component

function blankSession(id) {
  return { id, blank: true, awaitingFirstTurn: true, running: false, promptAttempted: false, openState: 'open' }
}

function props(sessionId, session, targets) {
  return {
    sessionId,
    t,
    useSession: (sel) => sel(session),
    useConversation: (sel) => sel({ activeTargets: targets || new Set() }),
  }
}

/* The row is dot | button(text) | dot. The text is the button's only child, so
 * nothing invisible can take width beside it and push it off the midpoint. */
function textOf(instance) {
  const node = instance.node
  if (node === null) return null
  return node.children[1].children[0].children[0]
}

function assertCenteredMarkup(node) {
  if (node === null) throw new Error('expected a rendered row')
  if (node.children.length !== 3) {
    throw new Error('row must hold exactly three children, got ' + node.children.length)
  }
  const [left, middle, right] = node.children
  if (!left.props || String(left.props.className) !== 'dsh-hi-mark') {
    throw new Error('first child must be the leading dot')
  }
  if (!right.props || String(right.props.className) !== 'dsh-hi-mark') {
    throw new Error('last child must be the trailing dot')
  }
  if (!middle.props || middle.props.className !== 'dsh-hi-line') {
    throw new Error('middle child must be the line button')
  }
  if (middle.children.length !== 1) {
    throw new Error('line button must hold only the text, got ' + middle.children.length)
  }
  const only = middle.children[0]
  if (!only.props || only.props.className !== 'dsh-hi-text') {
    throw new Error('line button must hold the text span alone')
  }
  if (typeof only.children[0] !== 'string' || only.children[0].length === 0) {
    throw new Error('text span must hold a non-empty string')
  }
}

function mount(sessionId, session, targets) {
  const instance = { hooks: [], hooksApi: null, alive: true }
  render(Component, props(sessionId, session || blankSession(sessionId), targets), instance)
  flush()
  return instance
}

function mountSettings() {
  const instance = { hooks: [], hooksApi: null, alive: true }
  render(Settings, { t, close() {} }, instance)
  flush()
  return instance
}

/* Find one element in the rendered settings tree by a marker. */
function find(node, predicate) {
  if (node === null || node === undefined) return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, predicate)
      if (hit !== null) return hit
    }
    return null
  }
  if (typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of node.children || []) {
    const hit = find(child, predicate)
    if (hit !== null) return hit
  }
  return null
}

/**
 * Unmount one instance the way React would: run every effect cleanup, then drop
 * it from the runtime. Without this, every instance ever mounted keeps its
 * listener and redraws on every later signal — which both wastes deck entries and
 * makes assertions about "the line changed" depend on how many other instances
 * happen to be alive. Production has exactly one live row at a time.
 */
function unmount(instance) {
  instance.alive = false
  for (const hook of instance.hooks) {
    if (hook !== undefined && hook !== null && typeof hook.cleanup === 'function') hook.cleanup()
  }
  instance.hooks = []
  instance.hooksApi = null
  const at = allInstances.indexOf(instance)
  if (at >= 0) allInstances.splice(at, 1)
}

const CONFIG_KEY = 'dsh-hero-inspiration:config:v1'


module.exports = {
  React,
  Component,
  Settings,
  store,
  localStorage,
  window,
  captured,
  mod,
  code,
  slots,
  dictionaries,
  disposers,
  workspace,
  ctx,
  zh,
  en,
  t,
  blankSession,
  props,
  textOf,
  assertCenteredMarkup,
  mount,
  mountSettings,
  find,
  unmount,
  render,
  flush,
  advance,
  allInstances,
  CONFIG_KEY,
}
