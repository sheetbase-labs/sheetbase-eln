import { SampleActionsContext } from './quantity-actions'
import type { SampleActions } from './quantity-actions'

export function SampleActionsProvider({
  actions,
  children,
}: {
  actions: SampleActions
  children: React.ReactNode
}) {
  return (
    <SampleActionsContext.Provider value={actions}>
      {children}
    </SampleActionsContext.Provider>
  )
}
