import { useEffect, useState } from 'react'

import { CopyButton } from '#/components/v3/ui/copy-button'

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
    <section aria-label="Try a token" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-section">Try a token</h2>
        <span className="flex-1" />
        <CopyButton value={command} aria-label="Copy example request">
          Copy
        </CopyButton>
      </div>
      <p className="m-0 text-label text-fg-muted">
        Put a token in <span className="mono">SHEETBASE_TOKEN</span> and run
        this. It lists up to five projects the token can read; a 401 means the
        token is wrong, revoked or expired.
      </p>
      <pre className="m-0 overflow-auto rounded-md border border-border-subtle bg-surface-muted p-3 text-label">
        <code>{command}</code>
      </pre>
    </section>
  )
}
