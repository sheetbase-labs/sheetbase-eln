import {
  LiveblocksProvider,
  collaborationClientOptions,
} from '#/lib/collaboration/liveblocks.config'

export default function LiveblocksBoundary({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <LiveblocksProvider {...collaborationClientOptions}>
      {children}
    </LiveblocksProvider>
  )
}
