/*!
 * Sheetbase plugin UI SDK.
 *
 * A plugin's UI bundle runs in a sandboxed frame: no cookies, no network, no
 * view of the page around it. This file is the only way out. Sheetbase puts it
 * into every bundle (include it with `<script src="sheetbase-ui.js"></script>`)
 * and `sheetbase-plugin dev` serves the same file.
 *
 *   sheetbase.onContext((context, state) => { ... });  // what to draw
 *   sheetbase.setState({ lanes: [...] });              // keep it with the block
 *   const out = await sheetbase.call('viability', { live: 92, dead: 8 });
 *   sheetbase.notify('Saved', 'success');
 *
 * `call` runs one of the plugin's own operations, as the person using the page.
 * A read answers straight away. An operation that changes something makes
 * Sheetbase ask the person first; if they decline, the promise rejects.
 *
 * Messages are plain JSON; nothing here runs code from outside the frame.
 */
(function () {
  'use strict'
  var VERSION = 1
  var listeners = []
  var pending = {}
  var counter = 0
  var latest = null
  var parentWindow = window.parent

  function post(message) {
    message.sb = VERSION
    parentWindow.postMessage(message, '*')
  }

  function applyTheme(theme, tokens) {
    var root = document.documentElement
    root.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light')
    root.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
    if (tokens && typeof tokens === 'object') {
      Object.keys(tokens).forEach(function (name) {
        if (/^--sb-[a-z0-9-]+$/.test(name)) root.style.setProperty(name, tokens[name])
      })
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== parentWindow) return
    var data = event.data
    if (!data || data.sb !== VERSION || typeof data.type !== 'string') return
    if (data.type === 'context') {
      applyTheme(data.theme, data.tokens)
      latest = { context: data.context, state: data.state }
      listeners.slice().forEach(function (fn) {
        fn(latest.context, latest.state)
      })
    } else if (data.type === 'result' && pending[data.id]) {
      var entry = pending[data.id]
      delete pending[data.id]
      if (data.ok) entry.resolve(data.output)
      else entry.reject(new Error(data.error || 'That could not be done.'))
    }
  })

  var api = {
    version: VERSION,
    /** Called with (context, state) now (if already known) and whenever Sheetbase sends new ones. */
    onContext: function (fn) {
      listeners.push(fn)
      if (latest) fn(latest.context, latest.state)
    },
    /** Run one of this plugin's operations. Resolves with its outputs. */
    call: function (operation, input) {
      return new Promise(function (resolve, reject) {
        counter += 1
        var id = 'c' + counter
        pending[id] = { resolve: resolve, reject: reject }
        post({ type: 'call', id: id, operation: String(operation), input: input || {} })
      })
    },
    /** Keep this data with the block (up to 64 KiB of JSON). */
    setState: function (state) {
      post({ type: 'state', state: state })
    },
    /** Show a short message in Sheetbase. Tone: neutral, success, warning, danger or info. */
    notify: function (text, tone) {
      post({ type: 'notify', text: String(text), tone: tone || 'neutral' })
    },
    /** Ask for a height in pixels. Done for you as the content grows; call it to override. */
    resize: function (height) {
      post({ type: 'resize', height: Math.ceil(height) })
    },
  }
  window.sheetbase = api

  function reportHeight() {
    post({
      type: 'resize',
      height: Math.ceil(document.documentElement.getBoundingClientRect().height),
    })
  }
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(reportHeight).observe(document.documentElement)
  }
  window.addEventListener('load', function () {
    reportHeight()
    post({ type: 'ready' })
  })
})()
