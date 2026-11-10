/** A request that works with any token: list the projects it can see. */
export function apiExampleCommand(origin: string): string {
  return [
    `curl "${origin}/api/db/projects?select=id,key,title&limit=5" \\`,
    '  -H "Authorization: Bearer $SHEETBASE_TOKEN"',
  ].join('\n')
}
