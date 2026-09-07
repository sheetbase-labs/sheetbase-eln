/** INT-01 — register a connector (steward-gated). */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
} from '#/components/ui'
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

const dataClient = createDataClient()

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
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
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
    onSuccess: () => {
      setError(null)
      onOpenChange(false)
      setName('')
      setKey('')
      void queryClient.invalidateQueries({ queryKey: ['connectors'] })
    },
    onError: (cause) => setError(describeConnectorsError(cause)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register connector</DialogTitle>
          <DialogDescription>
            Connectors share one execution, security and provenance model.
            Credentials are added as sealed secrets after registration.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="connector-name">Name</Label>
            <Input
              id="connector-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Plate reader bench 2"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="connector-key">Key</Label>
            <Input
              id="connector-key"
              value={key}
              onChange={(event) =>
                setKey(event.target.value.toLowerCase().replaceAll(' ', '-'))
              }
              placeholder="plate-reader-bench-2"
            />
            <p className="text-muted-foreground text-xs">
              Lowercase letters, digits and dashes. Immutable once registered.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Type</Label>
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
            </div>
            <div className="grid gap-2">
              <Label>Direction</Label>
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
            </div>
          </div>
          {connectorType === 'instrument' && (
            <div className="grid gap-2">
              <Label>Ingestion parser</Label>
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
            </div>
          )}
          {(connectorType === 'storage' || connectorType === 'database') && (
            <div className="grid gap-2">
              <Label>Source adapter</Label>
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
              <p className="text-muted-foreground text-xs">
                Enterprise source adapters run server-side; non-secret settings
                (bucket/prefix or host/port/database) are configured on the
                connector after registration.
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
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
