import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Icon } from '#/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { t } from '#/copy'

import type { IconName } from '#/components/icons'

/** One thing you can do with the record that is not its main button. */
export interface RecordAction {
  id: string
  label: string
  icon: IconName
  /** A plain download or link; otherwise `onSelect` runs. */
  href?: string
  /** An in-app link, opened with the router. */
  to?: string
  onSelect?: () => void
}

interface RecordActionsValue {
  actions: readonly RecordAction[]
  setActions: (actions: readonly RecordAction[]) => void
}

const RecordActionsContext = createContext<RecordActionsValue | null>(null)

/**
 * The experiment page keeps one ⋯ menu in its header. The notebook below it
 * owns the dialogs those actions open (print labels, link records, withdraw),
 * so it hands its actions up here and the header menu shows them.
 */
export function RecordActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<readonly RecordAction[]>([])
  const value = useMemo(() => ({ actions, setActions }), [actions])
  return (
    <RecordActionsContext.Provider value={value}>
      {children}
    </RecordActionsContext.Provider>
  )
}

/** The actions the notebook below has offered, for the page's ⋯ menu. */
export function useOfferedRecordActions(): readonly RecordAction[] {
  return useContext(RecordActionsContext)?.actions ?? []
}

/**
 * Offer actions to the page's ⋯ menu. Returns false when there is no menu to
 * receive them, so the caller shows its own. Handlers may change identity
 * between renders; only the set of ids and labels re-registers.
 */
export function useOfferRecordActions(
  actions: readonly RecordAction[],
  enabled: boolean,
): boolean {
  const context = useContext(RecordActionsContext)
  const setActions = context?.setActions
  const key = actions.map((a) => `${a.id}:${a.label}:${a.href ?? ''}`).join('|')
  // The handlers are read when an item is picked, not when it is registered.
  useEffect(() => {
    if (!setActions || !enabled) return
    setActions(actions)
    return () => setActions([])
  }, [setActions, enabled, key])
  return Boolean(context) && enabled
}

/** The items for a menu, as links or buttons. */
export function RecordActionItems({
  actions,
}: {
  actions: readonly RecordAction[]
}) {
  const navigate = useNavigate()
  return (
    <>
      {actions.map((action) =>
        action.href ? (
          <DropdownMenuLinkItem
            key={action.id}
            icon={action.icon}
            render={<a href={action.href} />}
          >
            {action.label}
          </DropdownMenuLinkItem>
        ) : (
          <DropdownMenuItem
            key={action.id}
            icon={action.icon}
            onClick={() =>
              action.to ? void navigate({ to: action.to }) : action.onSelect?.()
            }
          >
            {action.label}
          </DropdownMenuItem>
        ),
      )}
    </>
  )
}

/** A record's own ⋯ menu, for pages that have no menu of their own. */
export function RecordActionsMenu({
  actions,
}: {
  actions: readonly RecordAction[]
}) {
  if (actions.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="quiet"
            size="icon"
            aria-label={t('notebook.notebookPage.moreRecordActionsAriaLabel')}
            data-print-hide
          >
            <Icon name="more" size={14} />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <RecordActionItems actions={actions} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
