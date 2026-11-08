/**
 * Draws a plugin's screen with the app's own components.
 *
 * The screen is data (`#/lib/extensions/screens`), already checked on the
 * server, and checked again here before anything is drawn. Every part maps to
 * one component the rest of the app uses, so a plugin's screen looks native,
 * follows dark mode and the phone layout, and cannot run code in the page.
 */
import * as React from 'react'
import { useRouter } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, Input } from '#/components/ui/input'
import { Progress } from '#/components/ui/progress'
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
import { sanitizeSvg } from '#/lib/extensions/screens'
import type { ScreenNode } from '#/lib/extensions/screens'
import { cn } from '#/lib/utils'
import { CellDisplayView } from './cell-display'
import { TONE_CLASSES } from './tone'

export type PluginValues = Record<string, string | number | boolean>

const GAP = { sm: 'gap-1.5', md: 'gap-3', lg: 'gap-5' } as const
const TEXT_TONE = {
  muted: 'text-fg-muted',
  success: 'text-success-text',
  danger: 'text-danger-text',
} as const
const PROGRESS_TONE = {
  neutral: 'neutral',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'accent',
} as const

/** Starting values of every input in a view, so a button sends what is on screen. */
export function initialValues(node: ScreenNode): PluginValues {
  const out: PluginValues = {}
  const visit = (n: ScreenNode) => {
    if (n.type === 'input')
      out[n.name] =
        n.value ??
        (n.kind === 'checkbox'
          ? false
          : n.kind === 'select'
            ? (n.options?.[0]?.value ?? '')
            : '')
    if (n.type === 'stack' || n.type === 'form') n.children.forEach(visit)
  }
  visit(node)
  return out
}

export function PluginView({
  view,
  busy,
  onEvent,
}: {
  view: ScreenNode
  busy?: boolean
  onEvent?: (action: string, values: PluginValues) => void
}) {
  const [values, setValues] = React.useState<PluginValues>(() =>
    initialValues(view),
  )
  // A new view keeps what the person typed for inputs that are still there.
  React.useEffect(() => {
    setValues((previous) => {
      const next = initialValues(view)
      for (const key of Object.keys(next))
        if (key in previous) next[key] = previous[key]
      return next
    })
  }, [view])
  const send = (action: string) => onEvent?.(action, values)
  return (
    <div data-slot="plugin-view" className="flex min-w-0 flex-col gap-3">
      <Node
        node={view}
        values={values}
        setValue={(name, value) =>
          setValues((previous) => ({ ...previous, [name]: value }))
        }
        busy={busy === true}
        send={send}
      />
    </div>
  )
}

type NodeContext = {
  values: PluginValues
  setValue: (name: string, value: string | number | boolean) => void
  busy: boolean
  send: (action: string) => void
}

function Node({ node, ...ctx }: { node: ScreenNode } & NodeContext) {
  switch (node.type) {
    case 'stack':
      return (
        <div
          className={cn(
            'flex min-w-0',
            node.direction === 'row'
              ? 'flex-row flex-wrap items-end'
              : 'flex-col',
            GAP[node.gap ?? 'md'],
          )}
        >
          {node.children.map((child, i) => (
            <Node key={i} node={child} {...ctx} />
          ))}
        </div>
      )
    case 'heading':
      return node.level === 3 ? (
        <h4 className="m-0 text-body font-semibold text-fg">{node.text}</h4>
      ) : node.level === 1 ? (
        <h2 className="m-0 text-title font-semibold text-fg">{node.text}</h2>
      ) : (
        <h3 className="m-0 text-section text-fg">{node.text}</h3>
      )
    case 'text':
      return (
        <p
          className={cn(
            'm-0 whitespace-pre-wrap text-body text-fg',
            node.tone && TEXT_TONE[node.tone],
          )}
        >
          {node.text}
        </p>
      )
    case 'stat':
      return (
        <div className="flex flex-col">
          <span className="text-label text-fg-muted">{node.label}</span>
          <span
            className={cn(
              'text-title font-semibold tabular-nums text-fg',
              node.tone === 'danger' && 'text-danger-text',
              node.tone === 'success' && 'text-success-text',
              node.tone === 'warning' && 'text-warning-text',
            )}
          >
            {node.value}
            {node.unit ? (
              <span className="ml-1 text-body font-normal text-fg-muted">
                {node.unit}
              </span>
            ) : null}
          </span>
        </div>
      )
    case 'badge':
      return (
        <span
          className={cn(
            'inline-flex w-fit items-center rounded-sm px-1.5 py-px text-[11px] font-medium',
            TONE_CLASSES[node.tone ?? 'neutral'],
          )}
        >
          {node.text}
        </span>
      )
    case 'bar': {
      const max = node.max ?? 100
      return (
        <div className="flex flex-col gap-1">
          {node.label ? (
            <span className="text-label text-fg-muted">{node.label}</span>
          ) : null}
          <Progress
            label={node.label ?? String(node.value)}
            value={node.value}
            max={max}
            tone={PROGRESS_TONE[node.tone ?? 'info']}
          />
        </div>
      )
    }
    case 'sparkline':
      return (
        <CellDisplayView
          spec={{ kind: 'sparkline', tone: node.tone }}
          value={node.values}
        />
      )
    case 'table':
      return (
        <TableBox>
          <Table>
            <TableHeader>
              <TableRow>
                {node.columns.map((column) => (
                  <TableHead
                    key={column.key}
                    className={column.align === 'end' ? 'text-right' : ''}
                  >
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {node.rows.map((row, i) => (
                <TableRow key={i}>
                  {node.columns.map((column) => (
                    <TableCell
                      key={column.key}
                      className={
                        column.align === 'end' ? 'text-right tabular-nums' : ''
                      }
                    >
                      {row[column.key] === null ? '' : String(row[column.key])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableBox>
      )
    case 'svg': {
      const clean = sanitizeSvg(node.svg)
      return clean ? (
        <div
          role="img"
          aria-label={node.title}
          className="max-w-full overflow-auto [&>svg]:h-auto [&>svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: clean }}
        />
      ) : null
    }
    case 'input':
      return <InputNode node={node} {...ctx} />
    case 'button':
      return (
        <Button
          type="button"
          variant={node.variant ?? 'secondary'}
          disabled={ctx.busy}
          onClick={() => ctx.send(node.action)}
          className="w-fit"
        >
          {node.label}
        </Button>
      )
    case 'form':
      return (
        <form
          className="flex min-w-0 flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            ctx.send(node.submit.action)
          }}
        >
          {node.children.map((child, i) => (
            <Node key={i} node={child} {...ctx} />
          ))}
          <Button
            type="submit"
            variant="primary"
            disabled={ctx.busy}
            className="w-fit"
          >
            {node.submit.label}
          </Button>
        </form>
      )
    case 'link':
      return <InternalLink to={node.to}>{node.text}</InternalLink>
    case 'divider':
      return <hr className="m-0 border-0 border-t border-border" />
  }
}

function InternalLink({
  to,
  children,
}: {
  to: string
  children: React.ReactNode
}) {
  const router = useRouter()
  return (
    <a
      href={to}
      className="w-fit text-link"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return
        event.preventDefault()
        void router.navigate({ to: to as never })
      }}
    >
      {children}
    </a>
  )
}

function InputNode({
  node,
  values,
  setValue,
}: { node: Extract<ScreenNode, { type: 'input' }> } & NodeContext) {
  const value: unknown = (values as Record<string, unknown>)[node.name]
  if (node.kind === 'checkbox')
    return (
      <label className="flex items-center gap-2 text-body text-fg">
        <Checkbox
          checked={value === true}
          onCheckedChange={(next) => setValue(node.name, next === true)}
        />
        {node.label}
      </label>
    )
  return (
    <Field label={node.label} hint={node.help} required={node.required}>
      {node.kind === 'select' ? (
        <Select
          value={String(value ?? '')}
          onChange={(event) => setValue(node.name, event.target.value)}
        >
          {node.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          type={
            node.kind === 'number'
              ? 'number'
              : node.kind === 'date'
                ? 'date'
                : 'text'
          }
          step={node.kind === 'number' ? 'any' : undefined}
          required={node.required}
          value={String(value ?? '')}
          onChange={(event) =>
            setValue(
              node.name,
              node.kind === 'number' && event.target.value !== ''
                ? Number(event.target.value)
                : event.target.value,
            )
          }
        />
      )}
    </Field>
  )
}
