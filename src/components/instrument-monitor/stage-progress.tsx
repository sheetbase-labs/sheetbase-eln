import {
  ArrowRight,
  CircleDot,
  Flame,
  Image,
  Repeat2,
  Thermometer,
} from 'lucide-react'

import { Badge } from '#/components/ui'
import {
  STAGE_STATUS_LABELS,
  STAGE_STATUS_TOKENS,
} from '#/lib/instrument-monitor'
import type { InstrumentRunStage, StageType } from '#/lib/instrument-monitor'
import { cn } from '#/lib/utils'

export interface StageProgressProps {
  stages: InstrumentRunStage[]
}

const STAGE_ICONS: Record<StageType, typeof CircleDot> = {
  hold: Thermometer,
  cycling: Repeat2,
  melt: Flame,
  image: Image,
  custom: CircleDot,
}

export function StageProgress({ stages }: StageProgressProps) {
  if (stages.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No stages defined for this run.
      </p>
    )

  return (
    <ol className="flex min-w-max items-center overflow-x-auto pb-2">
      {[...stages]
        .sort((a, b) => a.position - b.position)
        .map((stage, index) => {
          const Icon = STAGE_ICONS[stage.stageType]
          return (
            <li key={stage.id} className="flex items-center">
              {index > 0 ? (
                <ArrowRight
                  className="mx-2 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : null}
              <div className="min-w-32 rounded-md border p-2">
                <div className="flex items-center gap-1.5">
                  <Icon
                    className="size-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="truncate text-xs font-semibold">
                    {stage.name}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <Badge variant="outline" className="text-xs capitalize">
                    {stage.stageType}
                  </Badge>
                  <Badge
                    className={cn(
                      'text-xs',
                      STAGE_STATUS_TOKENS[stage.status],
                    )}
                  >
                    {STAGE_STATUS_LABELS[stage.status]}
                  </Badge>
                </div>
                {stage.stageType === 'cycling' && stage.cycleCount ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Cycle {stage.currentCycle}/{stage.cycleCount}
                  </p>
                ) : null}
              </div>
            </li>
          )
        })}
    </ol>
  )
}
