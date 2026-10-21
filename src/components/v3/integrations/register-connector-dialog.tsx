/** INT-01 — register a connector (steward-gated). UI port: app-3's v3 kit. */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Select } from '#/components/v3/ui/select'
import { createDataClient } from '#/lib/data-client'
import {
  describeConnectorsError,
  registerConnector,
} from '#/lib/connectors/client'
import { getParser, listParsers } from '#/lib/connectors/registry'
import { CONNECTOR_DIRECTIONS, CONNECTOR_TYPES } from '#/lib/connectors/types'
import type { ConnectorDirection, ConnectorType } from '#/lib/connectors/types'
// Ensure instrument parsers are registered before the catalogue renders.
import '#/lib/connectors/plate-reader'
import '#/lib/connectors/instrument-parsers'

const dataClient = createDataClient()

/** A connector key from a name: lowercase letters, digits and single dashes. */
function slugKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 49)
}

export function RegisterConnectorDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  // The key follows the name until a person types their own.
  const [keyEdited, setKeyEdited] = useState(false)
  const [connectorType, setConnectorType] =
    useState<ConnectorType>('instrument')
  const [direction, setDirection] = useState<ConnectorDirection>('inbound')
  const [parserId, setParserId] = useState<string>(
    listParsers()[0]?.parserId ?? '',
  )
  const [adapter, setAdapter] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      registerConnector(dataClient, {
        workspaceId,
        key,
        name,
        connectorType,
        direction,
        parserId: connectorType === 'instrument' ? parserId : null,
        config:
          (connectorType === 'storage' || connectorType === 'database') &&
          adapter
            ? { adapter }
            : undefined,
      }),
    onSuccess: (created) => {
      setError(null)
      onOpenChange(false)
      setName('')
      setKey('')
      setKeyEdited(false)
      void queryClient.invalidateQueries({ queryKey: ['connectors'] })
      // Land on the new connector, where credentials and activation are set.
      void navigate({
        to: '/settings/integrations/$connectorId',
        params: { connectorId: created.id },
      })
    },
    onError: (cause) => setError(describeConnectorsError(cause)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title="Register connector"
          description="Connectors share one execution, security and provenance model. Credentials are added as sealed secrets after registration."
        />
        <DialogBody>
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (!keyEdited) setKey(slugKey(event.target.value))
              }}
              placeholder="Plate reader bench 2"
            />
          </Field>
          <Field
            label="Key"
            required
            hint="Lowercase letters, digits and dashes. Immutable once registered."
          >
            <Input
              value={key}
              onChange={(event) => {
                setKeyEdited(true)
                setKey(event.target.value.toLowerCase().replaceAll(' ', '-'))
              }}
              placeholder="plate-reader-bench-2"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Select
                value={connectorType}
                onChange={(event) =>
                  setConnectorType(event.target.value as ConnectorType)
                }
              >
                {CONNECTOR_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Direction">
              <Select
                value={direction}
                onChange={(event) =>
                  setDirection(event.target.value as ConnectorDirection)
                }
              >
                {CONNECTOR_DIRECTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {connectorType === 'instrument' && (
            <Field label="Ingestion parser">
              <Select
                value={parserId}
                onChange={(event) => setParserId(event.target.value)}
              >
                {listParsers().map((parser) => (
                  <option key={parser.parserId} value={parser.parserId}>
                    {parser.label} ({getParser(parser.parserId)?.version})
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {(connectorType === 'storage' || connectorType === 'database') && (
            <Field
              label="Source adapter"
              hint="Enterprise source adapters run server-side; non-secret settings (bucket/prefix or host/port/database) are configured on the connector after registration."
            >
              <Select
                value={adapter}
                onChange={(event) => setAdapter(event.target.value)}
              >
                {connectorType === 'storage' && (
                  <option value="s3">S3-compatible object storage</option>
                )}
                {connectorType === 'database' && (
                  <option value="postgres">
                    External PostgreSQL (read-only)
                  </option>
                )}
                <option value="">None (custom)</option>
              </Select>
            </Field>
          )}
          {error && <Notice tone="bad">{error}</Notice>}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={
              mutation.isPending ||
              !name.trim() ||
              !/^[a-z][a-z0-9-]{0,48}$/.test(key)
            }
            onClick={() => mutation.mutate()}
          >
            Register connector
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
