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
  STAGE_STATUS_BADGE_VARIANT,
  STAGE_STATUS_LABELS,
} from '#/lib/instrument-monitor'
import type { InstrumentRunStage, StageType } from '#/lib/instrument-monitor'

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
    <ol className="flex min-w-max items-center gap-1 overflow-x-auto pb-1">
      {[...stages]
        .sort((a, b) => a.position - b.position)
        .map((stage, index) => {
          const Icon = STAGE_ICONS[stage.stageType]
          return (
            <li key={stage.id} className="flex items-center">
              {index > 0 ? (
                <ArrowRight
                  className="mx-1.5 size-4 shrink-0 text-muted-foreground/40"
                  aria-hidden="true"
                />
              ) : null}
              <div className="min-w-28 rounded-md bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <Icon
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="truncate text-xs font-semibold">
                    {stage.name}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Badge
                    variant={STAGE_STATUS_BADGE_VARIANT[stage.status]}
                    className="whitespace-nowrap text-xs"
                  >
                    {STAGE_STATUS_LABELS[stage.status]}
                  </Badge>
                  {stage.stageType === 'cycling' && stage.cycleCount ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {stage.currentCycle}/{stage.cycleCount}
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          )
        })}
    </ol>
  )
}
