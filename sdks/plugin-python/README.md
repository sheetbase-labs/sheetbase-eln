# sheetbase-plugin

Write, try and pack Python plugins for Sheetbase.

```sh
pip install sheetbase-plugin
sheetbase-plugin init my-plugin      # a small plugin to start from
sheetbase-plugin dev my-plugin       # check it and run its examples on every change
sheetbase-plugin try column grade --payload '{"rows":[{"viability":95}]}'   # run one screen, column or action
sheetbase-plugin preview my-plugin   # a local page: plugin pages in the sandboxed frame, screens, hooks
sheetbase-plugin run viability --folder my-plugin --input '{"live": 92, "dead": 8}'
sheetbase-plugin pack my-plugin      # makes my-plugin-0.1.0.sbplugin
```

Upload the `.sbplugin` file in Sheetbase under Settings › Plugins (owners and
administrators only). The full guide, with a worked example, is in
`docs/development/build-a-plugin.md` in the Sheetbase repository.

A plugin is a folder:

```
plugin.json     what it adds: operations and analyses, each pointing at a function
python/ops.py   the functions, plain Python
```

Plugin code runs in Sheetbase's isolated Python runner: no access to the database,
no files except the plugin's own, and no network except the hosts the administrator
approved from the `python.network` list in `plugin.json`. Any pip package you list in
`python.requirements` is installed for it when it is added (install the same ones
locally to try it); how much time, memory and data a call may use is the
administrator's per-plugin setting. `sheetbase-plugin run` runs the
same loader on your machine so what you try is what runs there, but without the
isolation, so keep your own machine's network and files out of the plugin.
