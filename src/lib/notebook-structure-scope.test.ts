import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MutationObserver, QueryClient } from '@tanstack/react-query'

import { NOTEBOOK_STRUCTURE_SCOPE } from './notebook-structure-scope'

/**
 * The notebook's structure version. A change reads the version when it starts
 * and is refused if another change moved it before it finished, as the
 * database does for insert, move and delete. Pressing Alt+ArrowUp then
 * Alt+Enter sent the insert with the version read before the move finished,
 * and the insert was refused.
 */
class Structure {
  version = 0
  committed: string[] = []

  change(name: string, duration: number): Promise<string> {
    const read = this.version

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (read !== this.version) {
          reject(new Error(`${name} refused as stale`))

          return
        }

        this.version += 1
        this.committed.push(name)
        resolve(name)
      }, duration)
    })
  }
}

/** What the notebook page does: a mutation in the shared scope, as `useMutation` makes it. */
function mutate(client: QueryClient, change: () => Promise<string>) {
  return new MutationObserver(client, {
    mutationFn: change,
    scope: NOTEBOOK_STRUCTURE_SCOPE,
  }).mutate()
}

interface Scenario {
  durations: number[]
  gaps: number[]
}

/** Every way of pressing up to four changes, each lasting 1 to 3 ticks and pressed 0 to 2 ticks apart. */
function scenarios(): Scenario[] {
  const all: Scenario[] = []
  const values = [1, 2, 3]
  const gaps = [0, 1, 2]

  function extend(durations: number[], between: number[]) {
    if (durations.length >= 2) all.push({ durations, gaps: between })

    if (durations.length === 4) return

    for (const duration of values) {
      for (const gap of durations.length === 0 ? [0] : gaps) {
        extend(
          [...durations, duration],
          durations.length === 0 ? [] : [...between, gap],
        )
      }
    }
  }

  extend([], [])

  return all
}

async function play(
  scenario: Scenario,
  submit: (
    structure: Structure,
    name: string,
    duration: number,
  ) => Promise<string>,
) {
  const structure = new Structure()
  const results: Array<PromiseSettledResult<string>> = []
  const pending: Array<Promise<string>> = []

  for (const [index, duration] of scenario.durations.entries()) {
    const name = `change ${index}`
    const call = submit(structure, name, duration)

    pending.push(call)

    call.then(
      (value) => results.push({ status: 'fulfilled', value }),
      (reason: Error) => results.push({ status: 'rejected', reason }),
    )

    await vi.advanceTimersByTimeAsync((scenario.gaps[index] ?? 0) * 10)
  }

  await vi.runAllTimersAsync()
  await Promise.allSettled(pending)

  return { structure, results }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('changes to the notebook structure', () => {
  const all = scenarios()

  it('are refused as stale when they run side by side', async () => {
    let refused = 0

    for (const scenario of all) {
      const { results } = await play(scenario, (structure, name, duration) =>
        structure.change(name, duration * 10),
      )

      if (results.some((result) => result.status === 'rejected')) refused += 1
    }

    expect(refused).toBeGreaterThan(0)
  })

  it('are never refused when they share the notebook structure scope, and land in the order they were pressed', async () => {
    for (const scenario of all) {
      const client = new QueryClient()

      const { structure, results } = await play(
        scenario,
        (target, name, duration) =>
          mutate(client, () => target.change(name, duration * 10)),
      )

      const label = JSON.stringify(scenario)

      expect(
        results.filter((result) => result.status === 'rejected'),
        label,
      ).toEqual([])
      expect(structure.committed, label).toEqual(
        scenario.durations.map((_, index) => `change ${index}`),
      )
    }
  })
})

describe('the notebook page', () => {
  const page = readFileSync(
    join(process.cwd(), 'src/routes/records/$recordId/-notebook-page.tsx'),
    'utf8',
  )

  it.each([
    'insertMutation',
    'duplicateMutation',
    'deleteMutation',
    'undoDeleteMutation',
    'moveMutation',
  ])('puts %s in the structure scope', (name) => {
    const start = page.indexOf(`const ${name} = useMutation({`)

    expect(start, `${name} is gone: update this list`).toBeGreaterThan(-1)
    expect(
      page.slice(start, start + 120),
      `${name} changes the notebook structure: add scope: NOTEBOOK_STRUCTURE_SCOPE`,
    ).toContain('scope: NOTEBOOK_STRUCTURE_SCOPE')
  })
})
