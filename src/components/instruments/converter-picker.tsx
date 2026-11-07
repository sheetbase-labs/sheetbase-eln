/**
 * Add an Allotrope converter for an instrument's files: pick the instrument
 * software, and its files are converted to the vendor-neutral document and
 * kept with the run.
 */
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Field } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import {
  addConverterParser,
  ConverterClientError,
  fetchConverters,
} from '#/lib/instrument-data/converter-client'

export function ConverterPicker({
  instrumentId,
  canManage,
  onAdded,
}: {
  instrumentId: string
  canManage: boolean
  /** The new parser's key, once it exists. */
  onAdded: (key: string) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [vendor, setVendor] = useState('')
  const converters = useQuery({
    queryKey: ['converters'],
    queryFn: fetchConverters,
    enabled: open,
    staleTime: 10 * 60_000,
    retry: false,
  })
  const add = useMutation({
    mutationFn: () => addConverterParser({ vendor, instrumentId }),
    onSuccess: async (created) => {
      toast.success(t('quality.instrumentData.picker.added'))
      await onAdded(created.key)
      setOpen(false)
      setVendor('')
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof ConverterClientError && error.code === 'not_permitted'
          ? t('quality.instrumentData.picker.needsAccess')
          : t('quality.instrumentData.picker.couldNotAdd'),
      ),
  })

  if (!canManage) return null
  if (!open) {
    return (
      <div>
        <Button variant="quiet" size="sm" onClick={() => setOpen(true)}>
          {t('quality.instrumentData.picker.add')}
        </Button>
      </div>
    )
  }

  const unavailable =
    converters.error instanceof ConverterClientError &&
    converters.error.code === 'converter_unavailable'
  const techniques = [
    ...new Set((converters.data ?? []).map((entry) => entry.technique)),
  ].sort()

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <p className="m-0 text-label text-fg-muted">
        {t('quality.instrumentData.picker.body')}
      </p>
      {converters.isPending ? (
        <p role="status" className="m-0 text-label text-fg-muted">
          {t('quality.instrumentData.picker.loading')}
        </p>
      ) : converters.isError ? (
        <Notice tone="bad">
          {unavailable
            ? t('quality.instrumentData.picker.unavailable')
            : t('quality.instrumentData.picker.couldNotAdd')}
        </Notice>
      ) : (
        <Field label={t('quality.instrumentData.picker.software')}>
          <Select
            value={vendor}
            onChange={(event) => setVendor(event.target.value)}
          >
            <option value="">
              {t('quality.instrumentData.picker.choose')}
            </option>
            {techniques.map((technique) => (
              <optgroup key={technique} label={technique}>
                {converters.data
                  .filter((entry) => entry.technique === technique)
                  .map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </Field>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!vendor || add.isPending}
          onClick={() => add.mutate()}
        >
          {add.isPending
            ? t('quality.instrumentData.picker.saving')
            : t('quality.instrumentData.picker.save')}
        </Button>
        <Button variant="quiet" size="sm" onClick={() => setOpen(false)}>
          {t('common.actions.cancel')}
        </Button>
      </div>
    </div>
  )
}
