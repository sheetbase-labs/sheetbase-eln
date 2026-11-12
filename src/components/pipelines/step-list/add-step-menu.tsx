import { t } from '#/copy'
import { BoardButton } from '#/features/pipelines/board/board'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { MAX_STEPS } from '#/lib/pipelines/config'
import type { PipelineStepKind } from '#/lib/pipelines/config'
import { ADD_GROUPS, KIND_META } from './kinds'

/** The Add step menu, grouped by what the step does. */
export function AddStepMenu({
  count,
  onAdd,
}: {
  count: number
  onAdd: (kind: PipelineStepKind) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <BoardButton
            size="sm"
            icon="plus"
            disabled={count >= MAX_STEPS}
            aria-haspopup="menu"
          />
        }
      >
        {t('data.stepList.addStep')}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[252px]">
        {ADD_GROUPS.map((group) => (
          <DropdownMenuGroup key={group.label}>
            <DropdownMenuLabel className="pt-[7px]">
              {group.label}
            </DropdownMenuLabel>
            {group.kinds.map((kind) => (
              <DropdownMenuItem
                key={kind}
                className="h-[27px]"
                icon={KIND_META[kind].icon}
                onClick={() => onAdd(kind)}
              >
                <span className="flex w-full min-w-0 items-baseline gap-2">
                  <span className="shrink-0">{KIND_META[kind].label}</span>
                  <span className="min-w-0 flex-1 truncate text-right text-[11px] text-fg-muted">
                    {KIND_META[kind].hint}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
        <p className="m-0 mt-1 border-t border-border-subtle px-2 pb-1 pt-1.5 text-[11px] leading-[15px] text-fg-muted">
          {t('data.stepList.addMenuFoot')}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
