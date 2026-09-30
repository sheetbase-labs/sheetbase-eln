import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
  Section,
} from '#/components/v3/ui/layout'
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
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { RegisterConnectorDialog } from '#/components/v3/integrations/register-connector-dialog'
import { createDataClient } from '#/lib/data-client'
import { hasCapability } from '#/lib/capability'
import {
  connectorQueryKeys,
  describeConnectorsError,
  listConnectors,
} from '#/lib/connectors/client'
import {
  formatParserIdentity,
  getParser,
  listParsers,
} from '#/lib/connectors/registry'

// Register built-in instrument parsers before the catalogue renders.
import '#/lib/connectors/plate-reader'

/** UI port (roadmap-4/ui-app3): instruments and parsers. An instrument is an
 * inbound connector; its parser comes from the registered parser catalogue.
 * Calibration is recorded on the instrument record (`/instruments/$id`), not
 * here; this page manages the inbound connectors and the parser catalogue. */
export const Route = createFileRoute('/settings/instruments')({
  component: Instruments,
})

const dataClient = createDataClient()

function Instruments() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const canManage = hasCapability(
    context.workspace?.role,
    'integrations.manage',
  )
  const [registerOpen, setRegisterOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  // The parser registry is module-level; its contents can differ between the
  // server and client bundles, so the catalogue renders after mount.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const connectorsQuery = useQuery({
    queryKey: connectorQueryKeys.connectors,
    queryFn: () => listConnectors(dataClient),
    enabled: Boolean(workspaceId),
  })
  const instruments = useMemo(
    () =>
      (connectorsQuery.data ?? []).filter(
        (c) => c.connector_type === 'instrument',
      ),
    [connectorsQuery.data],
  )
  const parsers = listParsers()
  const sel =
    instruments.find((i) => i.id === selected) ?? instruments.at(0) ?? null
  const parser = sel?.parser_id ? getParser(sel.parser_id) : undefined

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <SettingsHeader
          title="Instruments and parsers"
          count={instruments.length}
          actions={
            <>
              <Button nativeButton={false} render={<Link to="/instruments" />}>
                Open instruments
              </Button>
              {canManage ? (
                <Button
                  variant="primary"
                  icon="plus"
                  onClick={() => setRegisterOpen(true)}
                >
                  Add instrument
                </Button>
              ) : null}
            </>
          }
        >
          Instruments import through a parser; nothing is imported until the
          parser is validated and the instrument is connected.
        </SettingsHeader>
        <div className="min-h-0 flex-1">
          {connectorsQuery.error instanceof Error ? (
            <p
              role="alert"
              className="px-4 pt-4 text-label text-danger-text md:px-6"
            >
              {describeConnectorsError(connectorsQuery.error)}
            </p>
          ) : instruments.length ? (
            <Table aria-label="Instruments">
              <TableHeader>
                <TableRow>
                  <TableHead>Instrument</TableHead>
                  <TableHead>Parser</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Direction</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instruments.map((i) => {
                  const p = i.parser_id ? getParser(i.parser_id) : undefined
                  return (
                    <TableRow
                      key={i.id}
                      selected={i.id === sel?.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(i.id)}
                    >
                      <TableCell className="font-medium">{i.name}</TableCell>
                      <TableCell>
                        {p ? `${p.label} v${p.version}` : '—'}
                      </TableCell>
                      <TableCell>
                        <Status tone={i.status === 'active' ? 'ok' : 'stored'}>
                          {i.status}
                        </Status>
                      </TableCell>
                      <TableCell>{i.direction}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : connectorsQuery.isLoading ? (
            <Muted className="px-4 pt-4 md:px-6">Loading instruments…</Muted>
          ) : (
            <div className="px-4 py-4 md:px-6">
              <EmptyState
                icon="pipeline"
                title="No instruments yet"
                body="Add an instrument to create its connector; imports are held until a parser is validated."
              />
            </div>
          )}
        </div>
        <SettingsBody className="border-t border-border-subtle">
          <Section
            title="Available parsers"
            count={mounted ? parsers.length : undefined}
          >
            {!mounted ? (
              <Muted>Loading parsers…</Muted>
            ) : parsers.length ? (
              <TableBox className="max-w-[720px]">
                <Table aria-label="Available parsers">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Parser</TableHead>
                      <TableHead>Identity</TableHead>
                      <TableHead align="right">{''}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsers.map((p) => (
                      <TableRow key={p.parserId}>
                        <TableCell>{p.label}</TableCell>
                        <TableCell className="mono">
                          {formatParserIdentity(p)}
                        </TableCell>
                        <TableCell align="right">
                          {canManage ? (
                            <Button
                              size="sm"
                              variant="quiet"
                              onClick={() => setRegisterOpen(true)}
                            >
                              Use
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableBox>
            ) : (
              <Muted>No parsers are registered in this build.</Muted>
            )}
          </Section>
        </SettingsBody>
      </div>

      {sel ? (
        <Inspector aria-label={`${sel.name} details`} className="w-[320px]">
          <InspectorSection title={sel.name}>
            <span className="mono text-fg-muted">{sel.key}</span>
            <DescriptionList
              labelWidth={90}
              items={[
                ['Type', sel.connector_type],
                ['Direction', sel.direction],
                ['Status', sel.status],
                [
                  'Parser',
                  parser ? `${parser.label} v${parser.version}` : 'None yet',
                ],
              ]}
            />
            <div className="mt-2 flex gap-1.5">
              <Button
                size="sm"
                variant="primary"
                nativeButton={false}
                render={
                  <Link
                    to="/settings/integrations/$connectorId"
                    params={{ connectorId: sel.id }}
                  />
                }
              >
                Test with a file
              </Button>
            </div>
          </InspectorSection>
          <InspectorSection title="Calibration">
            <Muted>
              Calibration is recorded on the instrument itself (see
              Instruments). The connector still records every import with its
              file hash.
            </Muted>
          </InspectorSection>
        </Inspector>
      ) : null}

      <RegisterConnectorDialog
        workspaceId={workspaceId}
        open={registerOpen}
        onOpenChange={setRegisterOpen}
      />
    </div>
  )
}
