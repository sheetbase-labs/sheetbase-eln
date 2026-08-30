import { useState } from 'react'

import type {
  AgentOperationPolicy,
  AgentOperationPolicyTargetType,
} from '#/lib/agent-operations'
import {
  Button,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'

const TARGET_TYPES: Array<{
  value: AgentOperationPolicyTargetType
  label: string
}> = [
  { value: 'workspace', label: 'Workspace' },
  { value: 'project', label: 'Project' },
  { value: 'dataset', label: 'Dataset' },
]

function targetTypeFromValue(
  value: string,
): AgentOperationPolicyTargetType | null {
  return TARGET_TYPES.find((target) => target.value === value)?.value ?? null
}

export function AgentOperationPolicyPanel({
  policies,
  canManage,
  onCreate,
  onDisable,
}: {
  policies: AgentOperationPolicy[]
  canManage: boolean
  onCreate: (input: {
    name: string
    targetType: AgentOperationPolicyTargetType
    targetId: string | null
    maxAffectedRows: number
  }) => void
  onDisable: (policy: AgentOperationPolicy) => void
}) {
  const [name, setName] = useState('')
  const [targetType, setTargetType] =
    useState<AgentOperationPolicyTargetType>('dataset')
  const [targetId, setTargetId] = useState('')
  const [maxAffectedRows, setMaxAffectedRows] = useState('100')

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const limit = Number(maxAffectedRows)
    if (!name.trim() || !Number.isInteger(limit) || limit < 1 || limit > 1000)
      return
    onCreate({
      name: name.trim(),
      targetType,
      targetId: targetType === 'workspace' ? null : targetId.trim(),
      maxAffectedRows: limit,
    })
    setName('')
    setTargetId('')
  }

  return (
    <section className="border-border border-b px-4 py-4 lg:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Execution policies</h2>
          <p className="text-muted-foreground mt-1 max-w-3xl text-xs">
            Dataset row commits require a human by default. An owner or Data
            Steward can delegate a canonical target with a row limit. Draft
            definition changes remain automatic when the credential has its
            existing canonical scope.
          </p>
        </div>
        {!canManage && (
          <p className="text-muted-foreground text-xs">
            Only a workspace owner or Data Steward can change policies.
          </p>
        )}
      </div>

      {canManage && (
        <form
          onSubmit={submit}
          className="mt-3 grid gap-2 md:grid-cols-[minmax(160px,1fr)_170px_minmax(180px,1fr)_110px_auto]"
        >
          <div>
            <Label htmlFor="agent-policy-name">Policy name</Label>
            <Input
              id="agent-policy-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Assay import rows"
              required
            />
          </div>
          <div>
            <Label htmlFor="agent-policy-target-type">Target boundary</Label>
            <Select
              id="agent-policy-target-type"
              value={targetType}
              onChange={(event) => {
                const nextTargetType = targetTypeFromValue(event.target.value)
                if (nextTargetType) setTargetType(nextTargetType)
              }}
            >
              {TARGET_TYPES.map((target) => (
                <option key={target.value} value={target.value}>
                  {target.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="agent-policy-target-id">
              {targetType === 'workspace' ? 'Target id' : `${targetType} id`}
            </Label>
            <Input
              id="agent-policy-target-id"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              placeholder={
                targetType === 'workspace'
                  ? 'Uses current workspace'
                  : 'Canonical UUID'
              }
              disabled={targetType === 'workspace'}
              required={targetType !== 'workspace'}
            />
          </div>
          <div>
            <Label htmlFor="agent-policy-limit">Max rows</Label>
            <Input
              id="agent-policy-limit"
              type="number"
              min={1}
              max={1000}
              value={maxAffectedRows}
              onChange={(event) => setMaxAffectedRows(event.target.value)}
              required
            />
          </div>
          <Button type="submit" className="self-end">
            Add policy
          </Button>
        </form>
      )}

      <div className="border-border mt-4 overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Operation</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Limit</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead>Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {policies.map((policy) => (
              <TableRow key={policy.id}>
                <TableCell>{policy.name}</TableCell>
                <TableCell className="font-mono text-xs">
                  {policy.operation_kind}
                </TableCell>
                <TableCell className="max-w-64">
                  <span>{policy.target_type}</span>
                  {policy.target_id && (
                    <span className="text-muted-foreground ml-1 font-mono text-xs">
                      {policy.target_id}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {typeof policy.limits.maxAffectedRows === 'number'
                    ? policy.limits.maxAffectedRows
                    : '—'}
                </TableCell>
                <TableCell>{policy.enabled ? 'Active' : 'Disabled'}</TableCell>
                {canManage && (
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!policy.enabled}
                      onClick={() => onDisable(policy)}
                    >
                      Disable
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {policies.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={canManage ? 6 : 5}
                  className="text-muted-foreground py-6 text-center text-sm"
                >
                  No delegation policies. Consequential writes remain human
                  required.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
