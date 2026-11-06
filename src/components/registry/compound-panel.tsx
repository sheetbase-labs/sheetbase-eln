/**
 * What a compound entry shows on its page: the structure and its parent, a way
 * to change it, and its lots. Shown for any registry model that takes
 * structures.
 */
import { ObjectLink } from '#/components/ui/object-link'
import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Muted, Section } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { isDuplicateError, messageOf } from '#/lib/bio-registry'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  addCompoundLot,
  compoundKeys,
  describeStructure,
  listCompoundLots,
  setRecordStructure,
  parentSvg,
} from '#/lib/compound-registry'
import type { CompoundLot, StructureRow } from '#/lib/compound-registry'

import {
  MolfilePicture,
  StructureDialog,
  StructurePicture,
} from './structure-input'
import { useOcl } from './use-ocl'

const client = notebookDataClient

export function CompoundPanel({
  recordId,
  identifier,
  kind,
  molfile,
  metadataVersion,
  lotKind,
  canWrite,
}: {
  recordId: string
  identifier: string
  kind: string
  molfile: string
  metadataVersion: number
  lotKind: string | null
  canWrite: boolean
}) {
  const ocl = useOcl()
  const queryClient = useQueryClient()
  const [drawing, setDrawing] = useState(false)
  const [addingLot, setAddingLot] = useState(false)

  const row = useQuery({
    queryKey: [...compoundKeys.all, 'row', recordId, metadataVersion],
    queryFn: async () => {
      const rows = await client.list<StructureRow>(
        'record_structures',
        `?record_id=eq.${recordId}&select=record_id,parent_code,drawn_code,formula,mass,salts`,
      )
      return rows[0] ?? null
    },
    staleTime: 10_000,
  })
  const lots = useQuery({
    queryKey: compoundKeys.lots(recordId),
    queryFn: () => listCompoundLots(client, recordId),
    enabled: Boolean(lotKind),
    staleTime: 10_000,
  })

  const parentPicture = useMemo(() => {
    const parent = row.data
    if (!ocl || !parent || !(parent.salts ?? []).length) return null
    return parentSvg(ocl, parent.parent_code, 120)
  }, [ocl, row.data])

  const change = useMutation({
    mutationFn: async (next: string) => {
      if (!ocl) throw new Error('')
      const described = describeStructure(ocl, next)
      if (!described) throw new Error(t('registry.chemistry.input.unreadable'))
      return setRecordStructure(client, {
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

  const lotColumns = useMemo<RegistryColumn<CompoundLot>[]>(
    () => [
      {
        id: 'number',
        header: t('registry.chemistry.entry.lotColumns.number'),
        size: 110,
        cell: ({ row: r }) => (
          <ObjectLink
            kind="record"
            id={r.original.id}
            identifier={r.original.identifier}
          />
        ),
      },
      {
        id: 'name',
        header: t('registry.chemistry.entry.lotColumns.name'),
        size: 260,
        cell: ({ row: r }) => (
          <Link
            to="/models/$modelId/records/$recordId"
            params={{ modelId: r.original.kind, recordId: r.original.id }}
            className="truncate font-medium text-fg hover:underline"
          >
            {r.original.title}
          </Link>
        ),
      },
      {
        id: 'added',
        header: t('registry.chemistry.entry.lotColumns.added'),
        size: 130,
        cell: ({ row: r }) => (
          <span className="text-fg-muted">
            {formatDate(r.original.createdAt)}
          </span>
        ),
      },
    ],
    [],
  )

  return (
    <>
      <Section title={t('registry.chemistry.entry.title')}>
        {molfile ? (
          <div className="flex flex-wrap items-start gap-6">
            <div className="flex flex-col gap-1">
              <span className="text-label text-fg-muted">
                {t('registry.chemistry.entry.asDrawn')}
              </span>
              <MolfilePicture
                molfile={molfile}
                label={t('registry.chemistry.entry.asDrawn')}
                height={170}
              />
            </div>
            {parentPicture ? (
              <div className="flex flex-col gap-1">
                <span className="text-label text-fg-muted">
                  {t('registry.chemistry.entry.parent')}
                </span>
                <StructurePicture
                  svg={parentPicture}
                  label={t('registry.chemistry.entry.parent')}
                  height={120}
                />
              </div>
            ) : null}
            <div className="flex min-w-0 flex-col gap-1 text-label">
              {row.data?.formula ? (
                <span className="font-medium">
                  {t('registry.chemistry.input.summary', {
                    formula: row.data.formula,
                    mass: Number(row.data.mass ?? 0),
                  })}
                </span>
              ) : null}
              {(row.data?.salts ?? []).length > 0 ? (
                <span className="text-fg-muted">
                  {t('registry.chemistry.entry.salts', {
                    salts: (row.data?.salts ?? []).join(', '),
                  })}
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <Muted>{t('registry.chemistry.entry.none')}</Muted>
        )}
        {canWrite ? (
          <div>
            <Button
              disabled={change.isPending || !ocl}
              onClick={() => setDrawing(true)}
            >
              {molfile
                ? t('registry.chemistry.entry.change')
                : t('registry.chemistry.entry.draw')}
            </Button>
          </div>
        ) : null}
        <StructureDialog
          open={drawing}
          onOpenChange={setDrawing}
          initial={molfile}
          onUse={(next) => {
            if (next) change.mutate(next)
          }}
        />
      </Section>

      {lotKind ? (
        <Section
          title={t('registry.chemistry.entry.lots')}
          count={lots.data?.length}
          action={
            canWrite ? (
              <Button size="sm" onClick={() => setAddingLot(true)}>
                {t('registry.chemistry.entry.addLot')}
              </Button>
            ) : undefined
          }
        >
          {(lots.data ?? []).length === 0 && !lots.isPending ? (
            <Muted>{t('registry.chemistry.entry.noLots')}</Muted>
          ) : (
            <RegistryGrid
              label={t('registry.chemistry.entry.lots')}
              rows={lots.data ?? []}
              columns={lotColumns}
              getRowId={(lot) => lot.id}
              rowLabel={(lot) => lot.identifier}
              isLoading={lots.isPending}
            />
          )}
          <AddLotDialog
            open={addingLot}
            onOpenChange={setAddingLot}
            compoundId={recordId}
            identifier={identifier}
            kind={kind}
          />
        </Section>
      ) : null}
    </>
  )
}

function AddLotDialog({
  open,
  onOpenChange,
  compoundId,
  identifier,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  compoundId: string
  identifier: string
  kind: string
}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const add = useMutation({
    mutationFn: () =>
      addCompoundLot(client, {
        compoundId,
        title: title.trim(),
        customFields: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: compoundKeys.all })
      toast.success(t('registry.chemistry.entry.lotAdded'))
      setTitle('')
      onOpenChange(false)
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('registry.chemistry.entry.couldNotAddLot'))),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader
          title={t('registry.chemistry.entry.addLotTitle', {
            number: identifier,
          })}
        />
        <DialogBody>
          <Field label={t('registry.chemistry.entry.lotName')}>
            <Input
              value={title}
              placeholder={t('registry.chemistry.entry.lotNamePlaceholder')}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('registry.chemistry.entry.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={add.isPending}
            onClick={() => add.mutate()}
          >
            {add.isPending
              ? t('registry.chemistry.entry.creating')
              : t('registry.chemistry.entry.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
