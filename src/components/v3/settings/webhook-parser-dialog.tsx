import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { instrumentOption } from '#/components/v3/record-picker/entity-options'
import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { CodeBlock } from '#/components/v3/ui/code-block'
import { Field, Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { useInstruments } from '#/components/v3/instruments/instruments-data'
import {
  createWebhookParser,
  parserSettingsQueryKeys,
} from '#/lib/parser-settings'
import type { CreatedWebhookParser } from '#/lib/parser-settings'
import { t } from '#/copy'

const FORMATS = ['csv', 'tsv', 'xlsx', 'json']

/**
 * Add a parser that lives at an address elsewhere. The signing key it is given
 * is shown once, because only the service and Sheetbase should ever hold it.
 */
export function WebhookParserDialog({
  workspaceId,
  instrumentId: initialInstrumentId,
  onClose,
  onCreated,
}: {
  workspaceId: string
  instrumentId?: string
  onClose: () => void
  /** Called with the new parser's first version so the page can select it. */
  onCreated?: (created: CreatedWebhookParser) => void
}) {
  const queryClient = useQueryClient()
  const instruments = useInstruments()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [format, setFormat] = useState('csv')
  const [instrumentId, setInstrumentId] = useState(initialInstrumentId ?? '')
  const [created, setCreated] = useState<CreatedWebhookParser | null>(null)

  const validUrl = /^https?:\/\/\S+$/.test(url.trim())
  const ready = validUrl && name.trim().length > 0
  const create = useMutation({
    mutationFn: () =>
      createWebhookParser({
        name: name.trim(),
        format,
        url: url.trim(),
        instrumentId: instrumentId || null,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: parserSettingsQueryKeys.list(workspaceId),
      })
      setCreated(result)
      onCreated?.(result)
    },
  })

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader
          title={
            created
              ? t('settings.webhookParserDialog.titleDone')
              : t('settings.webhookParserDialog.title')
          }
          description={
            created ? undefined : t('settings.webhookParserDialog.description')
          }
        />
        <DialogBody>
          {created ? (
            <>
              {created.secret ? (
                <>
                  <p className="m-0 text-body">
                    {t('settings.webhookParserDialog.keyIntro')}
                  </p>
                  <Input
                    readOnly
                    aria-label={t('settings.webhookParserDialog.keyAria')}
                    className="mono"
                    value={created.secret}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </>
              ) : (
                <p className="m-0 text-body">
                  {t('settings.webhookParserDialog.keyKept')}
                </p>
              )}
              <p className="m-0 text-body">
                {t('settings.webhookParserDialog.next')}
              </p>
              <p className="m-0 text-label text-fg-muted">
                {t('settings.webhookParserDialog.snippetIntro')}
              </p>
              <CodeBlock
                code={t('settings.webhookParserDialog.snippet')}
                language="python"
                label={t('settings.webhookParserDialog.snippetAria')}
                maxHeight="lg"
              />
            </>
          ) : (
            <>
              <Field
                label={t('settings.webhookParserDialog.name')}
                hint={t('settings.webhookParserDialog.nameHint')}
              >
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field
                label={t('settings.webhookParserDialog.address')}
                hint={t('settings.webhookParserDialog.addressHint')}
                error={
                  url && !validUrl
                    ? t('settings.webhookParserDialog.addressError')
                    : undefined
                }
              >
                <Input
                  value={url}
                  placeholder="https://parsers.example.com/qpcr"
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
              <Field label={t('settings.webhookParserDialog.format')}>
                <Select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  {FORMATS.map((value) => (
                    <option key={value} value={value}>
                      {value.toUpperCase()}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('settings.webhookParserDialog.instrument')}>
                <PickerSelect
                  noun="instrument"
                  value={instrumentId}
                  onChange={(id) => setInstrumentId(id)}
                  clearLabel={t('settings.webhookParserDialog.noInstrument')}
                  options={(instruments.data ?? []).map((i) =>
                    instrumentOption(i),
                  )}
                />
              </Field>
              {create.isError ? (
                <Notice tone="bad">
                  {create.error instanceof Error ? create.error.message : ''}
                </Notice>
              ) : null}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {created ? (
            <DialogClose render={<Button variant="primary" />}>
              {t('common.actions.done')}
            </DialogClose>
          ) : (
            <>
              <DialogClose render={<Button />}>
                {t('common.actions.cancel')}
              </DialogClose>
              <Button
                variant="primary"
                disabled={!ready || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending
                  ? t('settings.webhookParserDialog.adding')
                  : t('settings.webhookParserDialog.add')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
