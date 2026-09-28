import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button, Input } from '#/components/ui'
import {
  DATE_FORMATS,
  NUMBER_FORMATS,
  fetchWorkspaceGeneral,
  updateWorkspaceGeneral,
  workspaceGeneralQueryKey,
} from '#/lib/workspace-general'
import type { WorkspaceGeneral } from '#/lib/workspace-general'

const DEFAULTS: WorkspaceGeneral = {
  site: null,
  timezone: 'Europe/London',
  dateFormat: 'd MMM yyyy',
  numberFormat: 'decimal',
}

/**
 * SET-01.1 — workspace general settings (site, time zone, date and number
 * format). The RPC refuses a non-admin.
 */
export function SettingsGeneral({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: workspaceGeneralQueryKey,
    queryFn: () => fetchWorkspaceGeneral(),
    enabled: Boolean(workspaceId),
  })
  const [form, setForm] = useState<WorkspaceGeneral>(DEFAULTS)

  useEffect(() => {
    if (query.data) setForm(query.data)
  }, [query.data])

  const save = useMutation({
    mutationFn: () => updateWorkspaceGeneral(workspaceId, form),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: workspaceGeneralQueryKey }),
  })

  return (
    <section aria-label="Workspace general" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-section text-foreground">Workspace</h3>
          <p className="text-caption text-muted-foreground">
            Name, site, time zone and the formats records display in.
          </p>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

      {save.isError ? (
        <p role="alert" className="text-caption text-danger-text">
          {save.error instanceof Error
            ? save.error.message
            : 'Could not save the settings.'}
        </p>
      ) : null}

      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-label text-muted-foreground">
          Site
          <Input
            aria-label="Site"
            value={form.site ?? ''}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                site: event.target.value || null,
              }))
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-label text-muted-foreground">
          Time zone
          <Input
            aria-label="Time zone"
            value={form.timezone}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                timezone: event.target.value,
              }))
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-label text-muted-foreground">
          Date format
          <select
            aria-label="Date format"
            className="h-control rounded-md border border-input bg-card px-2 text-body"
            value={form.dateFormat}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                dateFormat: event.target.value,
              }))
            }
          >
            {DATE_FORMATS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-label text-muted-foreground">
          Number format
          <select
            aria-label="Number format"
            className="h-control rounded-md border border-input bg-card px-2 text-body"
            value={form.numberFormat}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                numberFormat: event.target
                  .value as WorkspaceGeneral['numberFormat'],
              }))
            }
          >
            {NUMBER_FORMATS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  )
}
