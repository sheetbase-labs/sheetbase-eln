import { useQuery } from '@tanstack/react-query'

import { parseSequenceFile } from '#/lib/sequence'
import type { ParsedSequence } from '#/lib/sequence'

/** Download a stored file and read it as GenBank or FASTA. */
export async function loadSequenceFile(
  fileRecordId: string,
): Promise<ParsedSequence[]> {
  const res = await fetch(`/api/files/${fileRecordId}/download`)

  if (!res.ok) throw new Error(`The file could not be opened (${res.status}).`)

  return parseSequenceFile(await res.text())
}

export function useSequenceFile(fileRecordId: string) {
  return useQuery({
    queryKey: ['ui-port', 'sequence-file', fileRecordId],
    queryFn: () => loadSequenceFile(fileRecordId),
    staleTime: 5 * 60_000,
  })
}
