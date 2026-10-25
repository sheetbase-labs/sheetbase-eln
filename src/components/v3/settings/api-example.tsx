import { useEffect, useState } from 'react'

import { CopyButton } from '#/components/v3/ui/copy-button'
import { Section } from '#/components/v3/ui/layout'

/** A request that works with any token: list the projects it can see. */
export function apiExampleCommand(origin: string): string {
  return [
    `curl "${origin}/api/db/projects?select=id,key,title&limit=5" \\`,
    '  -H "Authorization: Bearer $SHEETBASE_TOKEN"',
  ].join('\n')
}

/**
 * A request to try a new token with, ready to paste. The token itself is shown
 * once, when it is created, so the example names it by variable.
 */
export function ApiExample() {
  const [origin, setOrigin] = useState('https://your-workspace.example')
  useEffect(() => setOrigin(window.location.origin), [])
  const command = apiExampleCommand(origin)
  return (
    <Section
      title="Use a token"
      action={
        <CopyButton value={command} aria-label="Copy example request">
          Copy
        </CopyButton>
      }
    >
      <p className="m-0 max-w-3xl text-body text-fg-muted">
        The same bearer token works with the REST proxy and the MCP server. Put
        a token in <span className="mono">SHEETBASE_TOKEN</span> and run the
        request below; it lists up to five projects the token can read. A 401
        means the token is wrong, revoked or expired.
      </p>
      <dl className="m-0 grid gap-x-8 gap-y-2 text-label sm:grid-cols-2">
        <div>
          <dt className="text-fg-muted">REST proxy</dt>
          <dd className="m-0 mt-0.5">
            <code>/api/db/{'{table}'}</code>
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">MCP server</dt>
          <dd className="m-0 mt-0.5">
            <code>POST /api/mcp</code> · JSON-RPC
          </dd>
        </div>
      </dl>
      <pre className="m-0 max-w-3xl overflow-auto rounded-md border border-border-subtle bg-surface-muted p-3 text-label">
        <code>{command}</code>
      </pre>
    </Section>
  )
}
