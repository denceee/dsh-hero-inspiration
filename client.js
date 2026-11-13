window.__ModuleLoader__.load({
  id: 'dsh-hero-inspiration',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'heroInspiration'
    const STYLE_ATTR = 'data-dsh-hero-inspiration'
    const DECK_KEY = 'dsh-hero-inspiration:v1'
    const CONFIG_KEY = 'dsh-hero-inspiration:config:v1'
    const TOTAL = 40
    const MAX_CUSTOM = 200
    const MAX_LINE = 200

    /* ---------------------------------------------------------------- deck -- */

    /**
     * The deck is an index permutation over the active pool. It is rebuilt when
     * the pool size changes, which is what lets a custom list of any length reuse
     * the same shuffle machinery as the built-in forty.
     */
    function shuffled(list) {
      const out = list.slice()
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1))
        const swap = out[i]
        out[i] = out[j]
        out[j] = swap
      }
      return out
    }

    function fullOrder(size) {
      const all = []
      for (let i = 0; i < size; i += 1) all.push(i)
      return shuffled(all)
    }

    function readDeck(size) {
      let parsed
      try {
        const raw = window.localStorage.getItem(DECK_KEY)
        if (raw === null) return null
        parsed = JSON.parse(raw)
      } catch {
        return null
      }
      if (parsed === null || typeof parsed !== 'object') return null
      if (!Array.isArray(parsed.order)) return null
      const order = parsed.order
      if (order.length !== size) return null
      for (let i = 0; i < size; i += 1) {
        const value = order[i]
        if (!Number.isInteger(value) || value < 0 || value >= size) return null
      }
      if (new Set(order).size !== size) return null
      return {
        order: order.slice(),
        cursor: Number.isInteger(parsed.cursor) && parsed.cursor >= 0 ? parsed.cursor : 0,
        last: Number.isInteger(parsed.last) && parsed.last >= 0 && parsed.last < size ? parsed.last : -1,
      }
    }

    function writeDeck(state) {
      try {
        window.localStorage.setItem(DECK_KEY, JSON.stringify({
          order: state.order,
          cursor: state.cursor,
          last: state.last,
        }))
      } catch {
        /* Storage unavailable: the in-memory cursor still keeps this page's draws distinct. */
      }
    }

    /**
     * Draw the next index from the shuffled deck: two consecutive New Sessions
     * never repeat a line, and exhausting the deck reshuffles without repeating
     * the line that was just on screen.
     */
    function drawLine(size) {
      if (!(size > 0)) return -1
      const stored = readDeck(size)
      const state = stored !== null ? stored : { order: fullOrder(size), cursor: 0, last: -1 }

      if (state.cursor >= state.order.length) {
        state.order = fullOrder(size)
        state.cursor = 0
      }
      if (size > 1 && state.order[state.cursor] === state.last) {
        const other = state.cursor + 1 < state.order.length ? state.cursor + 1 : 0
        const swap = state.order[other]
        state.order[other] = state.order[state.cursor]
        state.order[state.cursor] = swap
      }

      const line = state.order[state.cursor]
      state.cursor += 1
      state.last = line
      writeDeck(state)
      return line
    }

    /* --------------------------------------------------------------- config -- */

    /** Collapse runs of whitespace so a pasted line cannot carry a ragged tail. */
    function collapse(raw) {
      return String(raw).replace(/[\s\u3000]+/g, ' ').trim()
    }

    function normalizeLines(input) {
      const list = typeof input === 'string'
        ? input.split(/\r?\n/)
        : Array.isArray(input) ? input : []
      const out = []
      for (const raw of list) {
        if (typeof raw !== 'string') continue
        const line = collapse(raw).slice(0, MAX_LINE)
        if (line.length === 0) continue
        out.push(line)
        if (out.length >= MAX_CUSTOM) break
      }
      return out
    }

    function readConfig() {
      try {
        const raw = window.localStorage.getItem(CONFIG_KEY)
        if (raw === null) return { enabled: true, custom: [] }
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return { enabled: true, custom: [] }
        return { enabled: parsed.enabled !== false, custom: normalizeLines(parsed.custom) }
      } catch {
        return { enabled: true, custom: [] }
      }
    }

    let config = readConfig()
    let configRevision = 0
    const configListeners = new Set()

    /** Replace the whole configuration, persist it, and wake every consumer. */
    function writeConfig(next) {
      config = { enabled: next.enabled !== false, custom: normalizeLines(next.custom) }
      try {
        window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
      } catch {
        /* Persisting failed; the in-memory value still applies for this page. */
      }
      configRevision += 1
      for (const listener of [...configListeners]) {
        try {
          listener(configRevision)
        } catch (error) {
          console.error('hero-inspiration: config listener failed', error)
        }
      }
    }

    /** How many lines the active pool holds. Custom lines replace the built-ins. */
    function poolSize() {
      return config.custom.length > 0 ? config.custom.length : TOTAL
    }

    /** The built-in deck as text, in the active locale. */
    function builtinLines(t) {
      const out = []
      for (let i = 1; i <= TOTAL; i += 1) out.push(t('l' + i))
      return out
    }

    /** The pool actually in force: the custom list when set, else the built-ins. */
    function activePool(t) {
      return config.custom.length > 0 ? config.custom : builtinLines(t)
    }

    /** True when the two pools hold exactly the same lines in the same order. */
    function sameLines(a, b) {
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
      return true
    }

    /** Resolve one pool index to the text the reader sees under the headline. */
    function lineText(t, index) {
      if (!(index >= 0)) return ''
      if (config.custom.length > 0) {
        const custom = config.custom[index]
        return typeof custom === 'string' ? custom : ''
      }
      return t('l' + (index + 1))
    }

    /* --------------------------------------------- new-session click signal -- */

    /**
     * A New Session on an already-blank hero reuses that blank Session, so the
     * Session id stays the same and the dock entry does not remount. The
     * workspace service is the one seam every New Session entry point goes
     * through, so the bundle taps it and mirrors each call into a tick.
     */
    const listeners = new Set()
    let ticks = 0

    function announce() {
      ticks += 1
      for (const listener of [...listeners]) {
        try {
          listener(ticks)
        } catch (error) {
          console.error('hero-inspiration: listener failed', error)
        }
      }
    }

    /** Tap one method and restore exactly the previous state on dispose. */
    function tapService(service, method) {
      if (service === undefined || service === null) return () => {}
      const original = service[method]
      if (typeof original !== 'function') return () => {}
      const own = Object.prototype.hasOwnProperty.call(service, method)
      const installed = function tapped(...args) {
        announce()
        return original.apply(this, args)
      }
      try {
        service[method] = installed
      } catch (error) {
        console.warn('hero-inspiration: cannot observe ' + method, error)
        return () => {}
      }
      if (service[method] !== installed) return () => {}
      return () => {
        if (service[method] !== installed) return
        try {
          if (own) service[method] = original
          else delete service[method]
        } catch (error) {
          console.warn('hero-inspiration: cannot restore ' + method, error)
        }
      }
    }

    /* ------------------------------------------------------------------- css -- */

    /*
     * Hero placement. In the blank-session hero the composer bar is a column flex
     * box whose direct boxes are the headline block (fish + 「探索未至之境」 + 预览版)
     * and the workspace row; the `conversation.input.dock` and
     * `conversation.composer.bar` outlets render with `display: contents`, so
     * their children are promoted to items of that same column. That makes
     * `order` the whole mechanism: the headline block stays 0, this line takes 1,
     * and the workspace row, any other dock entry, and the composer card are
     * pushed to 2. The line therefore sits directly under the headline and above
     * the workspace picker.
     *
     * The row itself is a three-track grid so the text is always exactly halfway
     * between the two dots, however long it wraps.
     *
     * Every ordering rule is gated with `:has(... > .dsh-hi)`, so they exist only
     * while this line is on screen; an ordinary conversation — where the
     * component renders nothing — keeps the shipped order untouched.
     */
    const CSS = [
      '.dsh-hi{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;',
      'column-gap:9px;box-sizing:border-box;width:100%;padding:0 20px;',
      'margin:-6px 0 0;text-align:center;order:1;',
      'animation:dsh-hi-rise 620ms cubic-bezier(.22,.61,.36,1) both}',
      /* Everything after the headline block inside the hero column, plus the
       * outlets themselves (harmless: they are display:contents). */
      '*:has(>[data-slot="conversation.input.dock"]>.dsh-hi)>*:not(:first-child){order:2}',
      /* Other entries sharing the dock outlet. */
      '*:has(>[data-slot="conversation.input.dock"]>.dsh-hi)>',
      '[data-slot="conversation.input.dock"]>*:not(.dsh-hi){order:2}',
      /* The composer card, promoted through its own contents outlet. */
      '*:has(>[data-slot="conversation.input.dock"]>.dsh-hi)>',
      '[data-slot="conversation.composer.bar"]>*{order:2}',
      '.dsh-hi-mark{flex:none;width:3px;height:3px;border-radius:999px;',
      'background:var(--dsw-alias-brand-primary);opacity:.5;justify-self:end}',
      '.dsh-hi-mark:last-child{justify-self:start}',
      '.dsh-hi-line{display:inline-flex;justify-self:center;margin:0;',
      'min-width:0;max-width:36em;cursor:pointer;background:none;border:0;',
      'padding:0;font:inherit;color:inherit;text-align:center}',
      '.dsh-hi-text{min-width:0;text-wrap:balance;text-align:center;',
      'color:var(--dsw-alias-label-secondary);',
      'font-size:13px;font-weight:400;line-height:21px;letter-spacing:.24px}',
      '.dsh-hi-line:hover .dsh-hi-text,.dsh-hi-line:focus-visible .dsh-hi-text{',
      'color:var(--dsw-alias-label-primary);',
      'text-decoration:underline dotted;text-underline-offset:4px;',
      'text-decoration-color:var(--dsw-alias-border-l2);',
      'text-decoration-thickness:1px}',
      '.dsh-hi-line:focus-visible{outline:1px solid var(--dsw-alias-border-l2);',
      'outline-offset:3px;border-radius:6px}',
      '@keyframes dsh-hi-rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
      '@media (prefers-reduced-motion:reduce){.dsh-hi{animation:none}}',

      /* ---- settings page ---- */
      '.dsh-his{display:flex;flex-direction:column;gap:16px;box-sizing:border-box;',
      'max-width:680px;padding:2px 0 28px;color:var(--dsw-alias-label-primary)}',
      '.dsh-his-head{display:flex;flex-direction:column;gap:5px}',
      '.dsh-his-title{margin:0;font-size:15px;font-weight:600;line-height:23px;',
      'color:var(--dsw-alias-label-primary)}',
      '.dsh-his-desc{margin:0;font-size:12px;line-height:19px;',
      'color:var(--dsw-alias-label-secondary)}',
      '.dsh-his-card{display:flex;flex-direction:column;gap:11px;box-sizing:border-box;',
      'padding:13px 15px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;',
      'background:var(--dsw-alias-bg-layer-1)}',
      '.dsh-his-row{display:flex;align-items:center;justify-content:space-between;gap:16px}',
      '.dsh-his-row-main{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.dsh-his-row-label{font-size:13px;line-height:20px;',
      'color:var(--dsw-alias-label-primary)}',
      '.dsh-his-row-hint{font-size:12px;line-height:18px;',
      'color:var(--dsw-alias-label-secondary)}',
      '.dsh-his-switch{position:relative;flex:none;box-sizing:border-box;width:38px;',
      'height:22px;margin:0;padding:0;cursor:pointer;appearance:none;',
      'border:1px solid var(--dsw-alias-border-l2);border-radius:999px;',
      'background:var(--dsw-alias-bg-layer-2);',
      'transition:background 140ms ease,border-color 140ms ease}',
      '.dsh-his-switch::after{content:"";position:absolute;top:2px;left:2px;',
      'width:16px;height:16px;border-radius:999px;',
      'background:var(--dsw-alias-label-secondary);',
      'transition:transform 140ms ease,background 140ms ease}',
      '.dsh-his-switch:checked{background:var(--dsw-alias-brand-primary);',
      'border-color:var(--dsw-alias-brand-primary)}',
      '.dsh-his-switch:checked::after{transform:translateX(16px);background:#fff}',
      '.dsh-his-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);',
      'outline-offset:2px}',
      '.dsh-his-area{display:block;box-sizing:border-box;width:100%;height:350px;',
      'min-height:130px;resize:vertical;margin:0;padding:9px 11px;',
      'border:1px solid var(--dsw-alias-border-l1);border-radius:10px;',
      'background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);',
      'font:inherit;font-size:13px;line-height:22px;letter-spacing:.2px}',
      '.dsh-his-area:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
      '.dsh-his-area::placeholder{color:var(--dsw-alias-label-secondary);opacity:.72}',
      '.dsh-his-meta{display:flex;align-items:center;justify-content:space-between;',
      'gap:12px;font-size:12px;line-height:18px;',
      'color:var(--dsw-alias-label-secondary)}',
      '.dsh-his-actions{display:flex;flex-wrap:wrap;gap:8px}',
      '.dsh-his-btn{appearance:none;cursor:pointer;margin:0;padding:5px 12px;',
      'border:1px solid var(--dsw-alias-border-l2);border-radius:8px;',
      'background:transparent;color:var(--dsw-alias-label-primary);',
      'font:inherit;font-size:12px;line-height:19px;',
      'transition:background 140ms ease,border-color 140ms ease}',
      '.dsh-his-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-his-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);',
      'outline-offset:2px}',
      '.dsh-his-btn:disabled{opacity:.45;cursor:default}',
      '.dsh-his-sample{display:grid;grid-template-columns:1fr auto 1fr;',
      'align-items:center;column-gap:9px;box-sizing:border-box;width:100%;',
      'padding:11px 12px;border:1px dashed var(--dsw-alias-border-l1);',
      'border-radius:10px;background:var(--dsw-alias-bg-base)}',
      '.dsh-his-sample-text{min-width:0;text-align:center;font-size:13px;',
      'line-height:21px;letter-spacing:.24px;',
      'color:var(--dsw-alias-label-secondary)}',
    ].join('')

    function installStyle() {
      if (typeof document === 'undefined') return () => {}
      if (document.querySelector('style[' + STYLE_ATTR + ']') !== null) return () => {}
      const tag = document.createElement('style')
      tag.setAttribute(STYLE_ATTR, '')
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        if (tag.parentNode !== null) tag.parentNode.removeChild(tag)
      }
    }

    /* ----------------------------------------------------------- presentation -- */

    /* `apply` replaces this with the namespace-bound translator. Components prefer
     * the reactive `t` seat the slot system injects, and fall back here when a
     * host build hands them no translator. */
    let boundT = (key) => key

    function translator(props) {
      return props !== null && typeof props === 'object' && typeof props.t === 'function'
        ? props.t
        : boundT
    }

    /** True while this Session still shows the blank New Session hero. */
    function stillHero(session) {
      if (session === undefined || session === null) return false
      if (session.openState !== 'open') return false
      if (session.running === true) return false
      if (session.promptAttempted === true) return false
      return session.blank === true || session.awaitingFirstTurn === true
    }

    /**
     * One encouragement line under the New Session headline, drawn from the
     * active pool — the built-in deck or the custom list from Settings. It
     * redraws when the hero first appears, when a New Session is requested
     * through the workspace service, when the Session under it changes, and when
     * the line itself is clicked.
     */
    function Inspiration(props) {
      const { sessionId, useSession, useConversation } = props
      const t = translator(props)
      const blank = useSession(stillHero)
      const idle = useConversation((conversation) => (
        conversation === undefined || conversation.activeTargets.size === 0
      ))
      const size = poolSize()
      const visible = blank && idle && config.enabled && size > 0

      const [tick, setTick] = React.useState(() => ticks)
      const [, setRevision] = React.useState(() => configRevision)
      const [, force] = React.useState(0)

      React.useEffect(() => {
        const onTick = (next) => setTick(next)
        const onConfig = (next) => setRevision(next)
        listeners.add(onTick)
        configListeners.add(onConfig)
        setTick(ticks)
        setRevision(configRevision)
        return () => {
          listeners.delete(onTick)
          configListeners.delete(onConfig)
        }
      }, [])

      /* The draw lives in a ref so a StrictMode double render cannot consume two
       * pool entries: the second pass sees the recorded line and keeps it. The
       * index is kept, not the text, so a locale switch re-reads the same line in
       * the other language and an edit in Settings updates what is on screen. */
      const drawn = React.useRef({
        session: undefined,
        line: -1,
        tick: -1,
        visible: false,
        reason: 'none',
        at: 0,
      })

      if (!visible) {
        drawn.current = { session: undefined, line: -1, tick, visible: false, reason: 'none', at: 0 }
        return null
      }

      const current = drawn.current
      const now = Date.now()
      const clicked = current.tick !== tick

      /* A custom pool that shrank below the drawn index cannot keep that index. */
      if (
        current.visible === false
        || current.line < 0
        || current.line >= size
        || clicked
      ) {
        drawn.current = { session: sessionId, line: drawLine(size), tick, visible: true, reason: 'tick', at: now }
      } else if (current.session !== sessionId) {
        /* A New Session that lands on a fresh blank Session right after the click
         * must not burn a second line: the click already drew this one. */
        const fromClick = current.reason === 'tick' && now - current.at < 4000
        drawn.current = fromClick
          ? { ...current, session: sessionId }
          : { session: sessionId, line: drawLine(size), tick, visible: true, reason: 'session', at: now }
      }

      const respin = () => {
        drawn.current = {
          session: sessionId,
          line: drawLine(poolSize()),
          tick,
          visible: true,
          reason: 'click',
          at: Date.now(),
        }
        force((n) => n + 1)
      }

      const text = lineText(t, drawn.current.line)
      if (text === '') return null

      return h('div', { className: 'dsh-hi' },
        h('span', { className: 'dsh-hi-mark', 'aria-hidden': true }),
        h('button', {
          type: 'button',
          className: 'dsh-hi-line',
          title: t('respin'),
          onClick: respin,
        }, h('span', { className: 'dsh-hi-text' }, text)),
        h('span', { className: 'dsh-hi-mark', 'aria-hidden': true }),
      )
    }

    /* ------------------------------------------------------ settings section -- */

    /**
     * The page behind Settings → 心灵鸡汤. It edits the same persisted
     * configuration the hero reads, so every change is visible on the New
     * Session page immediately — no save step, no reload.
     *
     * The box always shows the pool in force, built-in lines included, so the
     * forty defaults are editable in place rather than invisible. `draft` is null
     * until the reader types, which keeps the shown text following the active
     * locale until they actually change something.
     */
    function SettingsSection(props) {
      const t = translator(props)
      const [draft, setDraft] = React.useState(null)
      const [, bump] = React.useState(0)

      React.useEffect(() => {
        const onConfig = () => bump((n) => n + 1)
        configListeners.add(onConfig)
        return () => {
          configListeners.delete(onConfig)
        }
      }, [])

      const builtin = builtinLines(t)
      const custom = config.custom
      const shown = draft !== null
        ? draft
        : (custom.length > 0 ? custom.join('\n') : builtin.join('\n'))

      const lines = normalizeLines(shown)
      const usingCustom = custom.length > 0
      const count = usingCustom ? custom.length : TOTAL
      const sample = lines.length > 0 ? lines[0] : builtin[0]

      const editLines = (next) => {
        setDraft(next)
        const parsed = normalizeLines(next)
        /* Typing the defaults back in verbatim is not a customization: keep the
         * built-in pool so it goes on following the interface language. */
        writeConfig({
          enabled: config.enabled,
          custom: sameLines(parsed, builtin) ? [] : parsed,
        })
      }

      const toggle = (next) => {
        writeConfig({ enabled: next, custom: custom })
      }

      const reset = () => {
        setDraft(null)
        writeConfig({ enabled: config.enabled, custom: [] })
      }

      return h('div', { className: 'dsh-his' },
        h('div', { className: 'dsh-his-head' },
          h('h2', { className: 'dsh-his-title' }, t('settings.title')),
          h('p', { className: 'dsh-his-desc' }, t('settings.description')),
        ),

        h('div', { className: 'dsh-his-card' },
          h('div', { className: 'dsh-his-row' },
            h('div', { className: 'dsh-his-row-main' },
              h('span', { className: 'dsh-his-row-label' }, t('settings.enabled')),
              h('span', { className: 'dsh-his-row-hint' }, t('settings.enabledHint')),
            ),
            h('input', {
              type: 'checkbox',
              role: 'switch',
              className: 'dsh-his-switch',
              checked: config.enabled,
              'aria-label': t('settings.enabled'),
              onChange: (event) => toggle(event.target.checked === true),
            }),
          ),
        ),

        h('div', { className: 'dsh-his-card' },
          h('div', { className: 'dsh-his-row-main' },
            h('span', { className: 'dsh-his-row-label' }, t('settings.lines')),
            h('span', { className: 'dsh-his-row-hint' }, t('settings.linesHint')),
          ),
          h('textarea', {
            className: 'dsh-his-area',
            value: shown,
            rows: 15,
            spellCheck: false,
            placeholder: t('settings.placeholder'),
            'aria-label': t('settings.lines'),
            onChange: (event) => editLines(event.target.value),
          }),
          h('div', { className: 'dsh-his-meta' },
            h('span', null,
              (usingCustom ? t('settings.mode.custom') : t('settings.mode.default'))
              + ' · ' + count + ' ' + t('settings.unit')),
            h('span', null, t('settings.limit')),
          ),
          h('div', { className: 'dsh-his-actions' },
            h('button', {
              type: 'button',
              className: 'dsh-his-btn',
              disabled: !usingCustom,
              onClick: reset,
            }, t('settings.reset')),
          ),
        ),

        h('div', { className: 'dsh-his-card' },
          h('div', { className: 'dsh-his-row-main' },
            h('span', { className: 'dsh-his-row-label' }, t('settings.preview')),
            h('span', { className: 'dsh-his-row-hint' }, t('settings.previewHint')),
          ),
          h('div', { className: 'dsh-his-sample' },
            h('span', { className: 'dsh-hi-mark', 'aria-hidden': true }),
            h('span', { className: 'dsh-his-sample-text' }, sample),
            h('span', { className: 'dsh-hi-mark', 'aria-hidden': true }),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------- dictionaries -- */

    const ZH = {
      respin: '换一句',
      'settings.nav': '心灵鸡汤',
      'settings.title': '心灵鸡汤',
      'settings.description': '自定义「探索未至之境」下方显示的那句话。每次新建对话都会换一句，一轮之内不重复。',
      'settings.enabled': '在新建对话页显示',
      'settings.enabledHint': '关闭后标题下方不再显示任何句子。',
      'settings.lines': '句库',
      'settings.linesHint': '每行一句。这里就是当前生效的句库——内置的 40 句已经填好，直接改就行；全部清空则回到内置句库。',
      'settings.placeholder': '每行写一句，例如：\n慢一点没关系，方向对了就行。',
      'settings.mode.custom': '自定义句库',
      'settings.mode.default': '内置句库',
      'settings.unit': '句',
      'settings.limit': '单句上限 200 字',
      'settings.reset': '恢复内置句库',
      'settings.preview': '预览',
      'settings.previewHint': '实际显示效果，颜色与字号跟随主题。',
      l1: '山高路远，走下去才知道风声有多好。',
      l2: '你现在的笨拙，是熟练之前的必经之路。',
      l3: '慢一点没关系，方向对了就行。',
      l4: '没有哪个冬天不可逾越，也没有哪个春天会自己到来。',
      l5: '允许自己今天只做完一件小事。',
      l6: '你不是懒，你只是还没找到那件让你心跳的事。',
      l7: '疲惫不是失败的证据，是你确实在用力。',
      l8: '别急着证明自己，先照顾好自己。',
      l9: '心里那点火，别让风替你决定熄不熄。',
      l10: '有些答案，要走很远的路才会出现。',
      l11: '你今天多懂了一点点，就已经和昨天不同。',
      l12: '不必和谁比快，路是自己量的。',
      l13: '做不到完美，就先做到开始。',
      l14: '犹豫的时候，选那个以后不会后悔的方向。',
      l15: '你担心的八成不会发生，剩下的两成你扛得住。',
      l16: '沉住气，好事情需要时间发酵。',
      l17: '被否定一次，不等于被定义一生。',
      l18: '先把手里的事做好，运气会自己找上门。',
      l19: '世界很吵，你可以选择安静地变强。',
      l20: '你缺的不是动力，是一个更小的第一步。',
      l21: '熬不住的时候，允许自己只熬过今晚。',
      l22: '每一次重新开始，都比上一次多带了一点经验。',
      l23: '别用别人的进度条，量自己的维度。',
      l24: '你看不见的积累，正在暗处生效。',
      l25: '与其自责，不如把今天剩下的时间用好。',
      l26: '会累说明你在爬坡，平地上不会喘。',
      l27: '不必解释太多，做成的事自己会说话。',
      l28: '心情是天气，不是你。',
      l29: '今天的你，比想象中更能扛。',
      l30: '休息不是浪费，是给下一步让路。',
      l31: '有些门不是锁着，是你还没敲对节奏。',
      l32: '你走的每一步都算数，哪怕绕了远路。',
      l33: '光进来的时候，先把屋子收拾干净。',
      l34: '别怕慢，怕的是站在原地比较。',
      l35: '你以为的极限，通常只是一种临时的情绪。',
      l36: '把自己当队友，而不是对手。',
      l37: '好奇心是最不会亏本的投资。',
      l38: '与其等一个完美时机，不如造一个普通时机。',
      l39: '认真做一件小事，日子就开始有重量。',
      l40: '未至之境并非没有路，只是那条路还没被你的脚踩出来。',
    }

    const EN = {
      respin: 'Another one',
      'settings.nav': 'Encouragement',
      'settings.title': 'Encouragement',
      'settings.description': 'Customize the sentence shown under the New Session headline. It changes with every new session, and no line repeats within a cycle.',
      'settings.enabled': 'Show on the New Session page',
      'settings.enabledHint': 'When off, no sentence appears under the headline.',
      'settings.lines': 'Lines',
      'settings.linesHint': 'One line per row. This is the pool in force — the 40 built-in lines are already filled in, so edit them directly. Clearing the box restores the built-in pool.',
      'settings.placeholder': 'One line per row, for example:\nSlow is fine, as long as the direction is yours.',
      'settings.mode.custom': 'Custom pool',
      'settings.mode.default': 'Built-in pool',
      'settings.unit': 'lines',
      'settings.limit': 'Up to 200 characters per line',
      'settings.reset': 'Restore built-in lines',
      'settings.preview': 'Preview',
      'settings.previewHint': 'How it looks under the headline. Colours and size follow the theme.',
      l1: 'The road is long. You only learn how good the wind is once you keep walking.',
      l2: 'Being clumsy now is the price of being skilled later.',
      l3: 'Slow is fine, as long as the direction is yours.',
      l4: 'No winter lasts forever, and no spring arrives by itself.',
      l5: 'It is allowed to finish only one small thing today.',
      l6: 'You are not lazy. You have not found the thing that quickens you yet.',
      l7: 'Being tired is not proof of failure; it is proof you were pushing.',
      l8: 'Do not rush to prove yourself. Take care of yourself first.',
      l9: 'Guard the small fire in you. Do not let the wind decide whether it stays lit.',
      l10: 'Some answers only appear after a long way around.',
      l11: 'You understood one more thing today, and that already separates you from yesterday.',
      l12: 'Race no one. The distance is yours to measure.',
      l13: 'If perfect is out of reach, start imperfect.',
      l14: 'When unsure, choose the direction future-you will not regret.',
      l15: 'Most of what you fear will not happen, and the rest you can carry.',
      l16: 'Hold steady. Good things take time to ferment.',
      l17: 'Rejected once is not the same as being defined forever.',
      l18: 'Do the work in your hands, and luck starts finding its way to you.',
      l19: 'The world is loud. You are allowed to grow quietly.',
      l20: 'What you need is not motivation, but a smaller first step.',
      l21: 'When you cannot hold on, making it through tonight is enough.',
      l22: 'Every restart carries a little more experience than the last.',
      l23: 'Do not measure your dimension with someone else\u2019s progress bar.',
      l24: 'The accumulation you cannot see is working in the dark.',
      l25: 'Instead of blaming yourself, use the hours left in today.',
      l26: 'Getting tired means you are climbing. Flat ground does not make you pant.',
      l27: 'No need to over-explain. Finished work speaks for itself.',
      l28: 'Mood is weather, not identity.',
      l29: 'Today\u2019s you can carry more than you imagined.',
      l30: 'Rest is not waste. It clears the way for the next step.',
      l31: 'Some doors are not locked; you simply have not knocked in the right rhythm.',
      l32: 'Every step counts, even the long way round.',
      l33: 'When the light comes in, tidy the room first.',
      l34: 'Do not fear slow. Fear standing still to compare.',
      l35: 'What you call your limit is usually just a temporary feeling.',
      l36: 'Be your own teammate, not your own opponent.',
      l37: 'Curiosity is the investment that never loses money.',
      l38: 'Do not wait for a perfect moment. Build an ordinary one.',
      l39: 'Do one small thing seriously, and the days begin to have weight.',
      l40: 'The unexplored is not pathless; the path simply has not been pressed out by your feet yet.',
    }

    /* --------------------------------------------------------------- install -- */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => installStyle(), 'hero-inspiration: styles')
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'hero-inspiration: zh dictionary')
        ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'hero-inspiration: en dictionary')

        const bindT = ctx.locale !== undefined && typeof ctx.locale.bind === 'function'
          ? ctx.locale.bind(NS)
          : (key) => key
        boundT = bindT

        ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'hero-inspiration',
          order: -10,
          locale: NS,
        }, Inspiration)), 'hero-inspiration: hero line')

        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'hero-inspiration',
          order: 40,
          label: () => bindT('settings.nav'),
          locale: NS,
        }, SettingsSection)), 'hero-inspiration: settings section')

        /* The workspace service may activate after this plugin, so the tap waits
         * for its registration instead of reading it once at apply time. */
        const installTap = (scope) => {
          const workspace = scope.get === undefined ? undefined : scope.get('uiWorkspace')
          const restores = [
            tapService(workspace, 'startSession'),
            tapService(workspace, 'openWorkspace'),
            tapService(workspace, 'connectWorkspace'),
          ]
          return () => {
            for (const restore of restores) restore()
          }
        }

        if (typeof ctx.inject === 'function') {
          ctx.inject(['uiWorkspace'], (scope) => {
            const use = typeof scope.effect === 'function' ? scope.effect.bind(scope) : ctx.effect.bind(ctx)
            use(() => installTap(scope), 'hero-inspiration: new-session tap')
          })
        } else {
          ctx.effect(() => installTap(ctx), 'hero-inspiration: new-session tap')
        }
      },
    }
  },
})
