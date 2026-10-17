import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/v3/ui/confirm-dialog'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Input } from '#/components/v3/ui/input'
import { Muted, Section } from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { isUuid } from '#/lib/field-value-validation'
import { fetchModelKinds } from '#/lib/model-fields'
import {
  configureModelRelationshipRule,
  modelRelationshipQueryKeys,
  modelRelationshipsDataClient,
  MODEL_LINK_TYPES,
  removeModelRelationshipRule,
  useModelRelationshipRules,
} from '#/lib/model-relationships'
import { useWorkspaceRecordModel } from '#/components/v3/models/models-data'

/**
 * UI port (roadmap-4/ui-app3 / MDL-02.1): the Relations tab authors
 * `api.model_relationship_rules` — the typed links a record model accepts,
 * with cardinality. A rule's source is the record model (built-in kind or
 * workspace model, ADR-0051); the target stays a built-in record-backed model.
 * The server enforces the declared pairs when links are created.
 */
export const Route = createFileRoute('/models/$modelId/relations')({
  component: ModelRelations,
})

function ModelRelations() {
  const { modelId } = Route.useParams()
  // Relations apply to record models, not dataset schemas: a dataset schema's
  // records live in dataset versions, not `record_links`. Tell the truth rather
  // than offer a form that cannot save.
  if (isUuid(modelId)) {
    return (
      <div className="px-4 py-6 md:px-6">
        <EmptyState
          icon="schema"
          title="Relations apply to record models"
          body="This is a dataset schema. Typed relationships attach to a record model's links, so author them from the model that defines those records."
        />
      </div>
    )
  }
  return <RecordModelRelations modelKey={modelId} />
}

function RecordModelRelations({ modelKey }: { modelKey: string }) {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const queryClient = useQueryClient()

  const model = useWorkspaceRecordModel(modelKey)
  const { rules } = useModelRelationshipRules(modelKey)
  const kindsQuery = useQuery({
    queryKey: ['ui-port', 'model-relations', 'record-kinds'] as const,
    queryFn: () => fetchModelKinds(modelRelationshipsDataClient),
    staleTime: 60_000,
  })
  // Only built-in record-backed models are legal rule targets (the RPC and the
  // `target_model_key` foreign key both require it).
  const targetKinds = (kindsQuery.data ?? []).filter(
    (kind) => kind.identityTable === 'api.records',
  )

  // A rule narrows what the server accepts for every future link, so the form
  // starts empty: a stray click on a pre-filled form would otherwise declare a
  // rule the author never chose.
  const [linkType, setLinkType] = useState('')
  const [targetModelKey, setTargetModelKey] = useState('')
  const [minLinks, setMinLinks] = useState('0')
  const [maxLinks, setMaxLinks] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Removing a rule loosens what the server accepts for every future link, and
  // there is no undo, so the row action asks first.
  const [removeTarget, setRemoveTarget] = useState<{
    id: string
    description: string
  } | null>(null)

  const target = targetModelKey
  const minValue = Number(minLinks)
  const minValid = Number.isInteger(minValue) && minValue >= 0
  const maxValue = maxLinks.trim() === '' ? null : Number(maxLinks)
  const maxValid =
    maxValue === null || (Number.isInteger(maxValue) && maxValue >= minValue)
  const canSubmit =
    Boolean(workspaceId) &&
    linkType.length > 0 &&
    target.length > 0 &&
    minValid &&
    maxValid &&
    !busy

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: modelRelationshipQueryKeys.rulesFor(modelKey),
    })
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await configureModelRelationshipRule(modelRelationshipsDataClient, {
        workspaceId,
        sourceModelKey: modelKey,
        linkType,
        targetModelKey: target,
        minLinks: minValue,
        maxLinks: maxValue,
        label: label.trim() === '' ? null : label.trim(),
      })
      setLabel('')
      setMaxLinks('')
      await refresh()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save rule.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function remove(ruleId: string) {
    setBusy(true)
    setError(null)
    setRemoveTarget(null)
    try {
      await removeModelRelationshipRule(modelRelationshipsDataClient, ruleId)
      await refresh()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not remove rule.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-auto px-4 py-4 md:px-6">
      <Section title="Relations" count={rules.length}>
        <Muted>
          Relations declare which typed links {model.data?.name ?? modelKey}
          &rsquo;s records accept, and how many. Once a model declares any rule,
          the server allows only the declared (link type, target model) pairs
          and rejects everything else when a link is created.
        </Muted>
        {rules.length ? (
          <TableBox>
            <Table aria-label="Model relations">
              <TableHeader>
                <TableRow>
                  <TableHead>Link type</TableHead>
                  <TableHead>Target model</TableHead>
                  <TableHead>Min</TableHead>
                  <TableHead>Max</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">
                      {rule.linkType}
                    </TableCell>
                    <TableCell className="mono">
                      {rule.targetModelKey}
                    </TableCell>
                    <TableCell className="num">{rule.minLinks}</TableCell>
                    <TableCell className="num">
                      {rule.maxLinks ?? '∞'}
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {rule.label ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="quiet"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          setRemoveTarget({
                            id: rule.id,
                            description: `${rule.linkType} → ${rule.targetModelKey}`,
                          })
                        }
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <EmptyState
            icon="schema"
            title="No relations yet"
            body="Add a relation to constrain the typed links this model's records accept."
          />
        )}
      </Section>

      <Section title="Add a relation">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-xs text-fg-muted">
              Link type
              <Select
                className="mt-1"
                value={linkType}
                onChange={(event) => setLinkType(event.target.value)}
                aria-label="Link type"
              >
                <option value="" disabled>
                  Select a link type
                </option>
                {MODEL_LINK_TYPES.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-fg-muted">
              Target model
              <Select
                className="mt-1"
                value={target}
                onChange={(event) => setTargetModelKey(event.target.value)}
                aria-label="Target model"
              >
                <option value="" disabled>
                  Select a target model
                </option>
                {targetKinds.map((kind) => (
                  <option key={kind.key} value={kind.key}>
                    {kind.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-fg-muted">
              Minimum links
              <Input
                className="mt-1 h-8 text-xs"
                type="number"
                min={0}
                value={minLinks}
                onChange={(event) => setMinLinks(event.target.value)}
                aria-label="Minimum links"
              />
            </label>
            <label className="text-xs text-fg-muted">
              Maximum links
              <Input
                className="mt-1 h-8 text-xs"
                type="number"
                min={0}
                value={maxLinks}
                onChange={(event) => setMaxLinks(event.target.value)}
                aria-label="Maximum links"
                placeholder="unbounded"
              />
            </label>
          </div>

          <label className="text-xs text-fg-muted">
            Label
            <Input
              className="mt-1 h-8 text-xs"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              aria-label="Relation label"
              placeholder="optional display name"
            />
          </label>

          {error ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {error}
            </p>
          ) : null}

          <div>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {busy ? 'Saving…' : 'Add relation'}
            </Button>
          </div>
        </form>
      </Section>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>Remove this relation?</ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {removeTarget
                ? `“${removeTarget.description}” is deleted from this model's declared relations. This cannot be undone; add the rule again to restore it.`
                : ''}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={busy}>Cancel</ConfirmDialogCancel>
            <ConfirmDialogAction
              variant="danger-fill"
              disabled={busy}
              onClick={() => {
                if (!removeTarget) return
                void remove(removeTarget.id)
              }}
            >
              {busy ? 'Removing…' : 'Remove relation'}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}
