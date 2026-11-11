import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { Icon } from '#/components/icons'
import { Checkbox } from '#/components/ui/checkbox'
import { Muted } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
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
  const hiddenPages = new Set(hidden)

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

  const pageRows = navGroups.flatMap((group) =>
    group.items.map((item) => ({
      id: item.key,
      item,
      group: group.label,
      fixed: !canHideNavPage(item.key),
    })),
  )

  const columns: RegistryColumn<(typeof pageRows)[number]>[] = [
    {
      id: 'page',
      header: t('settings.sidebarPages.page'),
      accessorFn: (line) => line.item.label,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          <Icon
            name={row.original.item.icon}
            size={16}
            className="text-fg-muted"
          />
          {row.original.item.label}
        </span>
      ),
    },
    {
      id: 'group',
      header: t('settings.sidebarPages.group'),
      accessorFn: (line) => line.group,
      cell: ({ row }) => (
        <span className="text-fg-muted">{row.original.group}</span>
      ),
    },
    {
      id: 'shown',
      header: t('settings.sidebarPages.shown'),
      enableSorting: false,
      size: 140,
      cell: ({ row }) => {
        const { item, fixed } = row.original
        const shown = fixed || !hiddenPages.has(item.key)

        return fixed ? (
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
            onCheckedChange={(checked) => toggle(item.key, checked === true)}
          />
        )
      },
    },
  ]

  return (
    <SettingsBody>
      <TableBox>
        <RegistryGrid
          label={t('settings.sidebarPages.title')}
          rows={pageRows}
          columns={columns}
          getRowId={(line) => line.id}
          selectable={false}
          isLoading={query.isPending}
        />
      </TableBox>
      {canManage ? null : <Muted>{t('settings.sidebarPages.viewOnly')}</Muted>}
    </SettingsBody>
  )
}
