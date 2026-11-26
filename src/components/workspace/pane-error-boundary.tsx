import { Component, useEffect } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { t } from '#/copy'

interface PaneErrorBoundaryProps {
  children: ReactNode
  /** Called when the person asks to try the page again. */
  onRetry?: () => void
}

interface PaneErrorBoundaryState {
  failed: boolean
}

/** What a pane shows in place of a page that could not render. */
export function PaneFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" data-pane-failed className="min-w-0 flex-1">
      <EmptyState
        icon="warn"
        title={t('projects.panePage.failedTitle')}
        description={t('projects.panePage.failedBody')}
        action={
          <Button type="button" variant="secondary" onClick={onRetry}>
            {t('projects.panePage.tryAgain')}
          </Button>
        }
      />
    </div>
  )
}

/** A route inside a pane that threw while rendering: shown in that pane only. */
export function PaneRouteError({
  error,
  reset,
}: {
  error: unknown
  reset: () => void
}) {
  useEffect(() => {
    console.error('A page in a workspace pane stopped rendering.', error)
  }, [error])

  return <PaneFailure onRetry={reset} />
}

/**
 * Keeps a page that throws while it renders inside its own pane. Without it a
 * render error climbs to the nearest boundary, which can be the whole
 * workspace; with it the other panes, the tab strip and the shelf carry on and
 * the person can try the page again or close the pane.
 */
export class PaneErrorBoundary extends Component<
  PaneErrorBoundaryProps,
  PaneErrorBoundaryState
> {
  state: PaneErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): PaneErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('A workspace pane stopped rendering.', error, info)
  }

  private retry = () => {
    this.props.onRetry?.()
    this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children

    return <PaneFailure onRetry={this.retry} />
  }
}
