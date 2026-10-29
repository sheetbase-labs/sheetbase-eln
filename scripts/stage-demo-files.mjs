#!/usr/bin/env node
/**
 * Puts the demo's instrument files into the app's own object store.
 *
 * The design seed records files that instruments sent, but it runs somewhere
 * other than the app, so the bytes would never reach the app's storage and
 * "Try again" on an intake problem would find nothing to read. This copies
 * them in at start-up. It only runs on the auth-free demo, and never
 * overwrites a file that is already there.
 */
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.env.SHEETBASE_DEV_AUTH_FREE !== 'true') process.exit(0)

const WORKSPACE = '00000000-0000-4000-8000-000000000300'
const here = dirname(fileURLToPath(import.meta.url))
const files = JSON.parse(
  await readFile(resolve(here, '../src/db/seed/demo-files.json'), 'utf8'),
)
const root = resolve(process.env.FILE_STORAGE_DIR ?? './.storage/objects')

for (const file of files) {
  const key = `${WORKSPACE}/${file.id}/${createHash('md5').update(file.id).digest('hex')}`
  const target = resolve(root, key)
  const present = await access(target).then(
    () => true,
    () => false,
  )
  if (present) continue
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, file.text, 'utf8')
}
