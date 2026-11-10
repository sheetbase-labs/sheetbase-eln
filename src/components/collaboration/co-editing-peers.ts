/** Minimal structural shape of a peer the co-editing badge reads. */
export interface CoEditingPeer {
  connectionId?: number
  info?: { name?: string }
  presence?: {
    activeBlockId?: string | null
    mode?: 'viewing' | 'editing'
  }
}

/** Names of peers actively editing the given block, never a lock decision. */
export function coEditingPeerNames(
  peers: readonly CoEditingPeer[],
  blockId: string,
): string[] {
  const names: string[] = []

  for (const peer of peers) {
    if (peer.presence?.mode !== 'editing') continue

    if (peer.presence.activeBlockId !== blockId) continue
    names.push(peer.info?.name?.trim() || 'Someone')
  }

  return names
}
