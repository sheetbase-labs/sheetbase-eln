import { downloadTextFile } from '#/lib/download'

/** One lineage row as the sample's surfaces render it. */
export interface LineageCsvRow {
  identifier: string
  title: string | null
  relation: string | null
  status: string | null
}

/**
 * LAB-03 — the export behind "Export lineage" on the sample header and the
 * Lineage tab. There is no server-side export job, so the file is written from
 * the lineage the caller already rendered; it returns false when there is
 * nothing to write, so the caller can say so rather than promise a link. A
 * browser that refuses the download throws, so the caller states that too.
 */
export function downloadLineageCsv(
  identifier: string,
  rows: LineageCsvRow[],
): boolean {
  if (rows.length === 0) return false

  const lines = rows.map((row) =>
    [row.identifier, row.title, row.relation, row.status]
      .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
      .join(','),
  )

  downloadTextFile(
    `${identifier}-lineage.csv`,
    ['sample,title,relation,status', ...lines].join('\n'),
    'text/csv',
  )

  return true
}
