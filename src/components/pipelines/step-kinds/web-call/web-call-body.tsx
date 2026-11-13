import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { t } from '#/copy'
import { JsonEditor } from '#/components/code-editor/json-editor'
import {
  BoardInput,
  BoardSegmented,
  BoardSelect,
} from '#/features/pipelines/board/board'
import { notebookDataClient } from '#/lib/notebook-data'
import { WEB_CALL_METHODS } from '#/lib/pipelines/web-call'
import type { PipelineWebCall } from '#/lib/pipelines/web-call'

/** A place a web call may go, as the editor lists it. */
export interface WebConnection {
  id: string
  key: string
  name: string
  base_url: string
  status: string
  secret_names: string[]
}

export function useWebConnections() {
  return useQuery({
    queryKey: ['ui-port', 'pipelines', 'web-connections'],
    queryFn: () =>
      notebookDataClient.list<WebConnection>(
        'pipeline_connections',
        '?select=id,key,name,base_url,status,secret_names&order=name.asc',
      ),
    staleTime: 30_000,
  })
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="frow">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  )
}

/** The JSON object a POST sends, written as text until it parses. */
function BodyField({
  body,
  onChange,
}: {
  body: PipelineWebCall['body']
  onChange: (body: PipelineWebCall['body']) => void
}) {
  const [text, setText] = useState(body ? JSON.stringify(body, null, 2) : '')

  return (
    <JsonEditor
      ariaLabel={t('features.pipelineConnections.editor.body')}
      value={text}
      accepts="object"
      rows={5}
      onChange={(next) => {
        setText(next)

        if (next.trim() === '') {
          onChange(undefined)

          return
        }

        try {
          const parsed = z
            .record(z.string(), z.json())
            .safeParse(JSON.parse(next))

          // Until it parses the saved body stays as it was.
          if (parsed.success) onChange(parsed.data)
        } catch {
          // Not valid yet; the editor marks where.
        }
      }}
    />
  )
}

/**
 * The open form of a web call step: which connection, what to ask, which
 * stored secret signs it, and where the rows are in the answer. Laid out like
 * the board's other open steps (`.pb-calc`, `.frow`).
 */
export function WebCallStepBody({
  call,
  onChange,
}: {
  call: PipelineWebCall
  onChange: (call: PipelineWebCall) => void
}) {
  const connections = useWebConnections()
  const id = useId()
  const list = connections.data ?? []
  const chosen = list.find((connection) => connection.key === call.connection)
  const secrets = chosen?.secret_names ?? []

  const patch = (next: Partial<PipelineWebCall>) =>
    onChange({ ...call, ...next })

  return (
    <>
      <Row
        label={t('features.pipelineConnections.editor.connection')}
        htmlFor={`${id}-c`}
      >
        <BoardSelect
          id={`${id}-c`}
          value={call.connection}
          onChange={(event) =>
            // A secret belongs to one connection, so it is cleared on a move.
            onChange({
              ...call,
              connection: event.target.value,
              secret: undefined,
            })
          }
        >
          <option value="">
            {t('features.pipelineConnections.editor.chooseConnection')}
          </option>
          {call.connection && !chosen ? (
            <option value={call.connection}>{call.connection}</option>
          ) : null}
          {list.map((connection) => (
            <option key={connection.id} value={connection.key}>
              {connection.status === 'off'
                ? t('features.pipelineConnections.editor.offSuffix', {
                    name: connection.name,
                  })
                : connection.name}
            </option>
          ))}
        </BoardSelect>
      </Row>
      {chosen ? (
        <div className="muted" style={{ fontSize: 12, paddingLeft: 98 }}>
          <span className="mono">{chosen.base_url}</span>
        </div>
      ) : null}
      {!connections.isPending && list.length === 0 ? (
        <div className="muted" style={{ fontSize: 12, paddingLeft: 98 }}>
          {t('features.pipelineConnections.editor.noConnections')}{' '}
          <a href="/settings/workspace/integrations">
            {t('features.pipelineConnections.editor.manage')}
          </a>
        </div>
      ) : null}
      <Row label={t('features.pipelineConnections.editor.ask')}>
        <div style={{ display: 'flex', gap: 8 }}>
          <BoardSegmented
            label={t('features.pipelineConnections.editor.method')}
            options={WEB_CALL_METHODS.map((method) => ({
              value: method,
              label: method,
            }))}
            value={call.method}
            onChange={(method) => {
              if (method === 'GET') {
                // A GET sends no body.
                const { body: _dropped, ...rest } = call
                onChange({ ...rest, method })
              } else if (method === 'POST') patch({ method })
            }}
          />
          <BoardInput
            mono
            aria-label={t('features.pipelineConnections.editor.path')}
            style={{ flexGrow: 1 }}
            value={call.path}
            placeholder="/batches?project={parameters.project}"
            onChange={(event) => patch({ path: event.target.value })}
          />
        </div>
      </Row>
      {call.method === 'POST' ? (
        <Row
          label={t('features.pipelineConnections.editor.body')}
          htmlFor={`${id}-b`}
        >
          <BodyField
            body={call.body}
            onChange={(body) => {
              const { body: _old, ...rest } = call
              onChange(body ? { ...rest, body } : rest)
            }}
          />
        </Row>
      ) : null}
      <Row
        label={t('features.pipelineConnections.editor.secret')}
        htmlFor={`${id}-s`}
      >
        <BoardSelect
          id={`${id}-s`}
          value={call.secret ?? ''}
          disabled={!chosen}
          onChange={(event) =>
            patch({ secret: event.target.value || undefined })
          }
        >
          <option value="">
            {t('features.pipelineConnections.editor.noSecret')}
          </option>
          {call.secret && !secrets.includes(call.secret) ? (
            <option value={call.secret}>{call.secret}</option>
          ) : null}
          {secrets.map((secret) => (
            <option key={secret} value={secret}>
              {secret}
            </option>
          ))}
        </BoardSelect>
      </Row>
      <Row
        label={t('features.pipelineConnections.editor.rowsAt')}
        htmlFor={`${id}-i`}
      >
        <BoardInput
          id={`${id}-i`}
          mono
          value={call.itemsPath ?? ''}
          placeholder="data.items"
          onChange={(event) =>
            patch({ itemsPath: event.target.value || undefined })
          }
        />
      </Row>
      <div className="muted" style={{ fontSize: 12, lineHeight: '18px' }}>
        {t('features.pipelineConnections.editor.limits')}
      </div>
    </>
  )
}
