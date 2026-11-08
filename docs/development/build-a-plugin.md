# Build a plugin

A plugin adds work to Sheetbase in Python. This page takes one from nothing to
installed, once from the author's side and once from the scientist's. The
reference is [the plugins API page](../api/plugins-api.md); the runnable example
is `sdks/plugin-python/examples/cell-count`.

## What you can add

- **Operations**: something your lab can ask for. Inputs in, outputs back. One
  declaration becomes an assistant tool, an MCP tool, a pipeline action and an
  API route; you write none of those.
- **Analysis kinds**: a Python analysis the analysis block offers next to the
  built-in ones, with a result table and an optional chart.

Plugins are Python only for now. They cannot bring their own screens yet (the
`ui` slot in the manifest is reserved), and they cannot read your data unless a
call hands it to them: the code runs in an isolated sandbox with no network, no
database and no files but its own.

## As the author

Install the helper and make a folder to start from:

```sh
pip install sheetbase-plugin        # from sdks/plugin-python in this repository
sheetbase-plugin init cell-count
cd cell-count
```

You get a manifest and one function.

`plugin.json` says what the plugin adds:

```json
{
  "id": "acme.cell-count",
  "name": "Cell count",
  "version": "1.0.0",
  "description": "Viability and seeding volume from a cell count.",
  "provides": {
    "operations": [
      {
        "id": "viability",
        "title": "Cell viability",
        "description": "Gives the percentage of live cells from a live and a dead count.",
        "access": "read",
        "inputs": [
          { "name": "live", "type": "integer", "required": true },
          { "name": "dead", "type": "integer", "required": true }
        ],
        "outputs": [
          { "name": "viability", "type": "number", "required": true },
          { "name": "total", "type": "integer", "required": true }
        ],
        "run": "counting:viability"
      }
    ]
  },
  "examples": [
    {
      "operation": "viability",
      "input": { "live": 92, "dead": 8 },
      "output": { "viability": 92.0, "total": 100 }
    }
  ]
}
```

`python/counting.py` is plain Python:

```python
from sheetbase_plugin import PluginError

def viability(input):
    live, dead = input["live"], input["dead"]
    if live + dead == 0:
        raise PluginError("Count at least one cell.")
    return {"viability": round(100 * live / (live + dead), 1), "total": live + dead}
```

The `description` matters: the assistant reads it to decide when to use the
operation. `PluginError` is for expected problems; the message is shown to the
person as written.

Try it as you write:

```sh
sheetbase-plugin dev .     # checks the files and runs the examples on every save
sheetbase-plugin run viability --input '{"live": 0, "dead": 0}'
sheetbase-plugin pack .    # acme.cell-count-1.0.0.sbplugin
```

`run` and `dev` use the same loader the app uses, so what passes here runs there,
but on your machine there is no sandbox: keep the plugin to the standard library
and the packages the Sheetbase Python runner provides (pandas and NumPy).

## As the scientist

An owner or administrator opens **Settings → Plugins**, chooses **Add a plugin**
and picks the file. Sheetbase reads it and shows, before anything is added:

- what it is and who made it;
- what it asks for, in plain words (it runs its own Python in a sandbox with no
  network; any access it declares);
- what it adds: "Cell viability · reads", "Seeding volume · reads";
- for an update, what is new and what was dropped.

They tick that they have read it and trust it, and add it. It stays off until
they switch it on, and each part (operations, analyses) has its own switch.

From then on, with no further work from the author:

- the assistant answers "what's the viability if I counted 92 live and 8 dead?"
  by calling the operation, and shows a confirm card for anything that writes;
- an agent over MCP sees the same tool, and a write waits in the Inbox under the
  workspace's agent policy;
- a pipeline step can use "Cell viability" like any built-in action;
- a script can call it:

```sh
curl -X POST https://your-sheetbase/api/plugins/cell-count/viability \
  -H "Authorization: Bearer $SHEETBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input": {"live": 92, "dead": 8}}'
```

```python
from sheetbase import Client
Client(...).plugins.call("cell-count", "viability", {"live": 92, "dead": 8})
```

Every call is audited with the plugin and the SHA-256 of the code that ran.

## Updating

Pack a new version (change `version`) and add it the same way. Sheetbase
recognises the plugin id, shows what changed, replaces the code and switches the
plugin off until an administrator has looked at it again.

## Limits

100 files, 512 KiB each, 2 MiB in all, 4 MiB for the zip; 25 operations and 25
analysis kinds per plugin; 24 fields per declaration. A call has 60 seconds and
the runner's memory limit, like any pipeline Python step.
