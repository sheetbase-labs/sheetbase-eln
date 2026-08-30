export type ComponentStatus = 'stable' | 'beta' | 'draft'
export type ComponentLayer = 'foundation' | 'ui' | 'scientific' | 'pattern' | 'template'

export interface DesignSystemEntry {
  name: string
  layer: ComponentLayer
  status: ComponentStatus
  source: string
  description: string
}

export const designSystemRegistry: DesignSystemEntry[] = [
  { name: 'Button', layer: 'ui', status: 'stable', source: 'components/ui/button.tsx', description: 'Primary, secondary, outline, ghost, link and destructive actions.' },
  { name: 'Badge', layer: 'ui', status: 'stable', source: 'components/ui/badge.tsx', description: 'Compact labels and semantic state indicators.' },
  { name: 'Input', layer: 'ui', status: 'stable', source: 'components/ui/input.tsx', description: 'Single-line text, number, search and date entry.' },
  { name: 'Select', layer: 'ui', status: 'stable', source: 'components/ui/select.tsx', description: 'Accessible single-selection menu.' },
  { name: 'Dialog', layer: 'ui', status: 'stable', source: 'components/ui/dialog.tsx', description: 'Focused modal task surface.' },
  { name: 'Sheet', layer: 'ui', status: 'stable', source: 'components/ui/sheet.tsx', description: 'Edge-aligned overlay used for mobile inspectors.' },
  { name: 'Table', layer: 'ui', status: 'stable', source: 'components/ui/table.tsx', description: 'Semantic table primitives.' },
  { name: 'Command', layer: 'ui', status: 'stable', source: 'components/ui/command.tsx', description: 'Global search and command palette.' },
  { name: 'StatusBadge', layer: 'scientific', status: 'stable', source: 'components/sheetbase/status-badge.tsx', description: 'Controlled scientific record statuses.' },
  { name: 'NotebookBlock', layer: 'scientific', status: 'beta', source: 'components/sheetbase/notebook-block.tsx', description: 'Free-form ELN document block container.' },
  { name: 'PlateMap', layer: 'scientific', status: 'beta', source: 'components/sheetbase/plate-map.tsx', description: '96-well plate overview and selection.' },
  { name: 'ApprovalStepper', layer: 'scientific', status: 'beta', source: 'components/sheetbase/approval-stepper.tsx', description: 'Draft, review, approval and lock lifecycle.' },
  { name: 'Record document', layer: 'template', status: 'draft', source: 'routes/templates.tsx', description: 'Notebook canvas with project navigation and inspector.' },
  { name: 'Registry', layer: 'template', status: 'draft', source: 'routes/templates.tsx', description: 'Filterable data registry with selected-row inspector.' },
]
