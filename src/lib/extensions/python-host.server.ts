/**
 * Builds the Python step that runs one function of a plugin.
 *
 * The plugin's files are carried inside the step, next to the host loader from
 * the Python SDK (`sdks/plugin-python`). Nothing is read from disk or from the
 * network in the runner: the loader serves `import` from those files and from
 * the Python standard library, and the runner container has no network. The
 * same `host.py` runs on an author's machine under `sheetbase-plugin run`, so
 * what they try is what runs here.
 */
import hostSource from '../../../sdks/plugin-python/src/sheetbase_plugin/host.py?raw'
import uiSource from '../../../sdks/plugin-python/src/sheetbase_plugin/ui.py?raw'
import initSource from '../../../sdks/plugin-python/src/sheetbase_plugin/__init__.py?raw'

/** The step source for a package: `parameters.kind` picks an operation, an analysis, a screen, a column or an action. */
export function pluginStatement(files: Record<string, string>): string {
  const modules: Record<string, string> = {
    'sheetbase_plugin/__init__.py': initSource,
    'sheetbase_plugin/host.py': hostSource,
    'sheetbase_plugin/ui.py': uiSource,
  }
  for (const [path, source] of Object.entries(files)) {
    if (path.startsWith('python/'))
      modules[path.slice('python/'.length)] = source
  }
  // A JSON string is also a valid Python string literal.
  const literal = JSON.stringify(JSON.stringify(modules))
  return `import json as _json

_FILES = _json.loads(${literal})
_host = {}
exec(compile(_FILES["sheetbase_plugin/host.py"], "sheetbase_plugin/host.py", "exec"), _host)
_host["install"](_FILES)


def transform(inputs, parameters):
    kind = parameters["kind"]
    if kind == "analysis":
        return _host["call_analysis"](parameters["entry"], inputs["data"])
    if kind == "screen":
        return [_host["call_screen"](parameters["entry"], parameters["input"])]
    if kind == "column":
        return [_host["call_column"](parameters["entry"], inputs["data"])]
    if kind == "action":
        return [_host["call_action"](parameters["entry"], parameters["input"])]
    return [_host["call_operation"](parameters["entry"], parameters["input"])]
`
}
