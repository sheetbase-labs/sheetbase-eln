import * as React from 'react'
import { X } from 'lucide-react'

import {
  EmptyHint,
  InspectorSection,
  Property,
  PropertyList,
} from '#/components/record'
import { Badge, Button, Input, Label, Select, Textarea } from '#/components/ui'
import type {
  PlateDesignDoc,
  PlateDesignValidationError,
  PlateWellAssignment,
} from '#/lib/plate-designer'
import { ASSIGNMENT_ROLES, ROLE_STYLES, rowLabel } from '#/lib/plate-map'
import type { AssignmentRole } from '#/lib/plate-map'
import { explainPlateValidation } from '#/lib/assist-explain'
import { ExplainPanel } from '#/components/assist/explain-panel'

export interface PlateInspectorProps {
  well: PlateWellAssignment | null
  wellCode: string | null
  validationErrors: PlateDesignValidationError[]
  design: PlateDesignDoc | null
  saveHistory: Array<{ action: string; timestamp: string; wellCount: number }>
  onClose?: () => void
  onEditWell: (patch: Partial<PlateWellAssignment>) => void
}
/**
 * ASSIST-01 entry point: explains the well's validation errors in plain
 * language, grounded in the plate-designer kernel with a citation per rule.
 * Read-only — no mutation path.
 */
function PlateValidationExplain({
  errors,
}: {
  errors: PlateDesignValidationError[]
}) {
  const [showExplain, setShowExplain] = React.useState(false)
  const explanation = explainPlateValidation({ errors })
  if (!explanation) return null
  return (
    <div className="pt-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-expanded={showExplain}
        onClick={() => setShowExplain((value) => !value)}
      >
        {showExplain ? 'Hide explanation' : 'Explain'}
      </Button>
      {showExplain ? (
        <div className="pt-1">
          <ExplainPanel explanation={explanation} />
        </div>
      ) : null}
    </div>
  )
}

export function PlateInspector(props: PlateInspectorProps) {
  const { well, design } = props
  if (!well)
    return (
      <div className="p-4">
        <EmptyHint>Select a well to see details</EmptyHint>
      </div>
    )
  const errors = props.validationErrors.filter(
    (error) =>
      error.wellCode === well.wellCode || error.field?.includes(well.wellCode),
  )
  const counts = design
    ? {
        total: design.rows * design.cols,
        assigned: design.wells.length,
        controls: design.wells.filter((item) => item.role.includes('control'))
          .length,
        samples: design.wells.filter((item) => item.role === 'sample').length,
        empty:
          design.rows * design.cols -
          design.wells.filter((item) => item.role !== 'empty').length,
      }
    : { total: 0, assigned: 0, controls: 0, samples: 0, empty: 0 }
  const numeric = (value: string) => (value === '' ? undefined : Number(value))

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <header className="flex items-center gap-2 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Well {props.wellCode}</h2>
          <p className="text-xs text-muted-foreground">Plate assignment</p>
        </div>
        {props.onClose && (
          <Button
            size="sm"
            variant="ghost"
            aria-label="Close inspector"
            onClick={props.onClose}
          >
            <X className="size-4" />
          </Button>
        )}
      </header>
      <InspectorSection title="Well details">
        <PropertyList>
          <Property label="Well" mono>
            {well.wellCode}
          </Property>
          <Property label="Role">
            <Badge className={ROLE_STYLES[well.role].badgeClass}>
              {ROLE_STYLES[well.role].label}
            </Badge>
          </Property>
          <Property label="Position">
            Row {rowLabel(well.row)}, column {well.col + 1}
          </Property>
          <Property label="Replicate">{well.replicate ?? '—'}</Property>
          <Property label="Sample identifier" mono>
            {well.sampleRef?.identifier ?? '—'}
          </Property>
          <Property label="Sample title">
            {well.sampleRef?.title ?? '—'}
          </Property>
        </PropertyList>
        <Label>
          Role
          <Select
            className="mt-1"
            value={well.role}
            onChange={(e) =>
              props.onEditWell({ role: e.target.value as AssignmentRole })
            }
          >
            {ASSIGNMENT_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_STYLES[role].label}
              </option>
            ))}
          </Select>
        </Label>
      </InspectorSection>
      <InspectorSection title="Volume & concentration">
        <div className="grid grid-cols-2 gap-2">
          <Label>
            Volume
            <Input
              type="number"
              value={well.volume?.value ?? ''}
              onChange={(e) =>
                props.onEditWell({
                  volume:
                    e.target.value === ''
                      ? undefined
                      : {
                          value: Number(e.target.value),
                          unit: well.volume?.unit ?? 'µL',
                        },
                })
              }
            />
          </Label>
          <Label>
            Unit
            <Input
              value={well.volume?.unit ?? ''}
              onChange={(e) =>
                props.onEditWell({
                  volume: {
                    value: well.volume?.value ?? 0,
                    unit: e.target.value,
                  },
                })
              }
            />
          </Label>
          <Label>
            Concentration
            <Input
              type="number"
              value={well.concentrationValue ?? ''}
              onChange={(e) =>
                props.onEditWell({
                  concentrationValue: numeric(e.target.value),
                })
              }
            />
          </Label>
          <Label>
            Unit
            <Input
              value={well.concentrationUnit ?? ''}
              onChange={(e) =>
                props.onEditWell({
                  concentrationUnit: e.target.value || undefined,
                })
              }
            />
          </Label>
        </div>
      </InspectorSection>
      <InspectorSection title="Linked records">
        {well.sampleRef ? (
          <PropertyList>
            <Property label="Identifier" mono>
              {well.sampleRef.identifier}
            </Property>
            <Property label="Title">{well.sampleRef.title}</Property>
            <Property label="Record ID" mono>
              {well.sampleRef.recordId}
            </Property>
          </PropertyList>
        ) : (
          <EmptyHint>No linked records</EmptyHint>
        )}
      </InspectorSection>
      <InspectorSection title="Notes">
        <Textarea
          value={well.notes ?? ''}
          onChange={(e) => props.onEditWell({ notes: e.target.value })}
        />
      </InspectorSection>
      <InspectorSection title="Validation">
        {errors.length ? (
          <>
            <ul className="space-y-1 text-xs text-danger">
              {errors.map((error, index) => (
                <li
                  key={`${error.code}-${index}`}
                  className="rounded border border-danger/30 bg-danger/5 p-2"
                >
                  {error.message}
                </li>
              ))}
            </ul>
            <PlateValidationExplain errors={errors} />
          </>
        ) : (
          <p className="rounded border border-success/30 bg-success/10 p-2 text-xs text-success">
            No issues
          </p>
        )}
      </InspectorSection>
      <InspectorSection title="Plate summary">
        <PropertyList>
          <Property label="Total wells">{counts.total}</Property>
          <Property label="Assigned">{counts.assigned}</Property>
          <Property label="Controls">{counts.controls}</Property>
          <Property label="Samples">{counts.samples}</Property>
          <Property label="Empty">{counts.empty}</Property>
        </PropertyList>
      </InspectorSection>
      <InspectorSection title="History">
        {props.saveHistory.length ? (
          <ul className="space-y-2 text-xs">
            {props.saveHistory.map((entry, index) => (
              <li key={`${entry.timestamp}-${index}`}>
                <strong>{entry.action}</strong> · {entry.wellCount} wells
                <span className="block text-muted-foreground">
                  {new Date(entry.timestamp).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyHint>No save history</EmptyHint>
        )}
      </InspectorSection>
    </div>
  )
}
