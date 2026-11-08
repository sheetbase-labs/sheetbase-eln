# Plugin UI SDK

What a plugin's screens use inside Sheetbase's sandboxed frame, and the tool that
builds them.

- `sheetbase-ui.js`: the `sheetbase` global the server adds to every plugin
  screen (context, a proxied `fetch` to the plugin's own operations, state,
  `setValue`, `setSection`, `navigate`, `table`, `onRender`).
- `sheetbase-ui.d.ts`: its TypeScript types. Reference it from `tsconfig.json`.
- `bin/sheetbase-plugin-ui.mjs build <plugin folder>`: bundles the screens in
  `ui-src/` (TypeScript or JavaScript, with npm imports) into the plain files
  in `ui/` that go into the package. The same input always gives the same
  output. See `docs/development/build-a-plugin.md`.

A complete example is `sdks/plugin-python/examples/sequence-tools`. It needs
`npm install` inside its `ui-src/` before the first build.
