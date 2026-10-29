import { useMemo, useState } from 'react'

import { Checkbox } from '#/components/v3/ui/checkbox'
import { FileDrop } from '#/components/v3/ui/file-drop'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted } from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { Tooltip } from '#/components/v3/ui/tooltip'
import { Button } from '#/components/v3/ui/button'
import { readWithLayout } from '#/lib/import/parser-layout'
import type { ParserLayout } from '#/lib/import/parser-layout'
import { t } from '#/copy'

const PREVIEW_ROWS = 6

/** Drops options that say nothing, so a stored layout holds only what was chosen. */
export function tidyLayout(layout: ParserLayout): ParserLayout {
  const out: ParserLayout = {}
  if (layout.delimiter && layout.delimiter !== 'auto')
    out.delimiter = layout.delimiter
  if (layout.headerStartsWith?.trim())
    out.headerStartsWith = layout.headerStartsWith.trim()
  else if (layout.headerLine) out.headerLine = layout.headerLine
  if (layout.readDetails) out.readDetails = true
  const ignore = (layout.ignoreLines ?? []).filter(Boolean)
  if (ignore.length) out.ignoreLines = ignore
  if (layout.stopAt?.trim()) out.stopAt = layout.stopAt.trim()
  if (layout.units && layout.units !== 'none') out.units = layout.units
  if (layout.decimalComma) out.decimalComma = true
  if (layout.plateGrid?.valueName.trim())
    out.plateGrid = { valueName: layout.plateGrid.valueName.trim() }
  return out
}

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
  const [sample, setSample] = useState<string | null>(null)
  const [ignoreText, setIgnoreText] = useState(
    (value.ignoreLines ?? []).join(', '),
  )
  const start: Start =
    value.headerStartsWith !== undefined
      ? 'text'
      : value.headerLine !== undefined
        ? 'number'
        : 'first'
  const set = (patch: Partial<ParserLayout>) => onChange({ ...value, ...patch })

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
              const next = e.target.value as Start
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
            onChange={(e) =>
              set({
                units: e.target.value as NonNullable<ParserLayout['units']>,
              })
            }
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
            onChange={(e) =>
              set({
                delimiter: e.target.value as NonNullable<
                  ParserLayout['delimiter']
                >,
              })
            }
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
    </div>
  )
}
