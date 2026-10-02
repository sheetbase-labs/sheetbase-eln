import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PageHeader, Muted, Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { NativeSelect } from '#/components/v3/projects/select'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { toast } from '#/components/v3/ui/sonner'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  fetchBlocksForRecord,
  fetchRecord,
  fetchLinksForRecord,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import type { RevisionWire } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { protocolStatus } from '../protocols'

const tabs = ['document', 'template', 'usedby', 'versions', 'training'] as const
type ProtocolTab = (typeof tabs)[number]

/** UI port (roadmap-4/ui-app3): the protocol detail frame. The controlled
 * document is the record's rich-text blocks; Template, Used by and Versions
 * read the real structure, links and revisions; Training records who is
 * trained via `record_protocol_training`. */
export const Route = createFileRoute('/protocols/$protocolId')({
  validateSearch: (search: Record<string, unknown>): { tab?: ProtocolTab } => ({
    tab:
      search.tab === 'template' ||
      search.tab === 'usedby' ||
      search.tab === 'versions' ||
      search.tab === 'document' ||
      search.tab === 'training'
        ? search.tab
        : undefined,
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: ProtocolPage,
})

interface DocumentPart {
  kind: 'heading' | 'paragraph'
  text: string
}

/** The controlled document is the protocol record's rich-text blocks. */
function richTextParts(
  blocks: { type: string; payload: Record<string, unknown> }[],
): DocumentPart[] {
  const parts: DocumentPart[] = []
  for (const block of blocks) {
    if (block.type !== 'rich_text') continue
    const doc = (block.payload as { doc?: { content?: unknown[] } }).doc
    const content = Array.isArray(doc?.content) ? doc.content : []
    for (const node of content) {
      const n = node as { type?: string; content?: { text?: string }[] }
      if (n.type !== 'heading' && n.type !== 'paragraph') continue
      const text = (n.content ?? []).map((c) => c.text ?? '').join('')
      if (text.trim()) parts.push({ kind: n.type, text })
    }
  }
  return parts
}

function ProtocolPage() {
  const { protocolId } = Route.useParams()
  const [tab, setTab] = useState<ProtocolTab>('document')
  const record = useQuery({
    queryKey: notebookQueryKeys.record(protocolId),
    queryFn: () => fetchRecord(notebookDataClient, protocolId),
  })
  const blocks = useQuery({
    queryKey: ['ui-port', 'protocol-blocks', protocolId],
    queryFn: () => fetchBlocksForRecord(notebookDataClient, protocolId),
  })
  const links = useQuery({
    queryKey: ['ui-port', 'protocol-links', protocolId],
    queryFn: () => fetchLinksForRecord(notebookDataClient, protocolId),
  })
  const revisions = useQuery({
    queryKey: ['ui-port', 'protocol-revisions', protocolId],
    queryFn: () =>
      notebookDataClient.list<RevisionWire>(
        'revisions',
        `?record_id=eq.${encodeURIComponent(protocolId)}&order=created_at.desc,id.desc&limit=50`,
      ),
  })
  const names = useUserNames([
    ...(record.data ? [record.data.createdByUserId] : []),
    ...(revisions.data ?? []).map((r) => r.created_by_user_id),
  ])
  const p = record.data
  const documentParts = richTextParts(blocks.data ?? [])

  if (!p) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          crumbs={
            <Link to="/protocols" className="text-link">
              Protocols
            </Link>
          }
          title={record.isLoading ? 'Loading protocol…' : 'Protocol not found'}
        />
      </div>
    )
  }
  const status = protocolStatus(p.status)
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        crumbs={
          <>
            <Link to="/protocols" className="text-link">
              Protocols
            </Link>{' '}
            / <span className="mono">{p.identifier}</span>
          </>
        }
        title={p.title}
        meta={
          <>
            <span className="text-fg">
              <Status tone={status.tone}>{status.label}</Status>
            </span>
            <span>Owner {names.userLabel(p.createdByUserId)}</span>
            <span className="max-lg:hidden">
              Updated {p.updatedAt.slice(0, 10)}
            </span>
          </>
        }
        tabs={
          <nav aria-label="Protocol sections" className="flex gap-5">
            {(
              [
                ['document', 'Document', undefined],
                ['template', 'Template', blocks.data?.length],
                ['usedby', 'Used by', links.data?.length],
                ['versions', 'Versions', revisions.data?.length],
                ['training', 'Training', undefined],
              ] as [ProtocolTab, string, number | undefined][]
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                aria-current={tab === key ? 'page' : undefined}
                onClick={() => setTab(key)}
                className={
                  tab === key
                    ? 'inline-flex h-9 cursor-pointer items-center gap-1.5 border-0 border-b-2 border-link bg-transparent px-0.5 text-body font-medium text-fg'
                    : 'inline-flex h-9 cursor-pointer items-center gap-1.5 border-0 border-b-2 border-transparent bg-transparent px-0.5 text-body font-medium text-fg-muted hover:text-fg'
                }
              >
                {label}
                {count != null ? (
                  <span className="text-label font-normal text-fg-muted">
                    {count}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'document' ? (
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-4 py-4 md:px-6">
            <Section title="Document" count={documentParts.length}>
              {documentParts.length ? (
                <article className="flex flex-col gap-2">
                  {documentParts.map((p, i) =>
                    p.kind === 'heading' ? (
                      <h3 key={i} className="m-0 text-section">
                        {p.text}
                      </h3>
                    ) : (
                      <p key={i} className="m-0 text-body">
                        {p.text}
                      </p>
                    ),
                  )}
                </article>
              ) : (
                <Muted>
                  This protocol has no document text yet. Write it in the record
                  notebook.
                </Muted>
              )}
            </Section>
          </div>
        ) : tab === 'training' ? (
          <div className="px-4 py-4 md:px-6">
            <TrainingTab protocolId={protocolId} />
          </div>
        ) : tab === 'template' ? (
          <div className="px-4 py-4 md:px-6">
            <Section title="Template" count={blocks.data?.length ?? 0}>
              {blocks.data?.length ? (
                <TableBox className="max-w-[900px]">
                  <Table aria-label="Protocol template blocks">
                    <TableHeader>
                      <TableRow>
                        <TableHead align="right">Order</TableHead>
                        <TableHead>Block</TableHead>
                        <TableHead>Version</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {blocks.data.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell align="right" className="num">
                            {b.order}
                          </TableCell>
                          <TableCell>{b.type}</TableCell>
                          <TableCell className="text-fg-muted">
                            v{b.version}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableBox>
              ) : (
                <Muted>This protocol has no notebook structure yet.</Muted>
              )}
            </Section>
          </div>
        ) : tab === 'usedby' ? (
          <div className="px-4 py-4 md:px-6">
            <Section title="Used by" count={links.data?.length ?? 0}>
              {links.data?.length ? (
                <TableBox className="max-w-[900px]">
                  <Table aria-label="Records linked to this protocol">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Record</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead>Link</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {links.data.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="mono">
                            {l.targetIdentifier}
                          </TableCell>
                          <TableCell>{l.targetKind}</TableCell>
                          <TableCell className="text-fg-muted">
                            {l.linkType}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableBox>
              ) : (
                <Muted>
                  No records link to this protocol yet. Links appear here when
                  an experiment starts from it.
                </Muted>
              )}
            </Section>
          </div>
        ) : (
          <div className="px-4 py-4 md:px-6">
            <Section
              title="Version history"
              count={revisions.data?.length ?? 0}
            >
              {revisions.data?.length ? (
                <TableBox className="max-w-[900px]">
                  <Table aria-label="Protocol version history">
                    <TableHeader>
                      <TableRow>
                        <TableHead align="right">Version</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Author</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {revisions.data.map((r, i) => (
                        <TableRow key={r.id}>
                          <TableCell align="right" className="num">
                            v{revisions.data.length - i}
                          </TableCell>
                          <TableCell>{r.reason}</TableCell>
                          <TableCell>
                            {names.userLabel(r.created_by_user_id)}
                          </TableCell>
                          <TableCell className="text-fg-muted">
                            {r.created_at.slice(0, 16).replace('T', ' ')}
                          </TableCell>
                          <TableCell align="right">
                            <Link
                              to="/evidence/$revisionId"
                              params={{ revisionId: r.id }}
                              className="text-link"
                            >
                              Evidence
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableBox>
              ) : (
                <EmptyState
                  icon="protocol"
                  title="No frozen versions yet"
                  body="A version is frozen when the protocol is submitted for review. New experiments pin the version they start from."
                />
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}

interface TrainingWire {
  id: string
  user_id: string
  status: string
  trained_at: string | null
  due_at: string | null
}

const TRAINING_STATUS: Record<
  string,
  { tone: 'ok' | 'warn' | 'none'; label: string }
> = {
  trained: { tone: 'ok', label: 'Trained' },
  required: { tone: 'warn', label: 'Required' },
  expired: { tone: 'none', label: 'Expired' },
}

function TrainingTab({ protocolId }: { protocolId: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const training = useQuery({
    queryKey: ['ui-port', 'protocol-training', protocolId],
    queryFn: () =>
      notebookDataClient.list<TrainingWire>(
        'protocol_training',
        `?protocol_record_id=eq.${encodeURIComponent(protocolId)}&select=id,user_id,status,trained_at,due_at&order=status.asc`,
      ),
  })
  const members = useQuery({
    queryKey: ['ui-port', 'protocol-training-members'],
    queryFn: () =>
      notebookDataClient.rpc<{ user_id: string; name: string }[]>(
        'workspace_members_list',
        {},
      ),
    staleTime: 60_000,
  })
  const rows = training.data ?? []
  const { userLabel } = useUserNames(
    rows.map((r) => r.user_id),
    { id: '', name: '' },
  )

  return (
    <Section
      title="Training"
      count={rows.length}
      action={
        <Button variant="primary" onClick={() => setOpen(true)}>
          Record training
        </Button>
      }
    >
      {rows.length ? (
        <TableBox className="max-w-[760px]">
          <Table aria-label="Protocol training">
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const status = TRAINING_STATUS[r.status] ?? {
                  tone: 'none' as const,
                  label: r.status,
                }
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {userLabel(r.user_id)}
                    </TableCell>
                    <TableCell>
                      <Status tone={status.tone}>{status.label}</Status>
                    </TableCell>
                    <TableCell className="num text-fg-muted">
                      {r.trained_at ? r.trained_at.slice(0, 10) : '—'}
                    </TableCell>
                    <TableCell className="num text-fg-muted">
                      {r.due_at ? r.due_at.slice(0, 10) : '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableBox>
      ) : (
        <EmptyState
          className="py-2"
          title="No one recorded yet"
          body="Record who is trained on this protocol; experiments should only start from a version their owner is trained on."
        />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(440px,calc(100vw-32px))]">
          <DialogHeader title="Record training" />
          <TrainingForm
            protocolId={protocolId}
            members={members.data ?? []}
            onDone={() => {
              setOpen(false)
              void queryClient.invalidateQueries({
                queryKey: ['ui-port', 'protocol-training', protocolId],
              })
            }}
          />
        </DialogContent>
      </Dialog>
    </Section>
  )
}

function TrainingForm({
  protocolId,
  members,
  onDone,
}: {
  protocolId: string
  members: { user_id: string; name: string }[]
  onDone: () => void
}) {
  const [userId, setUserId] = useState(members.at(0)?.user_id ?? '')
  const [status, setStatus] = useState('trained')
  const [dueAt, setDueAt] = useState('')
  const [notes, setNotes] = useState('')

  const save = useMutation({
    mutationFn: () =>
      notebookDataClient.rpc('record_protocol_training', {
        p_protocol_record_id: protocolId,
        p_user_id: userId,
        p_status: status,
        p_due_at: dueAt || null,
        p_notes: notes.trim() || null,
      }),
    onSuccess: () => {
      toast('Training recorded')
      onDone()
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : 'Couldn’t record it.',
      ),
  })

  return (
    <>
      <DialogBody>
        <Field label="Person" required>
          <NativeSelect
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            {members.length === 0 ? <option value="">No members</option> : null}
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Status">
          <NativeSelect
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="trained">Trained</option>
            <option value="required">Required</option>
            <option value="expired">Expired</option>
          </NativeSelect>
        </Field>
        {status !== 'trained' ? (
          <Field label="Due" hint="Optional.">
            <Input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </Field>
        ) : null}
        <Field label="Note" hint="Optional.">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <span className="flex-1" />
        <Button onClick={onDone}>Cancel</Button>
        <Button
          variant="primary"
          disabled={save.isPending || !userId}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  )
}
