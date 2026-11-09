import { useRef, useState } from 'react'

import { Button } from '#/components/ui/button'
import { Field } from '#/components/ui/input'
import { Notice } from '#/components/ui/alert'
import { t } from '#/copy'
import {
  FILL_INSTRUCTION,
  FILL_PDF_MAX_BYTES,
  buildFillText,
  parseFillResponse,
} from '#/lib/assist-fill'
import type { FillField } from '#/lib/assist-fill'
import { usePageAi } from '#/lib/use-page-ai'

function toBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)

  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }

  return btoa(binary)
}

/**
 * Sits at the top of a create form. The person pastes text or picks a PDF and
 * the fields it names are filled in, ready to check and save. It renders
 * nothing when AI is off for the workspace.
 */
export function FillFromText({
  fields,
  onFill,
}: {
  fields: readonly FillField[]
  /** Called with the values found, keyed by field key. */
  onFill: (values: Record<string, string>) => void
}) {
  const ai = usePageAi()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [pdf, setPdf] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const [message, setMessage] = useState<{
    tone: 'info' | 'warn'
    text: string
  } | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

  if (!ai.live) return null

  async function read() {
    setBusy(true)
    setMessage(null)

    try {
      let source = text

      if (pdf) {
        if (pdf.size > FILL_PDF_MAX_BYTES) {
          setMessage({ tone: 'warn', text: t('library.fill.pdfTooBig') })

          return
        }

        const { readPdfTextFn } = await import('#/lib/assist-fill-actions')

        const extracted = await readPdfTextFn({
          data: {
            workspaceId: ai.workspaceId ?? '',
            dataBase64: toBase64(await pdf.arrayBuffer()),
          },
        })

        if (extracted.status !== 'ok') {
          setMessage({ tone: 'warn', text: t('library.fill.pdfFailed') })

          return
        }

        source = `${extracted.text}\n${text}`
      }

      const result = await ai.run({
        task: 'freeform',
        instruction: FILL_INSTRUCTION,
        text: buildFillText(fields, source),
      })

      if (result.status !== 'ok') {
        setMessage({ tone: 'warn', text: t('library.fill.failed') })

        return
      }

      const values = parseFillResponse(result.text, fields)
      const keys = Object.keys(values)

      if (keys.length === 0) {
        setMessage({ tone: 'info', text: t('library.fill.nothing') })

        return
      }

      onFill(values)
      setMessage({
        tone: 'info',
        text: t('library.fill.filled', {
          count: keys.length,
          fields: keys
            .map((key) => fields.find((field) => field.key === key)?.label)
            .filter(Boolean)
            .join(', '),
        }),
      })
      setOpen(false)
      setText('')
      setPdf(null)
    } catch {
      setMessage({ tone: 'warn', text: t('library.fill.failed') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="fill-from-text">
      {!open ? (
        <div>
          <Button
            type="button"
            variant="quiet"
            size="sm"
            icon="spark"
            onClick={() => setOpen(true)}
          >
            {t('library.fill.open')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <Field label={t('library.fill.pasteLabel')}>
            <textarea
              value={text}
              rows={5}
              placeholder={t('library.fill.pastePlaceholder')}
              onChange={(event) => setText(event.target.value)}
              className="w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-body text-fg placeholder:text-fg-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(event) => setPdf(event.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              size="sm"
              icon="upload"
              onClick={() => fileRef.current?.click()}
            >
              {pdf ? pdf.name : t('library.fill.choosePdf')}
            </Button>
            <span className="flex-1" />
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              {t('library.fill.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={busy || (!text.trim() && !pdf)}
              onClick={() => void read()}
            >
              {busy ? t('library.fill.reading') : t('library.fill.read')}
            </Button>
          </div>
        </div>
      )}
      {message ? (
        <Notice tone={message.tone} icon="spark">
          {message.text}
        </Notice>
      ) : null}
    </div>
  )
}

const FILLABLE_TYPES = new Set(['text', 'integer', 'decimal', 'date'])

/** The added fields of a create form that a pasted text can fill. */
export function addedFillFields(
  fields: readonly {
    fieldName: string
    label: string
    logicalType: string
  }[],
): FillField[] {
  return fields
    .filter((field) => FILLABLE_TYPES.has(field.logicalType))
    .map((field) => ({
      key: `field:${field.fieldName}`,
      label: field.label,
      hint:
        field.logicalType === 'date'
          ? t('library.fill.hintDate')
          : field.logicalType === 'text'
            ? undefined
            : t('library.fill.hintNumber'),
    }))
}
