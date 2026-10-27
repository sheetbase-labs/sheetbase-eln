import { Link, useRouterState } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/v3/ui/popover'
import { contextHelpFor } from '#/components/v3/help/context-help-topics'

/**
 * A help button in the top bar that explains the page you are on. It renders
 * nothing on a page with no help written for it, and always links to the Help
 * centre.
 */
export function ContextHelp() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const topic = contextHelpFor(pathname)
  if (!topic) return null
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="quiet"
            size="icon"
            icon="info"
            aria-label="Help for this page"
            // The phone top bar has room for one row; Help is in the account menu.
            className="max-md:hidden"
          />
        }
      />
      <PopoverContent className="w-[min(340px,calc(100vw-32px))] p-3">
        <PopoverTitle className="m-0 text-section">{topic.title}</PopoverTitle>
        <p className="mb-2 mt-1 text-label text-fg-muted">{topic.text}</p>
        <div className="flex flex-col gap-1 text-label">
          {topic.more ? (
            <Link {...topic.more.link}>{topic.more.label}</Link>
          ) : null}
          <Link to="/help">Help and shortcuts</Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
