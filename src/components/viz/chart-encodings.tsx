/**
 * R5-STUDIO-02 — the drag-and-drop encoding authoring surface.
 *
 * A grouped field list (Measured · Derived · Run metadata) whose rows carry a
 * role menu, and one slot per encoding role that accepts a dropped field *and*
 * a keyboard choice through its own select. Both routes call `onAssign`, so
 * the spec they build is identical; a drop the role cannot take is refused
 * with the reason from `checkAssignment` and never reassigned.
 *
 * Drag state and outcomes are announced through a live region so the surface
 * is usable without a pointer.
 */
import { useState } from 'react'
import type { DragEvent } from 'react'

import { Icon } from '#/components/v3/icons'
import { Button } from '#/components/v3/ui/button'
import { NativeSelect } from '#/components/v3/projects/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import {
  CHART_ROLES,
  FIELD_DRAG_TYPE,
  ROLE_LABEL,
  boundFieldId,
  checkAssignment,
  columnsForRole,
  groupedFields,
  isMeasuredColumn,
  roleAvailableForType,
} from '#/lib/chart-encodings'
import type { ChartRole } from '#/lib/chart-encodings'
import type { ChartColumn, ChartSpec } from '#/lib/chart-spec'
import { cn } from '#/lib/utils'

export interface ChartEncodingEditorProps {
  idPrefix: string
  columns: ChartColumn[]
  spec: ChartSpec
  /** Bind `fieldId` to `role`, or clear the role when `fieldId` is null. */
  onAssign: (role: ChartRole, fieldId: string | null) => void
}

type Notice = { tone: 'info' | 'refused'; message: string }

/** The unit recorded on a field, whether the schema stores a symbol or text. */
function unitLabel(unit: unknown): string | null {
  if (typeof unit === 'string' && unit.trim() !== '') return unit
  if (unit && typeof unit === 'object' && 'symbol' in unit) {
    if (typeof unit.symbol === 'string' && unit.symbol !== '') return unit.symbol
  }
  return null
}

export function ChartEncodingEditor({
  idPrefix,
  columns,
  spec,
  onAssign,
}: ChartEncodingEditorProps) {
  const type = spec.type
  const roles = CHART_ROLES.filter(
    (role) => roleAvailableForType(role, type).ok,
  )
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<ChartRole | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  function drop(role: ChartRole, event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setOver(null)
    setDragging(null)
    const fieldId = event.dataTransfer.getData(FIELD_DRAG_TYPE)
    const column = fieldId
      ? columns.find((candidate) => candidate.id === fieldId)
      : undefined
    if (!column) return
    const verdict = checkAssignment(role, column, type)
    if (!verdict.ok) {
      setNotice({ tone: 'refused', message: verdict.reason })
      return
    }
    onAssign(role, column.id)
    setNotice({
      tone: 'info',
      message: `${column.label} assigned to ${ROLE_LABEL[role]}.`,
    })
  }

  return (
    <section aria-labelledby={`${idPrefix}-title`} className="space-y-2">
      <h3 id={`${idPrefix}-title`} className="text-xs font-medium text-fg-muted">
        Fields and roles
      </h3>
      <p className="text-xs text-fg-muted">
        Drag a field onto a role, or assign it from the field’s menu or the
        role dropdown.
      </p>
      {notice ? (
        <p
          role={notice.tone === 'refused' ? 'alert' : 'status'}
          aria-live={notice.tone === 'refused' ? 'assertive' : 'polite'}
          className={cn(
            'text-xs',
            notice.tone === 'refused' ? 'text-danger-text' : 'text-fg-muted',
          )}
        >
          {notice.message}
        </p>
      ) : null}
      <div className="space-y-2">
        <div className="flex flex-col gap-2">
          {groupedFields(columns).map(({ group, columns: groupColumns }) => (
            <div key={group}>
              <p className="pb-1 text-[11px] font-medium text-fg-muted">
                {group}
              </p>
              <ul aria-label={`${group} fields`} className="m-0 list-none p-0">
                {groupColumns.map((column) => {
                  const assignable = roles.filter(
                    (role) => checkAssignment(role, column, type).ok,
                  )
                  const unit = isMeasuredColumn(column)
                    ? unitLabel(column.unit)
                    : null
                  const filled = CHART_ROLES.filter(
                    (role) => boundFieldId(spec, role) === column.id,
                  )
                  return (
                    <li
                      key={column.id}
                      draggable={assignable.length > 0}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(FIELD_DRAG_TYPE, column.id)
                        event.dataTransfer.effectAllowed = 'copy'
                        setDragging(column.id)
                        setNotice({
                          tone: 'info',
                          message: `Picked up ${column.label}. Drop it on a role, or use its role menu.`,
                        })
                      }}
                      onDragEnd={() => {
                        setDragging(null)
                        setOver(null)
                      }}
                      className={cn(
                        'grid grid-cols-[10px_1fr_auto_auto] items-center gap-1 rounded-[5px] px-1 py-0.5 text-label',
                        dragging === column.id
                          ? 'bg-selection'
                          : 'hover:bg-surface-hover',
                        assignable.length > 0 && 'cursor-grab active:cursor-grabbing',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="select-none text-[10px] leading-none tracking-[-2px] text-fg-faint"
                      >
                        ⋮⋮
                      </span>
                      <span className="min-w-0 truncate" title={column.label}>
                        {column.label}
                      </span>
                      <span className="whitespace-nowrap text-[11px] text-fg-muted">
                        {isMeasuredColumn(column) && !unit ? (
                          <span className="text-warning-text">no unit</span>
                        ) : (
                          unit
                        )}
                        {filled.length > 0 ? (
                          <span className="font-medium text-fg">
                            {' '}
                            · {filled.map((role) => ROLE_LABEL[role]).join(', ')}
                          </span>
                        ) : null}
                      </span>
                      {assignable.length > 0 ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="quiet"
                                size="icon"
                                icon="plus"
                                aria-label={`Assign ${column.label} to a role`}
                                className="text-fg-muted"
                              />
                            }
                          />
                          <DropdownMenuContent align="end" className="w-[190px]">
                            <DropdownMenuGroup>
                              <DropdownMenuLabel>
                                Assign {column.label} to
                              </DropdownMenuLabel>
                              {assignable.map((role) => (
                                <DropdownMenuItem
                                  key={role}
                                  hint={
                                    boundFieldId(spec, role) === column.id
                                      ? 'now'
                                      : undefined
                                  }
                                  onClick={() => {
                                    onAssign(role, column.id)
                                    setNotice({
                                      tone: 'info',
                                      message: `${column.label} assigned to ${ROLE_LABEL[role]}.`,
                                    })
                                  }}
                                >
                                  {ROLE_LABEL[role]}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <Button
                          variant="quiet"
                          size="icon"
                          disabled
                          aria-label={`${column.label} cannot fill a role on this chart`}
                        >
                          <Icon name="plus" size={12} />
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {roles.map((role) => {
            const options = columnsForRole(role, columns, type)
            const value = boundFieldId(spec, role) ?? ''
            return (
              <div
                key={role}
                data-drop-role={role}
                onDragOver={(event) => {
                  if (
                    Array.from(event.dataTransfer.types).includes(
                      FIELD_DRAG_TYPE,
                    )
                  ) {
                    event.preventDefault()
                    setOver(role)
                  }
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(event) => drop(role, event)}
                className={cn(
                  'min-w-32 flex-1 rounded-md border p-1.5',
                  over === role
                    ? 'border-link bg-selection-subtle'
                    : 'border-border',
                )}
              >
                <label
                  htmlFor={`${idPrefix}-${role}`}
                  className="text-label text-fg-muted"
                >
                  {ROLE_LABEL[role]}
                </label>
                <NativeSelect
                  id={`${idPrefix}-${role}`}
                  aria-label={`${ROLE_LABEL[role]} field`}
                  value={value}
                  onChange={(event) =>
                    onAssign(role, event.target.value || null)
                  }
                  className="bg-surface"
                >
                  {role !== 'y' ? <option value="">None</option> : null}
                  {options.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
