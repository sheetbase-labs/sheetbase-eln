import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field, Input } from '#/components/v3/ui/input'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { toast } from '#/components/v3/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'

/** UI port (RM-112): a sample's recorded measurements, with a Record
 * measurement action writing through `record_sample_measurement`. */
export const Route = createFileRoute('/samples/$sampleId/measurements')({
  component: MeasurementsTab,
})

interface MeasurementWire {
  id: string
  name: string
  value: number | string
  unit: string | null
  method: string | null
  measured_at: string
  notes: string | null
  created_by_user_id: string | null
}

function MeasurementsTab() {
  const { sampleId } = Route.useParams()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const list = useQuery({
    queryKey: ['ui-port', 'sample-measurements', sampleId],
    queryFn: () =>
      notebookDataClient.list<MeasurementWire>(
        'sample_measurements',
        `?sample_record_id=eq.${encodeURIComponent(sampleId)}&order=measured_at.desc&select=id,name,value,unit,method,measured_at,notes,created_by_user_id`,
      ),
  })

  const rows = list.data ?? []
  const userIds = rows
    .map((r) => r.created_by_user_id)
    .filter((x): x is string => Boolean(x))
  const { userLabel } = useUserNames(userIds, { id: '', name: '' })

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <div className="flex items-center gap-2">
        <h2 className="text-section">
          Measurements <span className="num text-fg-muted">{rows.length}</span>
        </h2>
        <span className="flex-1" />
        <Button variant="primary" onClick={() => setOpen(true)}>
          Record measurement
        </Button>
      </div>

      {rows.length ? (
        <TableBox>
          <Table aria-label="Measurements">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead align="right">Value</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Measured</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell align="right" className="num">
                    {String(r.value)}
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {r.unit ?? '—'}
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {r.method ?? '—'}
                  </TableCell>
                  <TableCell className="num text-fg-muted">
                    {r.measured_at.slice(0, 10)}
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {r.created_by_user_id
                      ? userLabel(r.created_by_user_id)
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableBox>
      ) : (
        <EmptyState
          className="py-2"
          title="No measurements yet"
          body="Assay results recorded against this sample appear here."
        />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(440px,calc(100vw-32px))]">
          <DialogHeader
            title="Record measurement"
            description="A value measured against this sample."
          />
          <RecordForm
            onDone={() => {
              setOpen(false)
              void queryClient.invalidateQueries({
                queryKey: ['ui-port', 'sample-measurements', sampleId],
              })
            }}
            sampleId={sampleId}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RecordForm({
  sampleId,
  onDone,
}: {
  sampleId: string
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState('')
  const [method, setMethod] = useState('')
  const [notes, setNotes] = useState('')
  const [touched, setTouched] = useState(false)

  const save = useMutation({
    mutationFn: () =>
      notebookDataClient.rpc('record_sample_measurement', {
        p_sample_record_id: sampleId,
        p_name: name.trim(),
        p_value: Number(value),
        p_unit: unit.trim() || null,
        p_method: method.trim() || null,
        p_measured_at: new Date().toISOString(),
        p_notes: notes.trim() || null,
      }),
    onSuccess: () => {
      toast('Measurement recorded')
      onDone()
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : 'Couldn’t record it.',
      )
    },
  })

  const nameError =
    touched && name.trim().length < 2 ? 'Name the measurement.' : undefined
  const valueError =
    touched && (value.trim() === '' || Number.isNaN(Number(value)))
      ? 'Enter a numeric value.'
      : undefined

  return (
    <>
      <DialogBody>
        <Field label="Name" required error={nameError}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Field label="Value" required error={valueError}>
            <Input
              value={value}
              inputMode="decimal"
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          <Field label="Unit">
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
        </div>
        <Field label="Method">
          <Input value={method} onChange={(e) => setMethod(e.target.value)} />
        </Field>
        <Field label="Notes" hint="Optional.">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <span className="flex-1" />
        <Button onClick={onDone}>Cancel</Button>
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={() => {
            setTouched(true)
            if (
              name.trim().length < 2 ||
              value.trim() === '' ||
              Number.isNaN(Number(value))
            )
              return
            save.mutate()
          }}
        >
          {save.isPending ? 'Recording…' : 'Record'}
        </Button>
      </DialogFooter>
    </>
  )
}
