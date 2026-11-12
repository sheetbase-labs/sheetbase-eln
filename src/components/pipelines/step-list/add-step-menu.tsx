import { t } from '#/copy'
import { Button } from '#/components/ui/button'
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
          <Button
            size="sm"
            icon="plus"
            disabled={count >= MAX_STEPS}
            aria-haspopup="menu"
          />
        }
      >
        {t('data.stepList.addStep')}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[268px]">
        {ADD_GROUPS.map((group) => (
          <DropdownMenuGroup key={group.label}>
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.kinds.map((kind) => (
              <DropdownMenuItem
                key={kind}
                icon={KIND_META[kind].icon}
                hint={KIND_META[kind].hint}
                onClick={() => onAdd(kind)}
              >
                {KIND_META[kind].label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
        <p className="m-0 mt-1 border-t border-border-subtle px-2 pb-1 pt-1.5 text-caption leading-[15px] text-fg-muted">
          {t('data.stepList.addMenuFoot')}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
