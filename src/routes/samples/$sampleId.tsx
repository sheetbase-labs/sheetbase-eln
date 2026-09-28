import { useState } from 'react'
import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import {
  PageHeader,
  Inspector,
  InspectorSection,
  DescriptionList,
} from '#/components/v3/ui/layout'
import { LinkTabs } from '#/components/v3/projects/search-tabs'
import { Field, Input } from '#/components/v3/ui/input'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { toast } from '#/components/v3/ui/sonner'
import { sampleStatus } from '#/components/v3/samples/samples-data'
import { consumeSample, fetchSample, transferSample } from '#/lib/samples'
import type { SampleRecord } from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'

/** UI port (roadmap-4/ui-app3): the sample detail frame, wired to real sample
 * records; Withdraw and Move use the canonical custody RPCs. */
export const Route = createFileRoute('/samples/$sampleId')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: SampleLayout,
})

export const sampleQueryKey = (recordId: string) =>
  ['ui-port', 'sample', recordId] as const

export function useSampleRecord(recordId: string) {
  return useQuery({
    queryKey: sampleQueryKey(recordId),
    queryFn: () => fetchSample(notebookDataClient, recordId),
  })
}

function SampleLayout() {
  const { sampleId } = Route.useParams()
  const queryClient = useQueryClient()
  const query = useSampleRecord(sampleId)
  const sample = query.data
  const [dialog, setDialog] = useState<null | 'withdraw' | 'move'>(null)

  const withdraw = useMutation({
    mutationFn: (input: { quantity: number; notes?: string }) =>
      consumeSample(notebookDataClient, {
        recordId: sampleId,
        quantity: input.quantity,
        expectedMetadataVersion: sample!.metadataVersion,
        notes: input.notes,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sampleQueryKey(sampleId) })
      toast('Volume withdrawn')
      setDialog(null)
    },
  })
  const move = useMutation({
    mutationFn: (input: { toLocation: string; notes?: string }) =>
      transferSample(notebookDataClient, {
        recordId: sampleId,
        toLocation: input.toLocation,
        expectedMetadataVersion: sample!.metadataVersion,
        notes: input.notes,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sampleQueryKey(sampleId) })
      toast('Sample moved')
      setDialog(null)
    },
  })

  if (!sample) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          crumbs={
            <Link to="/samples" className="text-link">
              Samples
            </Link>
          }
          title={query.isLoading ? 'Loading sample…' : 'Sample not found'}
        />
      </div>
    )
  }

  const status = sampleStatus(sample.status)
  const params = { sampleId: sample.id }
  const quantity =
    sample.quantity != null
      ? `${sample.quantity.toLocaleString('en-GB', { maximumFractionDigits: 2 })}${sample.quantityUnit ? ` ${sample.quantityUnit}` : ''}`
      : '—'
  const isActive = sample.status !== 'consumed' && sample.status !== 'expired'

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          className="px-4 md:px-8"
          crumbs={
            <>
              <Link to="/samples" className="text-link">
                Samples
              </Link>{' '}
              / <span className="mono">{sample.identifier}</span>
            </>
          }
          title={sample.title}
          meta={
            <>
              <span className="text-fg">
                <Status tone={status.tone}>{status.label}</Status>
              </span>
              <span>{sample.sampleType ?? '—'}</span>
            </>
          }
          actions={
            <span className="flex gap-2 max-md:hidden">
              {isActive ? (
                <Button onClick={() => setDialog('move')}>Move</Button>
              ) : null}
              {isActive ? (
                <Button variant="primary" onClick={() => setDialog('withdraw')}>
                  Withdraw volume…
                </Button>
              ) : null}
            </span>
          }
          tabs={
            <LinkTabs
              tabs={[
                {
                  label: 'Details',
                  link: {
                    to: '/samples/$sampleId',
                    params,
                    activeOptions: { exact: true },
                  },
                },
                {
                  label: 'Usage',
                  link: { to: '/samples/$sampleId/usage', params },
                },
                {
                  label: 'History',
                  link: { to: '/samples/$sampleId/history', params },
                },
                {
                  label: 'Lineage',
                  link: { to: '/samples/$sampleId/lineage', params },
                },
                {
                  label: 'Measurements',
                  link: { to: '/samples/$sampleId/measurements', params },
                },
              ]}
            />
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </div>

      <Inspector aria-label="Sample context" className="w-[300px]">
        <InspectorSection title="Properties">
          <DescriptionList
            labelWidth={104}
            items={[
              ['Type', sample.sampleType ?? '—'],
              ['Quantity', quantity],
              ['Location', sample.storageLocation ?? '—'],
              [
                'Barcode',
                <span className="mono">{sample.barcode ?? '—'}</span>,
              ],
            ]}
          />
        </InspectorSection>
        {sample.notes ? (
          <InspectorSection title="Notes">
            <p className="m-0 text-label leading-[18px]">{sample.notes}</p>
          </InspectorSection>
        ) : null}
      </Inspector>

      <SimpleNumberDialog
        open={dialog === 'withdraw'}
        onOpenChange={(o) => setDialog(o ? 'withdraw' : null)}
        title={`Withdraw from ${sample.identifier}`}
        label="Volume"
        busy={withdraw.isPending}
        onSubmit={(value) => withdraw.mutate({ quantity: value })}
      />
      <TextDialog
        open={dialog === 'move'}
        onOpenChange={(o) => setDialog(o ? 'move' : null)}
        title={`Move ${sample.identifier}`}
        label="New location"
        busy={move.isPending}
        onSubmit={(value) => move.mutate({ toLocation: value })}
      />
    </div>
  )
}

function SimpleNumberDialog({
  open,
  onOpenChange,
  title,
  label,
  busy,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  label: string
  busy: boolean
  onSubmit: (value: number) => void
}) {
  const [value, setValue] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader title={title} />
        <DialogBody>
          <Field label={label} required>
            <Input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              const n = Number(value)
              if (Number.isFinite(n) && n > 0) onSubmit(n)
            }}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TextDialog({
  open,
  onOpenChange,
  title,
  label,
  busy,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  label: string
  busy: boolean
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader title={title} />
        <DialogBody>
          <Field label={label} required>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              if (value.trim()) onSubmit(value.trim())
            }}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type { SampleRecord }
