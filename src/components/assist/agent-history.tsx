import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import { Muted } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { t } from '#/copy'
import { cn } from '#/lib/utils'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  conversationKeys,
  deleteConversation,
  fetchConversations,
  groupConversations,
  renameConversation,
} from '#/lib/agent-conversations'
import type { ConversationSummary } from '#/lib/agent-conversations'

/**
 * The left of the Agent page: the person's chats, newest first in groups
 * (Today, Yesterday, Previous 7 days, Earlier), with a search box, and rename
 * and delete on each row. The list is theirs alone.
 */
export function AgentHistory({
  workspaceId,
  activeId,
  onNewChat,
  onDeleted,
}: {
  workspaceId: string
  activeId: string | null
  onNewChat: () => void
  onDeleted: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null)

  const listQuery = useQuery({
    queryKey: conversationKeys.all(workspaceId),
    queryFn: () => fetchConversations(notebookDataClient, workspaceId),
  })

  const rename = useMutation({
    mutationFn: (input: { id: string; title: string }) =>
      renameConversation(notebookDataClient, input.id, input.title),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: conversationKeys.all(workspaceId),
      }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteConversation(notebookDataClient, id),
    onSuccess: (_result, id) => {
      toast.success(t('features.assistantConversations.page.deleted'))
      onDeleted(id)
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: conversationKeys.all(workspaceId),
      }),
  })

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase()

    const rows = (listQuery.data ?? []).filter(
      (row) => needle === '' || row.title.toLowerCase().includes(needle),
    )

    return groupConversations(rows)
  }, [listQuery.data, search])

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="agent-history">
      <div className="flex flex-col gap-2 p-3">
        <Button variant="secondary" onClick={onNewChat} className="w-full">
          <Icon name="squarePen" size={14} />
          {t('features.assistantConversations.page.newChat')}
        </Button>
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t(
            'features.assistantConversations.page.searchPlaceholder',
          )}
          aria-label={t(
            'features.assistantConversations.page.searchPlaceholder',
          )}
        />
      </div>

      <nav
        aria-label={t('features.assistantConversations.page.history')}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
      >
        {listQuery.isPending ? (
          <div className="flex flex-col gap-2 p-1">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-5/6" />
            <Skeleton className="h-7 w-4/6" />
          </div>
        ) : listQuery.isError ? (
          <Muted className="px-2 py-3">
            {t('features.assistantConversations.page.loadFailed')}
          </Muted>
        ) : groups.length === 0 ? (
          <Muted className="px-2 py-3">
            {search.trim() === ''
              ? t('features.assistantConversations.page.noChats')
              : t('features.assistantConversations.page.noMatches')}
          </Muted>
        ) : (
          groups.map(({ group, rows }) => (
            <section key={group} className="mb-3">
              <h3 className="m-0 px-2 pt-2 pb-1 text-label font-medium text-fg-muted">
                {t(`features.assistantConversations.page.groups.${group}`)}
              </h3>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {rows.map((row) => (
                  <li key={row.id}>
                    <HistoryRow
                      row={row}
                      active={row.id === activeId}
                      renaming={renaming === row.id}
                      onStartRename={() => setRenaming(row.id)}
                      onStopRename={() => setRenaming(null)}
                      onRename={(title) => {
                        setRenaming(null)

                        if (title !== '' && title !== row.title) {
                          rename.mutate({ id: row.id, title })
                        }
                      }}
                      onDelete={() => setDeleting(row)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </nav>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('features.assistantConversations.page.deleteTitle')}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('features.assistantConversations.page.deleteBody')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('features.assistantConversations.page.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              onClick={() => {
                if (deleting) remove.mutate(deleting.id)
                setDeleting(null)
              }}
            >
              {t('features.assistantConversations.page.deleteConfirm')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}

function HistoryRow({
  row,
  active,
  renaming,
  onStartRename,
  onStopRename,
  onRename,
  onDelete,
}: {
  row: ConversationSummary
  active: boolean
  renaming: boolean
  onStartRename: () => void
  onStopRename: () => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
  if (renaming) {
    return (
      <Input
        autoFocus
        defaultValue={row.title}
        maxLength={200}
        aria-label={t('features.assistantConversations.page.renameLabel')}
        onBlur={(event) => onRename(event.target.value.trim())}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onRename(event.currentTarget.value.trim())

          if (event.key === 'Escape') onStopRename()
        }}
      />
    )
  }

  return (
    <div
      className={cn(
        'group/row flex items-center rounded-md hover:bg-surface-hover',
        active && 'bg-surface-hover',
      )}
    >
      <Link
        to="/agent"
        search={{ c: row.id }}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'min-w-0 flex-1 truncate px-2 py-1.5 text-body text-fg no-underline',
          active && 'font-medium',
        )}
        title={row.title}
      >
        {row.title}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="quiet"
              size="icon"
              icon="more"
              aria-label={t('features.assistantConversations.page.chatActions')}
              className="mr-0.5 shrink-0 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100 max-md:opacity-100"
            />
          }
        />
        <DropdownMenuContent className="w-[160px]">
          <DropdownMenuItem icon="squarePen" onClick={onStartRename}>
            {t('features.assistantConversations.page.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem icon="trash" onClick={onDelete}>
            {t('features.assistantConversations.page.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
