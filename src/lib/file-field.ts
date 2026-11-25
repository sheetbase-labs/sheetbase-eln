/**
 * File columns. An uploaded file is a record of the built-in `file` type, so
 * a File column is a link to a file record: the database checks it the way
 * it checks every link (the record must be in the workspace and be a file),
 * and the API, MCP, assistant, imports and pipelines treat it as a link with
 * no extra rules. The app shows it as "File" and lets people upload in place.
 */
import { useQuery } from '@tanstack/react-query'

import { createDataClient } from '#/lib/data-client'
import type { FieldRelationship } from '#/lib/field-definition'

/** The model key of uploaded files. */
export const FILE_MODEL_KEY = 'file'

/** What a File column links to. */
export const FILE_RELATIONSHIP: FieldRelationship = {
  target: { kind: 'model', modelKey: FILE_MODEL_KEY },
  cardinality: 'one',
}

/** True for a link to file records, which the app shows as a File column. */
export function isFileField(field: {
  logicalType?: string
  relationship?: { target?: { kind?: string; modelKey?: string } } | null
  validation?: { targetModelKey?: unknown } | null
}): boolean {
  if (field.logicalType !== 'reference') return false
  const target = field.relationship?.target

  if (target)
    return target.kind === 'model' && target.modelKey === FILE_MODEL_KEY

  // Older record-type fields name their target in validation only.
  return field.validation?.targetModelKey === FILE_MODEL_KEY
}

/**
 * The project a record belongs to, read only while a form shows a File field:
 * an upload is filed under that project. Null for a record with no project,
 * where only an existing file can be picked.
 */
export function useRecordProjectId(
  recordId: string,
  enabled: boolean,
): string | null {
  const { data } = useQuery({
    queryKey: ['file-field', 'record-project', recordId],
    queryFn: async () => {
      const rows = await createDataClient().list<{ project_id: string | null }>(
        'records',
        `?id=eq.${encodeURIComponent(recordId)}&select=project_id`,
      )

      return rows.at(0)?.project_id ?? null
    },
    staleTime: 60_000,
    enabled: enabled && recordId !== '',
  })

  return data ?? null
}
