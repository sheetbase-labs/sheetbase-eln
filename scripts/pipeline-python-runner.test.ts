/**
 * PIPE-04.1 — collecting the files a Python step wrote.
 *
 * The runner copies the declared output directory out of the stopped container and reports
 * each file with its size. The container is only readable until it is removed, which is why
 * this happens between the run finishing and the cleanup.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ARTEFACT_KEY,
  LIMITS,
  collectOutputFiles,
} from './pipeline-python-runner.mjs'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'runner-artefacts-'))
  process.env.SHEETBASE_ARTEFACT_DIR = root
})

afterEach(async () => {
  delete process.env.SHEETBASE_ARTEFACT_DIR
  await rm(root, { recursive: true, force: true })
})

/** A fake docker CLI whose `cp` writes the files the step "produced". */
function dockerWriting(files: Record<string, string>) {
  return vi.fn(async (args: string[]) => {
    if (args[0] === 'cp') {
      const destination = args.at(-1)!
      for (const [name, contents] of Object.entries(files))
        await writeFile(join(destination, name), contents)
      return { code: 0, stdout: '', stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  })
}

describe('collectOutputFiles', () => {
  it('reports each file with its size, sorted by name', async () => {
    const files = await collectOutputFiles(
      dockerWriting({ 'b.csv': 'two,three', 'a.txt': 'one' }),
      'container-1',
      'run-1',
    )
    expect(files).toEqual([
      { name: 'a.txt', size: 3, path: expect.stringContaining('a.txt') },
      { name: 'b.csv', size: 9, path: expect.stringContaining('b.csv') },
    ])
  })

  it('reports nothing when the step wrote nothing', async () => {
    const command = vi.fn(async (args: string[]) => {
      // `docker cp` on a container with no output directory fails; that is not an error.
      if (args[0] === 'cp')
        return { code: 1, stdout: '', stderr: 'no such file' }
      return { code: 0, stdout: '', stderr: '' }
    })
    expect(await collectOutputFiles(command, 'container-1', 'run-1')).toEqual(
      [],
    )
  })

  it('refuses more files than the limit rather than truncating', async () => {
    const many: Record<string, string> = {}
    for (let index = 0; index <= LIMITS.files; index += 1)
      many[`f${index}.txt`] = 'x'
    await expect(
      collectOutputFiles(dockerWriting(many), 'container-1', 'run-1'),
    ).rejects.toThrow(/over the 20-file limit/)
  })

  it('refuses more bytes than the limit, naming the size', async () => {
    await expect(
      collectOutputFiles(
        dockerWriting({ 'big.bin': 'x'.repeat(LIMITS.fileBytes + 1) }),
        'container-1',
        'run-1',
      ),
    ).rejects.toThrow(/over the 8\.0 MiB limit/)
  })

  it('refuses a key that could escape the artefact root', async () => {
    expect(ARTEFACT_KEY.test('../../etc')).toBe(false)
    await expect(
      collectOutputFiles(dockerWriting({}), 'container-1', '../escape'),
    ).rejects.toThrow(/Invalid artefact key/)
  })
})
