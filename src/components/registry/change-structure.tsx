/**
 * Draw or change the structure of a registered compound. Saving goes through the
 * registry's own structure call, so the duplicate check keeps reading the
 * structure that is shown; the chemistry plugin shows the compound itself.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '#/components/ui/button'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { isDuplicateError, messageOf } from '#/lib/bio-registry'
import { describeStructure, setRecordStructure } from '#/lib/compound-registry'
import { notebookDataClient } from '#/lib/notebook-data'

import { StructureDialog } from './structure-input'
import { useOcl } from './use-ocl'

export function ChangeStructure({
  recordId,
  molfile,
  metadataVersion,
}: {
  recordId: string
  molfile: string
  metadataVersion: number
}) {
  const ocl = useOcl()
  const queryClient = useQueryClient()
  const [drawing, setDrawing] = useState(false)

  const change = useMutation({
    mutationFn: async (next: string) => {
      if (!ocl) throw new Error('')
      const described = describeStructure(ocl, next)
      if (!described) throw new Error(t('registry.chemistry.input.unreadable'))
      return setRecordStructure(notebookDataClient, {
        recordId,
        metadataVersion,
        descriptor: described,
        allowDuplicate: false,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries()
      toast.success(t('registry.chemistry.entry.saved'))
    },
    onError: (e: unknown) =>
      toast.error(
        isDuplicateError(e)
          ? t('registry.chemistry.entry.refused')
          : messageOf(e, t('registry.chemistry.entry.couldNotSave')),
      ),
  })

  return (
    <div>
      <Button
        disabled={change.isPending || !ocl}
        onClick={() => setDrawing(true)}
      >
        {molfile
          ? t('registry.chemistry.entry.change')
          : t('registry.chemistry.entry.draw')}
      </Button>
      <StructureDialog
        open={drawing}
        onOpenChange={setDrawing}
        initial={molfile}
        onUse={(next) => {
          if (next) change.mutate(next)
        }}
      />
    </div>
  )
}
