/**
 * The allow-listing egress proxy is plain JavaScript (it runs inside the Python
 * runner's own process), so its shape is declared here for the tests.
 */
import type { Server } from 'node:http'

export declare function hostAllowed(allowed: string[], host: string): boolean
export declare function isPrivateAddress(address: string): boolean
export declare function createEgressProxy(options?: {
  allowPrivate?: boolean
  resolve?: (host: string) => Promise<Array<{ address: string }>>
}): {
  server: Server
  register: (hosts: string[]) => { token: string; release: () => void }
  readonly activeGrants: number
}
