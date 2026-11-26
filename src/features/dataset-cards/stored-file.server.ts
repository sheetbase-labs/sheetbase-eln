import type { ObjectStorage } from '#/lib/file-storage'
import type { ImportFileWire } from '#/lib/import/server'

/**
 * A workspace file's worksheet, read from storage for the import card. The
 * stored bytes are checked against the file's recorded size and checksum
 * before anything is read from them.
 */

export type StoredFile = ImportFileWire

export type StoredSheet =
  | { ok: true; headings: string[]; rowCount: number; sheetName: string }
  | { ok: false; message: string }

export async function readStoredSheet(
  file: StoredFile,
  sheet: string | undefined,
  storage?: ObjectStorage,
): Promise<StoredSheet> {
  try {
    // Loaded when a kept file is read: the storage settings are only needed then.
    const [{ readAndParse }, { getObjectStorage }] = await Promise.all([
      import('#/lib/import/server'),
      import('#/lib/file-storage'),
    ])

    const read = await readAndParse(
      storage ?? getObjectStorage(),
      file,
      sheet ?? null,
    )

    return {
      ok: true,
      headings: read.sheet.headers,
      rowCount: read.sheet.rows.length,
      sheetName: read.sheet.name,
    }
  } catch (error) {
    return {
      ok: false,
      message: `${file.filename} could not be read: ${error instanceof Error ? error.message : 'it may be damaged.'}`,
    }
  }
}
