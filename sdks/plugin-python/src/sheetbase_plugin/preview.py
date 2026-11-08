"""A local stand-in for Sheetbase, to try a plugin's screens, pages and hooks.

``sheetbase-plugin preview`` serves a small page on your own machine:

* a plugin page (``ui/*.html``) runs in a sandboxed frame exactly as it does in
  Sheetbase, with the same ``sheetbase-ui.js``, a mock host that answers
  ``sheetbase.call`` by running your operations here, and the same message
  protocol (context, state, notify, resize);
* a Python screen is run with the event you press and its answer is checked with
  the same rules Sheetbase uses, so a problem shows here before an upload does;
* a computed column or action runs on rows you paste.

Nothing leaves your machine and it needs no account.
"""
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

from . import host
from .package import check_package, read_folder
from .ui import validate_screen

FRAME_CSP = (
    "default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'; "
    "img-src data: 'self'; font-src data: 'self'; connect-src 'none'"
)


def sdk_source():
    """The UI SDK Sheetbase injects into a page: bundled in the wheel, or the repository copy."""
    here = os.path.dirname(__file__)
    for candidate in (
        os.path.join(here, "sheetbase-ui.js"),
        os.path.join(here, "..", "..", "..", "plugin-ui", "sheetbase-ui.js"),
    ):
        if os.path.exists(candidate):
            with open(candidate, encoding="utf-8") as handle:
                return handle.read()
    raise FileNotFoundError("sheetbase-ui.js was not found next to this package")


def _manifest(files):
    return json.loads(files["plugin.json"])


def _entry(manifest, point, ident):
    for item in manifest.get("provides", {}).get(point, []):
        if item["id"] == ident:
            return item
    raise KeyError(f"no {point} entry called {ident}")


def run_hook(files, kind, ident, payload):
    """Run one hook the way Sheetbase does, in this process; the answer is what Sheetbase would draw or use."""
    manifest = _manifest(files)
    host.install({k[len("python/"):]: v for k, v in files.items() if k.startswith("python/")})
    if kind in ("block", "panel"):
        item = _entry(manifest, "blocks" if kind == "block" else "panels", ident)
        result = host.call_screen(item["screen"], payload)
        return {"result": result, "problems": validate_screen(result)}
    if kind == "column":
        item = _entry(manifest, "columns", ident)
        rows = payload["rows"]
        answer = host.call_column(item["run"], rows)
        problems = []
        if len(answer["values"]) != len(rows):
            problems.append(f"the column gave {len(answer['values'])} values for {len(rows)} rows")
        return {"result": answer, "problems": problems}
    if kind == "column-action":
        column = _entry(manifest, "columns", ident)
        item = next(a for a in column.get("actions", []) if a["id"] == payload["action"])
        return {"result": host.call_action(item["run"], payload), "problems": []}
    if kind == "row-action":
        item = _entry(manifest, "row-actions", ident)
        if item["selection"] == "one" and len(payload["rows"]) != 1:
            return {"result": None, "problems": ["this action is for exactly one row"]}
        return {"result": host.call_action(item["run"], payload), "problems": []}
    raise KeyError(f"unknown hook kind {kind}")


def run_call(files, operation, value):
    from .cli import run_operation

    return run_operation(files, operation, value)


_PAGE = """<!doctype html><meta charset="utf-8"><title>Sheetbase plugin preview</title>
<style>body{font:14px/1.5 system-ui;margin:24px auto;max-width:860px;padding:0 16px;color:#171717}
code,pre{font:12px ui-monospace,monospace;background:#f4f4f5;padding:2px 4px;border-radius:4px}pre{padding:10px;overflow:auto}
section{border:1px solid #d4d4d8;border-radius:8px;padding:12px 16px;margin:16px 0}h2{margin:0 0 6px;font-size:15px}
iframe{width:100%;border:1px solid #d4d4d8;border-radius:6px;height:80px;background:#fff}textarea{width:100%;font:12px ui-monospace,monospace}
button{font:inherit;padding:4px 12px}.bad{color:#b42318}.ok{color:#067647}#toast{position:fixed;right:16px;bottom:16px;background:#171717;color:#fff;padding:8px 12px;border-radius:6px;display:none}</style>
<h1>__NAME__</h1><p>Preview on your machine. Nothing is sent anywhere.</p><div id="out"></div><div id="toast"></div>
<script>
const items = __ITEMS__;
const out = document.getElementById('out');
const toast = (t) => { const e = document.getElementById('toast'); e.textContent = t; e.style.display = 'block'; setTimeout(() => e.style.display = 'none', 2500) };
const post = (url, body) => fetch(url, {method:'POST', body: JSON.stringify(body)}).then(r => r.json());
for (const item of items) {
  const s = document.createElement('section');
  s.innerHTML = '<h2></h2><div></div>'; s.querySelector('h2').textContent = item.title + ' · ' + item.kind;
  const box = s.querySelector('div'); out.append(s);
  if (item.ui) {
    const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts'); f.src = '/ui/' + item.ui; box.append(f);
    let state = null;
    const send = () => f.contentWindow.postMessage({sb:1, type:'context', theme:'light', tokens:{}, context:{recordId:'preview'}, state}, '*');
    window.addEventListener('message', async (e) => {
      if (e.source !== f.contentWindow || !e.data || e.data.sb !== 1) return;
      const m = e.data;
      if (m.type === 'ready') send();
      else if (m.type === 'resize') f.style.height = Math.min(Math.max(m.height, 40), 800) + 'px';
      else if (m.type === 'state') { state = m.state; }
      else if (m.type === 'notify') toast(m.text);
      else if (m.type === 'call') { const r = await post('/api/call', {operation: m.operation, input: m.input}); f.contentWindow.postMessage(r.error ? {sb:1,type:'result',id:m.id,ok:false,error:r.error} : {sb:1,type:'result',id:m.id,ok:true,output:r.output}, '*'); }
    });
  } else {
    const ta = document.createElement('textarea'); ta.rows = 4;
    ta.value = JSON.stringify(item.sample, null, 1); const go = document.createElement('button'); go.textContent = 'Run';
    const pre = document.createElement('pre'); box.append(ta, go, pre);
    go.onclick = async () => { const r = await post('/api/hook', {kind: item.kind, id: item.id, payload: JSON.parse(ta.value)});
      pre.innerHTML = ''; const p = document.createElement('div'); p.className = (r.problems||[]).length || r.error ? 'bad' : 'ok';
      p.textContent = r.error ? r.error : (r.problems||[]).length ? r.problems.join('; ') : 'Sheetbase would accept this.'; pre.append(p, JSON.stringify(r.result, null, 1)); };
  }
}
</script>"""


def _items(files):
    manifest = _manifest(files)
    provides = manifest.get("provides", {})
    items = []
    for kind, point in (("block", "blocks"), ("panel", "panels")):
        for entry in provides.get(point, []):
            if entry.get("ui") or entry.get("screen"):
                items.append({"kind": kind, "id": entry["id"], "title": entry["title"], "ui": entry.get("ui"),
                              "sample": {"context": {"recordId": "preview"}, "state": None, "event": None}})
    for entry in provides.get("columns", []):
        items.append({"kind": "column", "id": entry["id"], "title": entry["title"], "sample": {"rows": [{}]}})
        for action in entry.get("actions", []):
            items.append({"kind": "column-action", "id": entry["id"], "title": f"{entry['title']} · {action['title']}",
                          "sample": {"action": action["id"], "rows": [{}]}})
    for entry in provides.get("row-actions", []):
        items.append({"kind": "row-action", "id": entry["id"], "title": entry["title"], "sample": {"rows": [{}]}})
    return items


def make_handler(folder):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):  # quiet
            pass

        def _send(self, body, content_type, status=200, extra=None):
            data = body.encode("utf-8") if isinstance(body, str) else body
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            for name, value in (extra or {}).items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = unquote(urlparse(self.path).path)
            files = read_folder(folder)
            if path == "/":
                page = _PAGE.replace("__NAME__", json.dumps(_manifest(files)["name"])[1:-1])
                page = page.replace("__ITEMS__", json.dumps(_items(files)).replace("</", "<\\/"))
                return self._send(page, "text/html; charset=utf-8")
            if path.endswith("/sheetbase-ui.js"):
                return self._send(sdk_source(), "text/javascript; charset=utf-8")
            if path.startswith("/ui/") and path[4:] in files:
                name = path[4:]
                kind = "text/html; charset=utf-8" if name.endswith(".html") else "text/plain; charset=utf-8"
                if name.endswith(".js"):
                    kind = "text/javascript; charset=utf-8"
                elif name.endswith(".css"):
                    kind = "text/css; charset=utf-8"
                return self._send(files[name], kind, extra={"Content-Security-Policy": FRAME_CSP})
            self._send("Not found", "text/plain", 404)

        def do_POST(self):
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            files = read_folder(folder)
            try:
                if self.path == "/api/call":
                    answer = {"output": run_call(files, body["operation"], body["input"])}
                elif self.path == "/api/hook":
                    answer = run_hook(files, body["kind"], body["id"], body["payload"])
                else:
                    return self._send("Not found", "text/plain", 404)
            except Exception as error:  # the plugin's own refusal or crash, shown as it is
                answer = {"error": str(error.args[0] if isinstance(error, KeyError) and error.args else error)}
            self._send(json.dumps(answer, default=str), "application/json")

    return Handler


def serve(folder, port=8765, once=False):
    errors = check_package(read_folder(folder))
    if errors:
        for problem in errors:
            print(f"  ✗ {problem}")
        return 1
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(folder))
    print(f"Preview at http://127.0.0.1:{server.server_address[1]}/  (Ctrl-C to stop)")
    if once:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return server
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0
