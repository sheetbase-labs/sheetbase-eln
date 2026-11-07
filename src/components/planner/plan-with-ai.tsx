import { useState } from 'react'

import { Button } from '#/components/ui/button'
import { t } from '#/copy'
import { usePageAi } from '#/lib/use-page-ai'

import { PlanDialog } from './plan-dialog'

/** The "Plan with AI" button, shown only when a real model is connected. */
export function PlanWithAi() {
  const ai = usePageAi()
  const [open, setOpen] = useState(false)
  if (!ai.live) return null
  return (
    <>
      <Button icon="spark" onClick={() => setOpen(true)}>
        {t('planner.plans.planWithAi')}
      </Button>
      <PlanDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
