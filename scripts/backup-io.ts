import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Readable, Writable } from 'node:stream'
import { backupManifestSchema } from '../src/lib/backup'

/** Wait for both the process and its streams, including gzip's final flush. */
export async function run(
  command: string,
  args: string[],
  options: {
    input?: Readable
    output?: Writable
    env?: NodeJS.ProcessEnv
  } = {},
): Promise<void> {
  const child = spawn(command, args, {
    env: options.env ?? process.env,
    stdio: [
      options.input ? 'pipe' : 'ignore',
      options.output ? 'pipe' : 'ignore',
      'inherit',
    ],
  })
  const exited = new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with status ${code}`)),
    )
  })
  await Promise.all([
    exited,
    ...(options.input && child.stdin
      ? [pipeline(options.input, child.stdin)]
      : []),
    ...(options.output && child.stdout
      ? [pipeline(child.stdout, options.output)]
      : []),
  ])
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

export async function atomicWrite(
  path: string,
  body: string,
  mode = 0o600,
): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, body, { mode, flag: 'wx' })
  await chmod(temporary, mode)
  await rename(temporary, path)
}

export async function verifyBackupSet(
  manifestPath: string,
  requireObjects = true,
) {
  const manifest = backupManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, 'utf8')),
  )
  if (requireObjects && !manifest.objects)
    throw new Error('backup set has no object archive')
  const directory = dirname(manifestPath)
  const dump = join(directory, `${manifest.prefix}-db.sql.gz`)
  const objects = manifest.objects
    ? join(directory, `${manifest.prefix}-objects.tar.gz`)
    : undefined
  for (const [path, bytes, hash] of [
    [dump, manifest.database.dumpBytes, manifest.database.dumpSha256],
    ...(objects && manifest.objects
      ? [
          [
            objects,
            manifest.objects.archiveBytes,
            manifest.objects.archiveSha256,
          ] as const,
        ]
      : []),
  ] as const) {
    if ((await stat(path)).size !== bytes || (await sha256File(path)) !== hash)
      throw new Error('backup artifact size or sha256 does not match manifest')
  }
  return { manifest, dump, objects }
}

/** Only archives from our producer, with directories and regular files, are accepted. */
export async function extractObjects(archive: string, directory: string) {
  // Inspect before extraction, so tar cannot follow an archive symlink or write outside the store.
  const { execFileSync } = await import('node:child_process')
  const listing = execFileSync('tar', ['-tzf', archive], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  for (const name of listing.trimEnd().split('\n')) {
    if (name.startsWith('/') || name.split('/').includes('..'))
      throw new Error('unsafe object archive path')
  }
  const types = execFileSync('tar', ['-tvzf', archive], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (
    types
      .trimEnd()
      .split('\n')
      .some((line) => !['d', '-'].includes(line[0]))
  )
    throw new Error('object archive contains links or special files')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await run('tar', [
    '-xzf',
    archive,
    '--no-same-owner',
    '--no-same-permissions',
    '-C',
    directory,
  ])
  const entries: { name: string; size: number; sha256: string }[] = []
  async function walk(dir: string): Promise<void> {
    for (const name of await readdir(dir)) {
      const full = join(dir, name)
      const info = await lstat(full)
      if (info.isDirectory()) await walk(full)
      else if (info.isFile())
        entries.push({
          name: full.slice(directory.length + 1),
          size: info.size,
          sha256: await sha256File(full),
        })
      else throw new Error('object store contains a non-regular file')
    }
  }
  await walk(directory)
  return entries
}
