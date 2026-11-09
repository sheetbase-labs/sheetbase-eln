// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { en } from '#/copy/en'
import { CORE_OPERATIONS } from '#/lib/operations/registry'
import { FEATURE_ASSISTANTS } from './assistant.gen'
import { FEATURE_ASSISTANT_SERVERS } from './assistant.server.gen'
import type { Feature, FeatureAssistant } from './define'
import { FEATURES } from './index.gen'

const DIR = join(process.cwd(), 'src/features')

const folders = readdirSync(DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

function hasCopy(path: string): boolean {
  let node: unknown = en

  for (const part of path.split('.')) {
    const object = z.record(z.string(), z.unknown()).safeParse(node)

    if (!object.success) return false

    node = object.data[part]
  }

  return z.string().safeParse(node).success
}

describe('feature folders', () => {
  it('are all in the generated indexes (run `pnpm generate` after adding one)', () => {
    const features: readonly Feature[] = FEATURES
    expect(features.map((feature) => feature.name)).toEqual(
      folders.filter((folder) => existsSync(join(DIR, folder, 'feature.ts'))),
    )
    expect(FEATURE_ASSISTANTS).toHaveLength(
      folders.filter((folder) => existsSync(join(DIR, folder, 'assistant.ts')))
        .length,
    )
    expect(FEATURE_ASSISTANT_SERVERS).toHaveLength(
      folders.filter((folder) =>
        existsSync(join(DIR, folder, 'assistant.server.ts')),
      ).length,
    )
  })

  it('name each feature after its folder', () => {
    for (const folder of folders) {
      if (!existsSync(join(DIR, folder, 'feature.ts'))) continue
      const features: readonly Feature[] = FEATURES
      expect(
        features.some((feature) => feature.name === folder),
        folder,
      ).toBe(true)
    }
  })

  it('put their operations in the registry', () => {
    const names = new Set(CORE_OPERATIONS.map((op) => op.name))
    const features: readonly Feature[] = FEATURES

    for (const feature of features)
      for (const op of feature.operations ?? [])
        expect(names.has(op.name), op.name).toBe(true)
  })

  it('have words in the copy catalogue for every card', () => {
    const assistants: readonly FeatureAssistant[] = FEATURE_ASSISTANTS

    for (const assistant of assistants)
      for (const [kind, key] of Object.entries(assistant.cardWords))
        for (const word of ['apply', 'applying', 'applied'])
          expect(hasCopy(`${key}.${word}`), `${kind}: ${key}.${word}`).toBe(
            true,
          )
  })

  it('claim each card kind once', () => {
    const seen = new Set<string>()
    const assistants: readonly FeatureAssistant[] = FEATURE_ASSISTANTS

    for (const assistant of assistants)
      for (const kind of Object.keys(assistant.cardWords)) {
        expect(seen.has(kind), kind).toBe(false)
        seen.add(kind)
      }
  })
})
