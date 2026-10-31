#!/usr/bin/env node
/**
 * Manage PR preview sites on Railway (docs/operations/previews.md).
 *
 *   node scripts/preview.mjs up <pr> <branch>   create or update pr-<pr>
 *   node scripts/preview.mjs reseed <pr>        reset the preview database
 *   node scripts/preview.mjs down <pr>          delete the preview
 *   node scripts/preview.mjs url <pr>           print its address
 *
 * A preview is a copy of the production environment (app, PostgREST and its
 * own Postgres) named pr-<pr>, with the app pointed at the PR branch. Needs
 * RAILWAY_API_TOKEN. Only this file knows about Railway; the app is the same
 * container anywhere else.
 */
const API = 'https://backboard.railway.com/graphql/v2'
const PROJECT =
  process.env.RAILWAY_PROJECT_ID || '2dd75b57-c2e5-40e5-9445-b66df6594bce'
const PRODUCTION =
  process.env.RAILWAY_SOURCE_ENVIRONMENT_ID ||
  '40430531-3b47-40b8-9f26-3ea0968cbd85'
const REPO = process.env.GITHUB_REPOSITORY || 'sheetbase-labs/sheetbase-eln'
const SERVICES = { postgres: null, postgrest: null, app: null }

async function gql(query, variables = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RAILWAY_API_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  const body = await res.json()
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join('; '))
  return body.data
}

const log = (m) => console.error(`[preview] ${m}`)

async function services() {
  const d = await gql(
    `query($id:String!){project(id:$id){services{edges{node{id name}}}}}`,
    { id: PROJECT },
  )
  for (const { node } of d.project.services.edges) {
    if (node.name in SERVICES) SERVICES[node.name] = node.id
  }
  return SERVICES
}

async function findEnv(pr) {
  const d = await gql(
    `query($id:String!){project(id:$id){environments{edges{node{id name}}}}}`,
    { id: PROJECT },
  )
  return d.project.environments.edges
    .map((e) => e.node)
    .find((e) => e.name === `pr-${pr}`)
}

async function domainOf(envId) {
  const d = await gql(
    `query($p:String!,$e:String!,$s:String!){domains(projectId:$p,environmentId:$e,serviceId:$s){serviceDomains{domain}}}`,
    { p: PROJECT, e: envId, s: SERVICES.app },
  )
  return d.domains.serviceDomains[0]?.domain
}

async function up(pr, branch) {
  if (!pr || !branch) throw new Error('usage: up <pr> <branch>')
  await services()
  let env = await findEnv(pr)
  const fresh = !env
  if (fresh) {
    log(`creating environment pr-${pr}`)
    const d = await gql(
      `mutation($i:EnvironmentCreateInput!){environmentCreate(input:$i){id name}}`,
      {
        i: {
          name: `pr-${pr}`,
          projectId: PROJECT,
          sourceEnvironmentId: PRODUCTION,
          skipInitialDeploys: true,
        },
      },
    )
    env = d.environmentCreate
  }
  const e = env.id

  // Build the app from the PR branch, so a push redeploys the preview.
  const t = await gql(
    `query($p:String!,$e:String!,$s:String!){deploymentTriggers(projectId:$p,environmentId:$e,serviceId:$s){edges{node{id branch}}}}`,
    { p: PROJECT, e, s: SERVICES.app },
  )
  for (const { node } of t.deploymentTriggers.edges) {
    if (node.branch !== branch) {
      await gql(
        `mutation($id:String!,$i:DeploymentTriggerUpdateInput!){deploymentTriggerUpdate(id:$id,input:$i){id}}`,
        { id: node.id, i: { branch } },
      )
    }
  }

  let domain = await domainOf(e)
  if (!domain) {
    const d = await gql(
      `mutation($i:ServiceDomainCreateInput!){serviceDomainCreate(input:$i){domain}}`,
      { i: { environmentId: e, serviceId: SERVICES.app } },
    )
    domain = d.serviceDomainCreate.domain
  }

  await gql(
    `mutation($i:VariableCollectionUpsertInput!){variableCollectionUpsert(input:$i)}`,
    {
      i: {
        projectId: PROJECT,
        environmentId: e,
        serviceId: SERVICES.app,
        skipDeploys: true,
        variables: {
          BETTER_AUTH_URL: `https://${domain}`,
          PGRST_DB_URI: '${{postgrest.PGRST_DB_URI}}',
          PREVIEW_SEED: process.env.PREVIEW_SEED || '1',
        },
      },
    },
  )
  await gql(
    `mutation($s:String!,$e:String!,$i:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:$s,environmentId:$e,input:$i)}`,
    {
      s: SERVICES.app,
      e,
      i: { startCommand: 'node scripts/preview-start.mjs' },
    },
  )

  // The database and PostgREST were first uploaded by hand, so a copy has no
  // source to build from. Point them at this repository, with a database
  // volume of their own, then start whichever has never run.
  const source = { repo: REPO, branch }
  const configs = {
    postgres: 'docker/db/railway.json',
    postgrest: 'docker/postgrest/railway.json',
  }
  for (const [name, railwayConfigFile] of Object.entries(configs)) {
    await gql(
      `mutation($s:String!,$e:String!,$i:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:$s,environmentId:$e,input:$i)}`,
      {
        s: SERVICES[name],
        e,
        i: { source, railwayConfigFile },
      },
    )
  }
  if (fresh) {
    await gql(`mutation($i:VolumeCreateInput!){volumeCreate(input:$i){id}}`, {
      i: {
        projectId: PROJECT,
        environmentId: e,
        serviceId: SERVICES.postgres,
        mountPath: '/var/lib/postgresql',
      },
    })
  }
  const state = await gql(
    `query($id:String!){environment(id:$id){serviceInstances{edges{node{serviceId latestDeployment{id}}}}}}`,
    { id: e },
  )
  const started = new Set(
    state.environment.serviceInstances.edges
      .filter((x) => x.node.latestDeployment)
      .map((x) => x.node.serviceId),
  )
  const deploy = (serviceId) =>
    gql(
      `mutation($s:String!,$e:String!){serviceInstanceDeployV2(serviceId:$s,environmentId:$e)}`,
      { s: serviceId, e },
    )
  for (const name of ['postgres', 'postgrest']) {
    if (!started.has(SERVICES[name])) {
      log(`starting ${name}`)
      await deploy(SERVICES[name])
    }
  }
  await deploy(SERVICES.app)
  console.log(`https://${domain}`)
}

async function reseed(pr) {
  await services()
  const env = await findEnv(pr)
  if (!env) throw new Error(`no preview for PR ${pr}`)
  const token = String(Date.now())
  await gql(
    `mutation($i:VariableCollectionUpsertInput!){variableCollectionUpsert(input:$i)}`,
    {
      i: {
        projectId: PROJECT,
        environmentId: env.id,
        serviceId: SERVICES.app,
        skipDeploys: true,
        variables: { PREVIEW_SEED: token },
      },
    },
  )
  await gql(
    `mutation($s:String!,$e:String!){serviceInstanceRedeploy(serviceId:$s,environmentId:$e)}`,
    { s: SERVICES.app, e: env.id },
  )
  log('reseeding on the next start (a minute or two)')
}

async function down(pr) {
  const env = await findEnv(pr)
  if (!env) return log(`no preview for PR ${pr}`)
  if (env.id === PRODUCTION) throw new Error('refusing to delete production')
  await gql(`mutation($id:String!){environmentDelete(id:$id)}`, { id: env.id })
  log(`deleted pr-${pr}`)
}

async function url(pr) {
  await services()
  const env = await findEnv(pr)
  const domain = env && (await domainOf(env.id))
  if (!domain) process.exit(1)
  console.log(`https://${domain}`)
}

const [cmd, pr, branch] = process.argv.slice(2)
const commands = { up, reseed, down, url }
if (!commands[cmd]) {
  console.error(
    'usage: preview.mjs up <pr> <branch> | reseed <pr> | down <pr> | url <pr>',
  )
  process.exit(2)
}
await commands[cmd](pr, branch)
