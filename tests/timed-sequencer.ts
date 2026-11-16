/**
 * Shards test files by measured run time instead of by count, and starts the
 * longest first.
 *
 * Vitest's default shard splits files evenly by number, so a handful of
 * minute-long files can land together and set the wall time for the whole
 * run. Here each file goes, longest first, to the shard with the least work so
 * far (greedy bin packing). Every file still runs in exactly one shard, and the
 * assignment depends only on the file list and the timings, so it is the same
 * on every machine.
 *
 * Times come from a committed JSON file of `{ "<path>": seconds }`; a file not
 * in it counts as UNKNOWN_SECONDS. Refresh it with
 * `node scripts/update-test-timings.mjs <report.json>...` from the reports the
 * CI test jobs upload.
 */
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'

import type { TestSpecification } from 'vitest/node'
import { BaseSequencer } from 'vitest/node'

const UNKNOWN_SECONDS = 2

export function packShards(
  files: readonly string[],
  seconds: (file: string) => number,
  count: number,
): string[][] {
  const ordered = [...files].sort(
    (a, b) => seconds(b) - seconds(a) || (a < b ? -1 : a > b ? 1 : 0),
  )

  const shards: { total: number; files: string[] }[] = Array.from(
    { length: count },
    () => ({ total: 0, files: [] }),
  )

  for (const file of ordered) {
    let lightest = shards[0]

    for (const shard of shards)
      if (shard.total < lightest.total) lightest = shard
    lightest.files.push(file)
    lightest.total += seconds(file)
  }

  return shards.map((shard) => shard.files)
}

export function timedSequencer(timingsFile: string) {
  let timings: Record<string, number> = {}

  try {
    // SAFETY: the file is written only by scripts/update-test-timings.mjs as
    // a flat object of path to seconds; a missing file falls through below.
    timings = JSON.parse(readFileSync(timingsFile, 'utf8')) as Record<
      string,
      number
    >
  } catch {
    // No timings yet: every file counts the same, which still shards evenly.
  }

  return class TimedSequencer extends BaseSequencer {
    private key(spec: TestSpecification) {
      return relative(this.ctx.config.root, spec.moduleId)
    }

    private seconds = (file: string) => timings[file] ?? UNKNOWN_SECONDS

    override async shard(files: TestSpecification[]) {
      const shard = this.ctx.config.shard

      if (!shard) return files

      const byKey = new Map(files.map((spec) => [this.key(spec), spec]))
      const packed = packShards([...byKey.keys()], this.seconds, shard.count)

      return packed[shard.index - 1].map((file) => byKey.get(file)!)
    }

    // Longest first, so a long file starts at once instead of after the
    // short ones and finishing last.
    override async sort(files: TestSpecification[]) {
      return [...files].sort(
        (a, b) => this.seconds(this.key(b)) - this.seconds(this.key(a)),
      )
    }
  }
}
