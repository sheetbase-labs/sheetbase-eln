import { useMemo, useState } from 'react'

import { Checkbox } from '#/components/ui/checkbox'
import { FileDrop } from '#/components/ui/file-drop'
import { Field, Input } from '#/components/ui/input'
import { Muted } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Tooltip } from '#/components/ui/tooltip'
import { Button } from '#/components/ui/button'
import { readWithLayout } from '#/lib/import/parser-layout'
import type { ParserLayout } from '#/lib/import/parser-layout'
import { t } from '#/copy'
import { tidyLayout } from './parser-layout-settings'

export { tidyLayout } from './parser-layout-settings'

const PREVIEW_ROWS = 6

type Start = 'first' | 'text' | 'number'

function Tip({ children, tip }: { children: React.ReactNode; tip: string }) {
  return (
    <Tooltip content={tip}>
      <span className="cursor-help underline decoration-dotted underline-offset-2">
        {children}
      </span>
    </Tooltip>
  )
}

/**
 * The options that let an admin describe a new file format without code, with
 * a preview that reads a sample file in the browser as each option changes.
 */
export function ParserLayoutEditor({
  value,
  onChange,
  onUseColumns,
  disabled,
}: {
  value: ParserLayout
  onChange: (next: ParserLayout) => void
  /** Offered when the sample reads: set the columns a file must have. */
  onUseColumns?: (headers: string[]) => void
  disabled?: boolean
}) {
  const [ignoreText, setIgnoreText] = useState(() =>
    (value.ignoreLines ?? []).join(', '),
  )

  const start: Start =
    value.headerStartsWith !== undefined
      ? 'text'
      : value.headerLine !== undefined
        ? 'number'
        : 'first'

  const set = (patch: Partial<ParserLayout>) => onChange({ ...value, ...patch })

  return (
    <div className="flex flex-col gap-3 md:col-span-2">
      <div>
        <h3 className="m-0 text-body font-semibold">
          {t('settings.parserLayout.title')}
        </h3>
        <Muted>{t('settings.parserLayout.intro')}</Muted>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t('settings.parserLayout.tableStarts')}>
          <Select
            value={start}
            disabled={disabled}
            onChange={(e) => {
              const next = e.target.value
              onChange({
                ...value,
                headerStartsWith: next === 'text' ? '' : undefined,
                headerLine: next === 'number' ? 1 : undefined,
              })
            }}
          >
            <option value="first">
              {t('settings.parserLayout.startFirst')}
            </option>
            <option value="text">{t('settings.parserLayout.startText')}</option>
            <option value="number">
              {t('settings.parserLayout.startNumber')}
            </option>
          </Select>
        </Field>
        {start === 'text' ? (
          <Field label={t('settings.parserLayout.startTextLabel')}>
            <Input
              value={value.headerStartsWith ?? ''}
              disabled={disabled}
              onChange={(e) => set({ headerStartsWith: e.target.value })}
            />
          </Field>
        ) : start === 'number' ? (
          <Field label={t('settings.parserLayout.startNumberLabel')}>
            <Input
              type="number"
              min={1}
              value={value.headerLine ?? 1}
              disabled={disabled}
              onChange={(e) =>
                set({ headerLine: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </Field>
        ) : (
          <span className="hidden md:block" />
        )}
        <Field
          label={t('settings.parserLayout.ignore')}
          hint={t('settings.parserLayout.ignoreHint')}
        >
          <Input
            value={ignoreText}
            disabled={disabled}
            onChange={(e) => {
              setIgnoreText(e.target.value)
              set({
                ignoreLines: e.target.value
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }}
          />
        </Field>
        <Field
          label={
            <Tip tip={t('settings.parserLayout.stopAtTip')}>
              {t('settings.parserLayout.stopAt')}
            </Tip>
          }
        >
          <Input
            value={value.stopAt ?? ''}
            disabled={disabled}
            onChange={(e) => set({ stopAt: e.target.value })}
          />
        </Field>
        <Field label={t('settings.parserLayout.units')}>
          <Select
            value={value.units ?? 'none'}
            disabled={disabled}
            onChange={(e) => {
              const units = (['none', 'header', 'row'] as const).find(
                (unit) => unit === e.target.value,
              )

              if (units) set({ units })
            }}
          >
            <option value="none">{t('settings.parserLayout.unitsNone')}</option>
            <option value="header">
              {t('settings.parserLayout.unitsHeader')}
            </option>
            <option value="row">{t('settings.parserLayout.unitsRow')}</option>
          </Select>
        </Field>
        <Field label={t('settings.parserLayout.delimiter')}>
          <Select
            value={value.delimiter ?? 'auto'}
            disabled={disabled}
            onChange={(e) => {
              const delimiter = (
                ['auto', 'comma', 'semicolon', 'tab'] as const
              ).find((option) => option === e.target.value)

              if (delimiter) set({ delimiter })
            }}
          >
            <option value="auto">
              {t('settings.parserLayout.delimiterAuto')}
            </option>
            <option value="comma">
              {t('settings.parserLayout.delimiterComma')}
            </option>
            <option value="semicolon">
              {t('settings.parserLayout.delimiterSemicolon')}
            </option>
            <option value="tab">
              {t('settings.parserLayout.delimiterTab')}
            </option>
          </Select>
        </Field>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-body">
          <Checkbox
            checked={Boolean(value.readDetails)}
            disabled={disabled}
            onCheckedChange={(on) => set({ readDetails: Boolean(on) })}
          />
          <Tip tip={t('settings.parserLayout.detailsTip')}>
            {t('settings.parserLayout.details')}
          </Tip>
        </label>
        <label className="flex items-center gap-2 text-body">
          <Checkbox
            checked={Boolean(value.decimalComma)}
            disabled={disabled}
            onCheckedChange={(on) => set({ decimalComma: Boolean(on) })}
          />
          <Tip tip={t('settings.parserLayout.decimalCommaTip')}>
            {t('settings.parserLayout.decimalComma')}
          </Tip>
        </label>
        <label className="flex items-center gap-2 text-body">
          <Checkbox
            checked={Boolean(value.plateGrid)}
            disabled={disabled}
            onCheckedChange={(on) =>
              set({ plateGrid: on ? { valueName: 'Reading' } : undefined })
            }
          />
          <Tip tip={t('settings.parserLayout.plateTip')}>
            {t('settings.parserLayout.plate')}
          </Tip>
        </label>
        {value.plateGrid ? (
          <Field
            label={t('settings.parserLayout.plateName')}
            className="max-w-xs"
          >
            <Input
              value={value.plateGrid.valueName}
              disabled={disabled}
              onChange={(e) =>
                set({ plateGrid: { valueName: e.target.value } })
              }
            />
          </Field>
        ) : null}
      </div>
      <ParserSamplePreview
        value={value}
        onUseColumns={onUseColumns}
        disabled={disabled}
      />
    </div>
  )
}

function ParserSamplePreview({
  value,
  onUseColumns,
  disabled,
}: {
  value: ParserLayout
  onUseColumns?: (headers: string[]) => void
  disabled?: boolean
}) {
  const [sample, setSample] = useState<string | null>(null)

  const preview = useMemo(() => {
    if (sample === null) return null

    try {
      return {
        ok: true as const,
        read: readWithLayout(sample, tidyLayout(value)),
      }
    } catch (error) {
      return {
        ok: false as const,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }, [sample, value])

  const details = preview?.ok ? Object.entries(preview.read.metadata) : []

  return (
    <>
      <FileDrop
        label={t('settings.parserLayout.sample')}
        inputLabel={t('settings.parserLayout.sample')}
        hint={t('settings.parserLayout.sampleHint')}
        onFile={async (file) => setSample(file ? await file.text() : null)}
      />
      {preview === null ? (
        <Muted>{t('settings.parserLayout.previewEmpty')}</Muted>
      ) : preview.ok ? (
        <div className="flex min-w-0 flex-col gap-2">
          {details.length ? (
            <p className="m-0 text-label">
              <span className="font-medium">
                {t('settings.parserLayout.previewDetails')}:{' '}
              </span>
              {details.map(([k, v]) => `${k} ${v}`).join(' · ')}
            </p>
          ) : null}
          <TableBox>
            <Table aria-label={t('settings.parserLayout.sample')}>
              <TableHeader>
                <TableRow>
                  {preview.read.headers.map((header) => (
                    <TableHead key={header}>{header}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.read.rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                  // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- This read-only preview has no row identities or interactive state; duplicate source rows are valid and cells always render from the current sample.
                  <TableRow key={index}>
                    {preview.read.headers.map((header) => (
                      <TableCell key={header}>{row[header]}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
          <Muted>
            {t('settings.parserLayout.previewRows', {
              shown: Math.min(PREVIEW_ROWS, preview.read.rows.length),
              total: preview.read.rows.length,
            })}
            {preview.read.warnings.length
              ? ` · ${preview.read.warnings.join(' ')}`
              : ''}
          </Muted>
          {onUseColumns ? (
            <div>
              <Button
                size="sm"
                disabled={disabled}
                onClick={() => onUseColumns(preview.read.headers)}
              >
                {t('settings.parserLayout.useColumns')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p role="status" className="m-0 text-label text-danger-text">
          {t('settings.parserLayout.cantRead', { reason: preview.reason })}
        </p>
      )}
    </>
  )
}
