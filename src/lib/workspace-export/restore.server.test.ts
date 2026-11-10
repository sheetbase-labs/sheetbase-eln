// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import type { ObjectStorage } from '#/lib/file-storage/types'

import { restoreWorkspaceArchive } from './restore.server'

const unusedStorage: ObjectStorage = {
  async putStream() {
    throw new Error('dry run must not write files')
  },
  async getStream() {
    throw new Error('dry run must not read storage')
  },
  async head() {
    throw new Error('dry run must not inspect storage')
  },
  async delete() {
    throw new Error('dry run must not delete files')
  },
}

async function dryRun(manifest: z.core.util.JSONType) {
  const directory = await mkdtemp(join(tmpdir(), 'sheetbase-manifest-test-'))

  try {
    const zipPath = join(directory, 'archive.zip')
    await writeFile(
      zipPath,
      zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) }),
    )

    return await restoreWorkspaceArchive({
      zipPath,
      dryRun: true,
      storage: unusedStorage,
      connect: async () => {
        throw new Error('dry run must not connect')
      },
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('workspace archive manifest', () => {
  it('accepts missing and falsy paths and hashes with extra metadata', async () => {
    const report = await dryRun({
      kind: 'sheetbase-workspace-export',
      formatVersion: 1,
      workspace: { id: 'workspace', custom: 'retained' },
      generator: { version: 'custom' },
      tables: [
        { name: 'api.a', rows: 0, droppedColumns: [] },
        { name: 'api.b', rows: 0, path: false, sha256: 0, droppedColumns: [] },
        {
          name: 'api.c',
          rows: 0,
          path: 'unused',
          sha256: '',
          droppedColumns: [],
        },
      ],
      files: [
        { status: 'missing' },
        { id: 'empty', status: 'ok', path: '', sha256: false },
        { id: 'zero', status: 'ok', path: 0, sha256: null },
      ],
    })

    expect(report).toMatchObject({
      workspaceId: 'workspace',
      tables: [],
      files: 0,
      missingFiles: 3,
      dryRun: true,
    })
  })

  it('checks archive identity before validating required structure', async () => {
    await expect(dryRun({ kind: 'other', formatVersion: 1 })).rejects.toThrow(
      'This is not a Sheetbase workspace archive.',
    )
    await expect(
      dryRun({ kind: 'sheetbase-workspace-export', formatVersion: 2 }),
    ).rejects.toThrow('This is not a Sheetbase workspace archive.')
    await expect(
      dryRun({ kind: 'sheetbase-workspace-export', formatVersion: 1 }),
    ).rejects.toThrow()
    await expect(
      dryRun({
        kind: 'sheetbase-workspace-export',
        formatVersion: 1,
        workspace: { id: 'workspace' },
        tables: 'not-an-array',
        files: [],
      }),
    ).rejects.toThrow()
  })
})
