/**
 * A connection's secret as it is sealed: a step names it `HPC_SUBMIT_KEY`,
 * connector secrets are lowercase snake_case, so it is kept as `hpc_submit_key`.
 */
export const sealedSecretName = (name: string): string => name.toLowerCase()
