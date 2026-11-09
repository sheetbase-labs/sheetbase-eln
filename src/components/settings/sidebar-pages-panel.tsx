import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { Icon } from '#/components/icons'
import { Checkbox } from '#/components/ui/checkbox'
import { Muted } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { SettingsBody } from '#/components/settings/settings-page'
import { canHideNavPage, navGroups } from '#/components/shell/nav'
import { ROOT_CONTEXT_QUERY_KEY } from '#/lib/root-context-cache'
import {
  fetchHiddenNavPages,
  setHiddenNavPages,
  sidebarPagesQueryKey,
} from '#/lib/sidebar-pages'
import type { DataClient } from '#/lib/data-client'
import { t } from '#/copy'

/**
 * The pages a lab lists in everyone's sidebar. Unticking one takes it out of
 * the sidebar only; the page still opens from search and links.
 */
export function SidebarPagesPanel({
  workspaceId,
  canManage,
  client,
}: {
  workspaceId: string
  canManage: boolean
  client?: DataClient
}) {
  const queryClient = useQueryClient()
  const router = useRouter()

  const query = useQuery({
    queryKey: sidebarPagesQueryKey(workspaceId),
    queryFn: () => fetchHiddenNavPages(workspaceId, client),
    enabled: workspaceId !== '',
  })

  // What was just ticked shows straight away, before the save comes back.
  const [draft, setDraft] = useState<string[] | null>(null)
  const hidden = draft ?? query.data ?? []

  const save = useMutation({
    mutationFn: (pages: string[]) =>
      setHiddenNavPages(workspaceId, pages, client),
    onSuccess: async (_, pages) => {
      queryClient.setQueryData(sidebarPagesQueryKey(workspaceId), pages)
      setDraft(null)
      // The sidebar is part of the shell, which reads it with the rest of
      // the page context.
      queryClient.removeQueries({ queryKey: ROOT_CONTEXT_QUERY_KEY })
      await router.invalidate()
      toast(t('settings.sidebarPages.saved'))
    },
    onError: () => {
      setDraft(null)
      toast.error(t('settings.sidebarPages.saveFailed'))
    },
  })

  const busy = !canManage || query.isPending || save.isPending

  function toggle(page: string, shown: boolean) {
    const next = shown
      ? hidden.filter((p) => p !== page)
      : [...new Set([...hidden, page])]

    setDraft(next)
    save.mutate(next)
  }

  return (
    <SettingsBody>
      <TableBox>
        <Table caption={t('settings.sidebarPages.title')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('settings.sidebarPages.page')}</TableHead>
              <TableHead>{t('settings.sidebarPages.group')}</TableHead>
              <TableHead className="w-0">
                {t('settings.sidebarPages.shown')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody loading={query.isPending} colSpan={3}>
            {navGroups.flatMap((group) =>
              group.items.map((item) => {
                const fixed = !canHideNavPage(item.key)
                const shown = fixed || !hidden.includes(item.key)

                return (
                  <TableRow key={item.key}>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        <Icon
                          name={item.icon}
                          size={16}
                          className="text-fg-muted"
                        />
                        {item.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {group.label}
                    </TableCell>
                    <TableCell>
                      {fixed ? (
                        <span className="text-label text-fg-muted">
                          {t('settings.sidebarPages.alwaysShown')}
                        </span>
                      ) : (
                        <Checkbox
                          aria-label={t('settings.sidebarPages.showPage', {
                            page: item.label,
                          })}
                          checked={shown}
                          disabled={busy}
                          onCheckedChange={(checked) =>
                            toggle(item.key, checked === true)
                          }
                        />
                      )}
                    </TableCell>
                  </TableRow>
                )
              }),
            )}
          </TableBody>
        </Table>
      </TableBox>
      {canManage ? null : <Muted>{t('settings.sidebarPages.viewOnly')}</Muted>}
    </SettingsBody>
  )
}
