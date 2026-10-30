/**
 * Read the text of files that were uploaded before their format could be
 * searched, so their contents turn up in search.
 *
 *   node --import tsx scripts/backfill-file-text.ts          # files never read
 *   node --import tsx scripts/backfill-file-text.ts --force  # read every file again
 *
 * Safe to run repeatedly. The app also runs this once in the background after
 * it starts, so it only needs running by hand to force a re-read.
 */
import { parseArgs } from 'node:util'

import {
  backfillFileText,
  connectForBackfill,
} from '../src/lib/file-text-backfill.server'

const { values } = parseArgs({ options: { force: { type: 'boolean' } } })
const conn = await connectForBackfill()
try {
  const result = await backfillFileText(conn, undefined, {
    force: values.force ?? false,
  })
  console.log(JSON.stringify(result))
} finally {
  await conn.end()
}
