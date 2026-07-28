import {
  Grid3x3,
  Plus,
  Save,
  Shuffle,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react'

import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  Separator,
} from '#/components/ui'
import type { ControlPlacement, FillDirection } from '#/lib/plate-designer'
import { ASSIGNMENT_ROLES, ROLE_STYLES } from '#/lib/plate-map'
import type { AssignmentRole } from '#/lib/plate-map'

export interface AutoFillConfig {
  replicates: number
  fillDirection: FillDirection
  startWell: string
  randomize: boolean
  seed: number
  volumeValue: string
  volumeUnit: string
  controls: ControlPlacement[]
}

export interface PlateToolbarProps {
  config: AutoFillConfig
  onConfigChange: (config: AutoFillConfig) => void
  onAutoFill: () => void
  onClearAll: () => void
  onUndo: () => void
  canUndo: boolean
  onSave: () => void
  onImportCsv: () => void
  savePending: boolean
  hasDesign: boolean
  validationErrorCount: number
  selectedCount: number
  onAssignRole: (role: AssignmentRole) => void
  onClearSelected: () => void
}

export const DEFAULT_CONTROLS: ControlPlacement[] = [
  { role: 'positive_control', wellCode: 'A1' },
  { role: 'negative_control', wellCode: 'A12' },
  { role: 'blank', wellCode: 'H1' },
]

export function PlateToolbar(props: PlateToolbarProps) {
  const { config } = props
  const update = (patch: Partial<AutoFillConfig>) =>
    props.onConfigChange({ ...config, ...patch })
  const updateControl = (index: number, patch: Partial<ControlPlacement>) =>
    update({
      controls: config.controls.map((control, i) =>
        i === index ? { ...control, ...patch } : control,
      ),
    })

  return (
    <div className="space-y-4 rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">Assign selected</span>
        {ASSIGNMENT_ROLES.map((role) => (
          <Button
            key={role}
            size="sm"
            variant="outline"
            disabled={!props.selectedCount}
            className={ROLE_STYLES[role].badgeClass}
            onClick={() => props.onAssignRole(role)}
          >
            {ROLE_STYLES[role].label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          disabled={!props.selectedCount}
          onClick={props.onClearSelected}
        >
          <X className="size-3.5" /> Clear selected
        </Button>
        <Badge variant="outline">{props.selectedCount} selected</Badge>
      </div>
      <Separator />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Label>
          Replicates
          <Input
            className="mt-1"
            type="number"
            min={1}
            max={8}
            value={config.replicates}
            onChange={(e) => update({ replicates: Number(e.target.value) })}
          />
        </Label>
        <Label>
          Fill direction
          <Select
            className="mt-1"
            value={config.fillDirection}
            onChange={(e) =>
              update({ fillDirection: e.target.value as FillDirection })
            }
          >
            <option value="row">Row</option>
            <option value="column">Column</option>
            <option value="serpentine">Serpentine</option>
            <option value="column_serpentine">Column serpentine</option>
          </Select>
        </Label>
        <Label>
          Start well
          <Input
            className="mt-1"
            value={config.startWell}
            placeholder="A1"
            onChange={(e) =>
              update({ startWell: e.target.value.toUpperCase() })
            }
          />
        </Label>
        <div className="grid grid-cols-[auto_1fr] items-end gap-2">
          <Label className="flex h-9 items-center gap-2">
            <Checkbox
              checked={config.randomize}
              onCheckedChange={(checked) =>
                update({ randomize: checked === true })
              }
            />
            <Shuffle className="size-3.5" /> Randomize
          </Label>
          <Label>
            Seed
            <Input
              type="number"
              value={config.seed}
              disabled={!config.randomize}
              onChange={(e) => update({ seed: Number(e.target.value) })}
            />
          </Label>
        </div>
        <Label>
          Default volume
          <Input
            className="mt-1"
            type="number"
            min="0"
            value={config.volumeValue}
            onChange={(e) => update({ volumeValue: e.target.value })}
          />
        </Label>
        <Label>
          Volume unit
          <Input
            className="mt-1"
            value={config.volumeUnit}
            placeholder="µL"
            onChange={(e) => update({ volumeUnit: e.target.value })}
          />
        </Label>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Control placements</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              update({
                controls: [
                  ...config.controls,
                  { role: 'positive_control', wellCode: '' },
                ],
              })
            }
          >
            <Plus className="size-3.5" /> Add control
          </Button>
        </div>
        {config.controls.map((control, index) => (
          <div key={index} className="flex gap-2">
            <Select
              aria-label={`Control ${index + 1} role`}
              value={control.role}
              onChange={(e) =>
                updateControl(index, {
                  role: e.target.value as AssignmentRole,
                })
              }
            >
              {ASSIGNMENT_ROLES.filter((role) => role !== 'sample').map(
                (role) => (
                  <option key={role} value={role}>
                    {ROLE_STYLES[role].label}
                  </option>
                ),
              )}
            </Select>
            <Input
              aria-label={`Control ${index + 1} well`}
              value={control.wellCode}
              placeholder="A1"
              onChange={(e) =>
                updateControl(index, { wellCode: e.target.value.toUpperCase() })
              }
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove control ${index + 1}`}
              onClick={() =>
                update({
                  controls: config.controls.filter((_, i) => i !== index),
                })
              }
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <Separator />
      <div className="flex flex-wrap gap-2">
        <Button onClick={props.onAutoFill}>
          <Grid3x3 className="size-4" /> Auto-fill
        </Button>
        <Button
          variant="outline"
          disabled={!props.canUndo}
          onClick={props.onUndo}
        >
          <Undo2 className="size-4" /> Undo
        </Button>
        <Button variant="outline" onClick={props.onClearAll}>
          <Trash2 className="size-4" /> Clear all
        </Button>
        <Button variant="outline" onClick={props.onImportCsv}>
          <Upload className="size-4" /> Import CSV
        </Button>
        <Button
          className="ml-auto"
          disabled={!props.hasDesign || props.savePending}
          onClick={props.onSave}
        >
          <Save className="size-4" />
          {props.savePending ? 'Saving…' : 'Save'}
        </Button>
        {props.validationErrorCount > 0 && (
          <Badge variant="danger">{props.validationErrorCount} issues</Badge>
        )}
      </div>
    </div>
  )
}
