import { useState } from 'react'
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { PageHeader } from '#/components/v3/ui/layout'
import { NativeSelect } from '#/components/v3/projects/select'
import { toast } from '#/components/v3/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'

/** UI port (RM-109 / MOB-02): record a reading at the bench. A reading is a
 * value measured against a sample, written through `record_sample_measurement`,
 * so it appears on the sample's Measurements tab. */
export const Route = createFileRoute('/readings/new')({
  validateSearch: (search: Record<string, unknown>): { sample?: string } => ({
    sample: typeof search.sample === 'string' ? search.sample : undefined,
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: NewReading,
})

interface SampleWire {
  id: string
  identifier: string
  title: string
}

function NewReading() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const samples = useQuery({
    queryKey: ['ui-port', 'readings', 'samples'],
    queryFn: () =>
      notebookDataClient.list<SampleWire>(
        'records',
        '?kind=eq.sample&deleted_at=is.null&archived_at=is.null&order=identifier.asc&select=id,identifier,title&limit=200',
      ),
    staleTime: 30_000,
  })
  const rows = samples.data ?? []
  const [sampleId, setSampleId] = useState(search.sample ?? '')
  const [name, setName] = useState('Concentration')
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState('')
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)

  const effectiveSample = sampleId || rows.at(0)?.id || ''
  const parsed = Number.parseFloat(value.replace(',', '.'))
  const valueValid =
    value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0
  const nameValid = name.trim().length >= 2

  const save = useMutation({
    mutationFn: () =>
      notebookDataClient.rpc('record_sample_measurement', {
        p_sample_record_id: effectiveSample,
        p_name: name.trim(),
        p_value: parsed,
        p_unit: unit.trim() || null,
        p_method: 'Bench reading',
        p_measured_at: new Date().toISOString(),
        p_notes: note.trim() || null,
      }),
    onSuccess: () => {
      toast('Reading saved', {
        description: `${name.trim()} ${parsed}${unit ? ` ${unit}` : ''}`,
      })
      void navigate({
        to: '/samples/$sampleId/measurements',
        params: { sampleId: effectiveSample },
      })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Couldn’t save it.')
    },
  })

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader crumbs="Readings" title="Record reading" />
      <form
        className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-4 md:px-6 md:py-6"
        onSubmit={(e) => {
          e.preventDefault()
          setTouched(true)
          if (!effectiveSample || !valueValid || !nameValid) return
          save.mutate()
        }}
      >
        <Field label="Sample" required>
          <NativeSelect
            value={effectiveSample}
            onChange={(e) => setSampleId(e.target.value)}
            disabled={samples.isLoading}
          >
            {rows.length === 0 ? (
              <option value="">No samples yet</option>
            ) : null}
            {rows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.identifier} · {s.title}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Measurement" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Field
            label="Value"
            required
            error={
              touched && !valueValid ? 'Enter a number, 0 or more.' : undefined
            }
          >
            <Input
              value={value}
              inputMode="decimal"
              autoFocus
              className="num h-12 text-[20px]"
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          <Field label="Unit">
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
        </div>
        <Field label="Note" hint="Optional.">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-2 md:flex-row-reverse md:justify-start">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={save.isPending || rows.length === 0}
          >
            {save.isPending ? 'Saving…' : 'Save reading'}
          </Button>
          <Button size="lg" nativeButton={false} render={<Link to="/scan" />}>
            Scan instead
          </Button>
        </div>
        {rows.length === 0 && !samples.isLoading ? (
          <p className="m-0 text-label text-fg-muted">
            Register a sample first; a reading is measured against one.
          </p>
        ) : null}
      </form>
    </div>
  )
}
