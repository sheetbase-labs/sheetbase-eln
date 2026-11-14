/** The only project a lab has, when it has exactly one: forms preselect it. */
export function soleProjectId(
  projectIds: readonly string[],
): string | undefined {
  return projectIds.length === 1 ? projectIds[0] : undefined
}
