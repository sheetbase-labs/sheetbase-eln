/**
 * The `.sbplugin` package rules. The shared cases in
 * `sdks/plugin-python/tests/package_cases.json` run here and in the Python
 * tests, so the app and the `sheetbase-plugin` command accept and refuse the
 * same packages.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { strToU8, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createDataClient } from '../data-client'
import { installExtension } from './client'
import {
  PluginPackageError,
  buildPluginPackage,
  hashPluginFiles,
  readPluginPackage,
} from './package'
import { pluginExamplesDir, readExample } from './testing/local-python'

const packageCases = z.array(
  z.object({
    name: z.string(),
    valid: z.boolean(),
    manifest: z.unknown(),
    files: z.record(z.string(), z.string()),
  }),
)

const cases = ['package_cases.json', 'point_cases.json'].flatMap((file) =>
  packageCases.parse(
    JSON.parse(
      readFileSync(path.join(pluginExamplesDir, '../tests', file), 'utf8'),
    ),
  ),
)

describe('shared package cases', () => {
  it.each(cases)('$name', ({ valid, manifest, files }) => {
    const all = { ...files, 'plugin.json': JSON.stringify(manifest) }

    if (valid) expect(() => buildPluginPackage(all)).not.toThrow()
    else expect(() => buildPluginPackage(all)).toThrow(PluginPackageError)
  })
})

describe('the examples', () => {
  it.each(readdirSync(pluginExamplesDir))('%s is a valid package', (name) => {
    const pkg = buildPluginPackage(readExample(name))
    expect(pkg.manifest.id).toMatch(/\./)
  })
})

describe('buildPluginPackage', () => {
  it('keeps author whitespace and declaration extras in the public install payload', async () => {
    const files = readExample('cell-count')

    const author = z
      .looseObject({
        provides: z.looseObject({ operations: z.array(z.looseObject({})) }),
      })
      .parse(JSON.parse(files['plugin.json']))

    author.name = '  Cell count Δμ  '
    author.description = '  Counts scientific samples.  '
    author.author = '  Acme Bio  '

    const operation = author.provides.operations[0]

    operation.title = '  Cell viability Δμ  '
    operation.future = { units: 'µL', threshold: 6.02e23 }

    const made = buildPluginPackage({
      ...files,
      'plugin.json': JSON.stringify(author),
    })

    expect(made.manifest.name).toBe('  Cell count Δμ  ')
    expect(made.manifest.description).toBe('  Counts scientific samples.  ')
    expect(made.manifest.author).toBe('  Acme Bio  ')
    expect(made.manifest.contributions.operations?.[0]).toMatchObject({
      title: '  Cell viability Δμ  ',
      future: { units: 'µL', threshold: 6.02e23 },
    })

    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({ id: 'ext-1' }),
    )

    await installExtension(createDataClient(transport), {
      workspaceId: 'ws-1',
      key: 'cell-count',
      name: made.manifest.name,
      version: made.manifest.version,
      source: made.manifest.source,
      manifest: made.manifest,
    })
    const body = JSON.parse(z.string().parse(transport.mock.calls[0][1]?.body))

    expect(body).toMatchObject({
      p_manifest: {
        name: '  Cell count Δμ  ',
        description: '  Counts scientific samples.  ',
        author: '  Acme Bio  ',
        contributions: {
          operations: expect.arrayContaining([
            expect.objectContaining({
              title: '  Cell viability Δμ  ',
              future: { units: 'µL', threshold: 6.02e23 },
            }),
          ]),
        },
      },
    })
  })

  it('turns the author form into the stored manifest', () => {
    const { manifest, examples } = buildPluginPackage(readExample('cell-count'))
    expect(manifest.source).toBe('package:acme.cell-count')
    expect(manifest.scopes).toEqual(['projects:read'])
    expect(manifest.contributions.operations?.[0]).toMatchObject({
      id: 'viability',
      access: 'read',
      runner: { kind: 'python', entry: 'counting:viability' },
    })
    expect(manifest.contributions.operations?.[0]).not.toHaveProperty('run')
    expect(manifest.author).toBe('Acme Bio')
    expect(examples).toHaveLength(2)
  })

  it('names every problem, not just the first', () => {
    const files = readExample('cell-count')
    const broken = JSON.parse(files['plugin.json'])
    broken.version = 'one'
    broken.ui = { entry: 'x' }
    broken.surprise = true

    try {
      buildPluginPackage({ ...files, 'plugin.json': JSON.stringify(broken) })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(PluginPackageError)

      if (!(error instanceof PluginPackageError)) throw error

      const { errors } = error

      expect(errors.some((e) => e.includes('semver'))).toBe(true)
      expect(
        errors.some((e) => e.includes('unknown key in plugin.json: ui')),
      ).toBe(true)
      expect(errors.some((e) => e.includes('surprise'))).toBe(true)
    }
  })

  it('refuses an unknown scope the Python check cannot know about', () => {
    const files = readExample('cell-count')

    const manifest = {
      ...JSON.parse(files['plugin.json']),
      permissions: ['everything:all'],
    }

    expect(() =>
      buildPluginPackage({ ...files, 'plugin.json': JSON.stringify(manifest) }),
    ).toThrow(/unknown scope/)
  })

  it('keeps the native label for an invalid object-valued declaration ID', () => {
    const files = readExample('cell-count')

    const author = {
      ...JSON.parse(files['plugin.json']),
      provides: { operations: [{ id: {}, run: 4 }] },
    }

    expect(() =>
      buildPluginPackage({ ...files, 'plugin.json': JSON.stringify(author) }),
    ).toThrow(
      /provides\.operations\.\[object Object\] run must look like module:function/,
    )
  })
})

describe('readPluginPackage', () => {
  const zipOf = (files: Record<string, string>) =>
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([k, v]) => [k, strToU8(v)]),
      ),
    )

  it('reads a zip and fingerprints the files', async () => {
    const files = readExample('cell-count')
    const pkg = await readPluginPackage(zipOf(files))
    expect(pkg.files).toEqual(files)
    expect(pkg.sha256).toBe(await hashPluginFiles(files))
    expect(pkg.sha256).toMatch(/^[0-9a-f]{64}$/)
    // Same files in another order are the same package.
    const reordered = Object.fromEntries(Object.entries(files).reverse())
    expect(await hashPluginFiles(reordered)).toBe(pkg.sha256)
    // A changed byte is a different one.
    expect(
      await hashPluginFiles({
        ...files,
        'python/counting.py': `${files['python/counting.py']}\n`,
      }),
    ).not.toBe(pkg.sha256)
  })

  it('refuses a zip-slip path, ui files nothing uses and things that are not text or zip', async () => {
    const files = readExample('cell-count')
    await expect(
      readPluginPackage(zipOf({ ...files, '../evil.py': 'x = 1\n' })),
    ).rejects.toThrow(PluginPackageError)
    await expect(
      readPluginPackage(zipOf({ ...files, 'ui/index.html': '<p></p>' })),
    ).rejects.toThrow(/ui\/ files need a screen/)
    await expect(readPluginPackage(strToU8('not a zip'))).rejects.toThrow(
      /readable zip/,
    )
    await expect(
      readPluginPackage(
        zipSync({
          ...Object.fromEntries(
            Object.entries(files).map(([k, v]) => [k, strToU8(v)]),
          ),
          'python/blob.py': new Uint8Array([0xff, 0xfe, 0xfd]),
        }),
      ),
    ).rejects.toThrow(/not text/)
  })

  it('refuses a package that expands too far before inflating it', async () => {
    const files = readExample('cell-count')
    const big = 'x = 1\n'.repeat(6_000_000)
    await expect(
      readPluginPackage(zipOf({ ...files, 'python/big.py': big })),
    ).rejects.toThrow(PluginPackageError)
  })
})
