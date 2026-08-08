/** OPS-007 — Report outline: the ordered, editable list of report sections. */
import { ArrowDown, ArrowUp, FileText, GripVertical, Plus } from 'lucide-react'

import { Badge, Button } from '#/components/ui'
import {
  SECTION_TYPE_LABELS,
  VALIDATION_STATUS_BADGE_VARIANT,
  VALIDATION_STATUS_LABELS,
} from '#/lib/report-builder'
import type { ReportSection } from '#/lib/report-builder'
import { cn } from '#/lib/utils'

export interface ReportOutlineProps {
  sections: ReportSection[]
  selectedSectionId: string | null
  onSelectSection: (id: string) => void
  onAddSection: () => void
  onMoveSection: (id: string, direction: 'up' | 'down') => void
}

export function ReportOutline({
  sections,
  selectedSectionId,
  onSelectSection,
  onAddSection,
  onMoveSection,
}: ReportOutlineProps) {
  const ordered = sections.slice().sort((a, b) => a.position - b.position)
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
        <h2 className="text-xs font-semibold uppercase text-muted-foreground">
          Report outline
        </h2>
        <Button size="sm" variant="ghost" onClick={onAddSection}>
          <Plus className="size-4" /> Add section
        </Button>
      </div>
      {ordered.length === 0 ? (
        <p className="px-3 py-6 text-sm text-muted-foreground">
          No sections yet. Each section is a titled part of the report; add one,
          then edit its content and type before validating sources.
        </p>
      ) : (
        <ol className="flex-1 overflow-auto py-1">
          {ordered.map((section, index) => {
            const isSelected = section.id === selectedSectionId
            return (
              <li key={section.id} className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => onSelectSection(section.id)}
                  aria-label={`Edit ${section.title} section`}
                  aria-current={isSelected ? 'true' : undefined}
                  className={cn(
                    'flex min-w-0 flex-1 items-start gap-2 border-l-2 px-3 py-2 text-left transition-colors',
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-transparent hover:bg-muted/40',
                  )}
                >
                  <GripVertical className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">
                        {index + 1}
                      </span>
                      <FileText className="size-3.5 text-muted-foreground" />
                      <span className="truncate text-sm font-medium">
                        {section.title}
                      </span>
                    </span>
                    {section.description ? (
                      <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">
                        {section.description}
                      </span>
                    ) : null}
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge variant="outline" className="text-xs font-normal">
                        {SECTION_TYPE_LABELS[section.sectionType]}
                      </Badge>
                      <Badge
                        variant={
                          VALIDATION_STATUS_BADGE_VARIANT[
                            section.validationStatus
                          ]
                        }
                        className="text-xs"
                      >
                        {VALIDATION_STATUS_LABELS[section.validationStatus]}
                      </Badge>
                    </span>
                  </span>
                </button>
                <span className="flex shrink-0 flex-col pr-2 pt-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-5"
                    aria-label={`Move ${section.title} up`}
                    disabled={index === 0}
                    onClick={() => onMoveSection(section.id, 'up')}
                  >
                    <ArrowUp className="size-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-5"
                    aria-label={`Move ${section.title} down`}
                    disabled={index === ordered.length - 1}
                    onClick={() => onMoveSection(section.id, 'down')}
                  >
                    <ArrowDown className="size-3" />
                  </Button>
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
