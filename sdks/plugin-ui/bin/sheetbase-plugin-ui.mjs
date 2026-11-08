#!/usr/bin/env node
// sheetbase-plugin-ui build [folder]   build the screens in <folder>/ui-src into <folder>/ui
import { buildPluginUi } from '../build.mjs'

const [command, folder = '.'] = process.argv.slice(2)
if (command !== 'build') {
  console.error('Usage: sheetbase-plugin-ui build [plugin folder]')
  process.exit(command ? 2 : 0)
}
try {
  const files = await buildPluginUi({ dir: folder })
  for (const file of files) console.log(`ui/${file}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
