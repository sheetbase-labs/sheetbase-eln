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
 * `fetch` is the same door for code that expects fetch: relative paths under
 * `/operations/` reach this plugin's own operations, and nothing else.
 *
 *   const res = await fetch('/operations/viability', { method: 'POST', body: JSON.stringify({ live: 92, dead: 8 }) });
 *   const out = await res.json();
 *
 * Screens that fill in a form field call `setValue`, report sections call
 * `setSection`, and a table cell renderer registers with `onRender`. A page can
 * send the person to a place in Sheetbase with `navigate('/experiments')`.
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
  var renderer = null

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
    } else if (data.type === 'render' && renderer) {
      Promise.resolve()
        .then(function () {
          return renderer(data.cells || [], data.context || {})
        })
        .then(
          function (cells) {
            post({ type: 'rendered', id: data.id, cells: cells || [] })
          },
          function (error) {
            post({
              type: 'rendered',
              id: data.id,
              error: error && error.message ? String(error.message) : 'The renderer failed.',
            })
          },
        )
    } else if (data.type === 'result' && pending[data.id]) {
      var entry = pending[data.id]
      delete pending[data.id]
      if (data.ok) entry.resolve(data.output)
      else {
        var failure = new Error(data.error || 'That could not be done.')
        if (data.code) failure.code = data.code
        entry.reject(failure)
      }
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
    /** Keep this data with the block (up to 4 MiB of JSON). */
    setState: function (state) {
      post({ type: 'state', state: state })
    },
    /** Show a short message in Sheetbase. Tone: neutral, success, warning, danger or info. */
    notify: function (text, tone) {
      post({ type: 'notify', text: String(text), tone: tone || 'neutral' })
    },
    /**
     * fetch for this plugin's own operations: `/operations/<id>` with a JSON
     * body of inputs. Resolves with a Response whose JSON is the outputs, or
     * `{ error }` and a 4xx status. Any other address is refused.
     */
    fetch: function (url, init) {
      var path = String(url && url.url ? url.url : url)
      var match = /^(?:sheetbase:)?\/?operations\/([a-z][a-z0-9-]{0,48})\/?$/.exec(path.split('?')[0])
      if (!match) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Only /operations/<id> can be fetched here.' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      var body = {}
      try {
        if (init && typeof init.body === 'string' && init.body) body = JSON.parse(init.body)
      } catch (e) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'The body has to be JSON.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return api.call(match[1], body).then(
        function (output) {
          return new Response(JSON.stringify(output), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        },
        function (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        },
      )
    },
    /**
     * Ask Sheetbase to do something for this screen, as the person using it:
     * `blocks.list`, `blocks.insertBelow`, `files.list`, `files.read`,
     * `registry.models`, `registry.findDuplicates`, `registry.create`. The
     * plugin has to declare the matching `permissions` in plugin.json, and a
     * change asks the person first. Rejects with an Error (and `code`).
     */
    host: function (name, input) {
      return new Promise(function (resolve, reject) {
        counter += 1
        var id = 'h' + counter
        pending[id] = {
          resolve: resolve,
          reject: function (error) {
            reject(error)
          },
        }
        post({ type: 'host', id: id, name: String(name), input: input || {} })
      })
    },
    /** A form field's screen: give Sheetbase the field's new value (a string). */
    setValue: function (value) {
      post({ type: 'emit', name: 'value', payload: value })
    },
    /** A report section's screen: what to freeze into the report (a title and text). */
    setSection: function (section) {
      post({ type: 'emit', name: 'section', payload: section })
    },
    /** Go to a place in Sheetbase, such as `/experiments`. Same-site paths only. */
    navigate: function (path) {
      post({ type: 'navigate', path: String(path) })
    },
    /**
     * A table cell renderer: `fn(cells, context)` gets `[{ key, value }]` and
     * returns `[{ key, svg | image | text, tone }]` (an array or a promise of
     * one). `svg` is SVG markup, `image` a `data:image/png;base64,` URL.
     */
    onRender: function (fn) {
      renderer = fn
    },
    /** Ask for a height in pixels. Done for you as the content grows; call it to override. */
    resize: function (height) {
      post({ type: 'resize', height: Math.ceil(height) })
    },
  }
  window.sheetbase = api

  // Code that expects fetch gets the proxied door for /operations/<id>; data:
  // and blob: addresses still go to the browser, anything else is refused by
  // the frame's policy.
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null
  window.fetch = function (url, init) {
    var raw = String(url && url.url ? url.url : url)
    var path = raw
    try {
      var parsed = new URL(raw, 'https://plugin.invalid')
      if (/^(data|blob):/i.test(raw) && nativeFetch) return nativeFetch(url, init)
      path = parsed.pathname
    } catch (e) {
      /* not a URL */
    }
    if (/^\/operations\/|^sheetbase:/.test(path) || /^sheetbase:/.test(raw)) return api.fetch(path, init)
    return nativeFetch ? nativeFetch(url, init) : Promise.reject(new TypeError('Failed to fetch'))
  }

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
