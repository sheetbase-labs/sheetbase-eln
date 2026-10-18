/**
 * Which membership is the person's active workspace.
 *
 * One rule for the shell context, the data proxy and the file routes, so the UI
 * and the data layer never scope to different workspaces. The chosen workspace
 * wins while the membership is live; otherwise the first live membership. A
 * suspended membership is only returned when the person has nothing else, so
 * the shell can say "suspended" instead of loading data the database refuses.
 */
export function pickActiveMembership<
  T extends { workspaceId: string; suspendedAt: Date | null },
>(memberships: readonly T[], preferredWorkspaceId?: string | null): T | null {
  const live = memberships.filter((item) => !item.suspendedAt)
  return (
    live.find((item) => item.workspaceId === preferredWorkspaceId) ??
    live.at(0) ??
    memberships.at(0) ??
    null
  )
}
