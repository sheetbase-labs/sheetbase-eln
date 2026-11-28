/**
 * Early reads: the page's data, asked for before the app's code has loaded.
 *
 * On a first load the browser spends most of its time fetching the app's
 * scripts, and the page only asks for its data once they have run, rendered
 * and mounted: data waits for code. The warm start (route-warm-start.ts)
 * already remembers which reads each page made last time. This script runs
 * inline in the page's head, before any script file arrives, and sends those
 * reads for the page being opened as one batch, so the answers travel while
 * the code does. When the app starts it hands each answer to the read that asks
 * for it (`adoptEarlyReads`); a read nobody asks for is dropped after a few
 * seconds, as with every warm-start guess.
 *
 * The inline script repeats the warm start's page matching (which page this
 * is, and its ids) in plain browser JavaScript; `early-reads.test.ts` checks
 * that both send the same reads. Reads still go through the batch route as the
 * signed-in person, so row-level security applies exactly as for the page.
 */
import { z } from 'zod'

import { primeReadWith } from './data-client'
import type { ReadAnswer, ReadSpec } from './data-client'
import { BATCH_MAX_READS, BATCH_URL } from './read-batch'
import { IDENTIFIER, STORAGE_KEY, UUID } from './route-warm-start'

/** Where the inline script leaves the batches it sent. */
export const EARLY_READS_GLOBAL = '__sheetbaseEarlyReads'

declare global {
  interface Window {
    /** Set by the inline script; read and cleared once by `adoptEarlyReads`. */
    __sheetbaseEarlyReads?: unknown
  }
}

/**
 * The inline script. Plain ES2017 so it runs as written in every browser the
 * app supports, before any bundle; any failure leaves the page to ask for
 * itself.
 */
export const earlyReadsScript = `(function(){try{
var s=JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})||'null');
if(!s||!s.templates)return;
var U=new RegExp(${JSON.stringify(UUID.source)},'i'),I=new RegExp(${JSON.stringify(IDENTIFIER.source)});
var ids=[];
var page=location.pathname.split('/').map(function(g){var w=U.exec(g);if((w&&w[0].length===g.length)||I.test(g)){ids.push(g);return ':id'}return g}).join('/');
var list=s.templates[(s.aliases&&s.aliases[page])||page];
if(!list||!list.length)return;
var fill=function(x){for(var i=0;i<ids.length;i++)x=x.split('\\u0001'+i+'\\u0001').join(ids[i]);return x};
var reads=[];
list.forEach(function(r){var p=fill(r.path),b=r.body==null?undefined:fill(r.body);if(p.indexOf('\\u0001')<0&&(b===undefined||b.indexOf('\\u0001')<0))reads.push({method:r.method,path:p,headers:r.headers,body:b})});
var send=function(g){return fetch(${JSON.stringify(BATCH_URL)},{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({reads:g})}).then(function(r){return r.ok?r.json():null}).then(function(j){return j&&j.results&&j.results.length===g.length?j.results:null},function(){return null})};
var groups=[];
for(var k=0;k<reads.length;k+=${BATCH_MAX_READS}){var g=reads.slice(k,k+${BATCH_MAX_READS});groups.push({reads:g,results:send(g)})}
window[${JSON.stringify(EARLY_READS_GLOBAL)}]={at:Date.now(),groups:groups};
}catch(e){}})();`

const readSpec = z.object({
  method: z.enum(['GET', 'POST']),
  path: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.string().optional(),
})

const readAnswer = z.object({
  status: z.number().int(),
  body: z.string(),
  contentRange: z.string().nullable(),
})

const earlyBatches = z.object({
  at: z.number(),
  groups: z.array(
    z.object({
      reads: z.array(readSpec),
      results: z.instanceof(Promise),
    }),
  ),
})

/** The batches the inline script sent, if it sent any. */
function sentEarly(): z.infer<typeof earlyBatches> | null {
  const parsed = earlyBatches.safeParse(window.__sheetbaseEarlyReads)

  window.__sheetbaseEarlyReads = undefined

  return parsed.success ? parsed.data : null
}

/**
 * Hands each early answer to the read that will ask for it. `hold` is the
 * data client's `primeReadWith`; tests pass their own. Returns how many reads
 * were handed over.
 */
export function adoptEarlyReads(
  hold: (
    read: ReadSpec,
    answer: Promise<ReadAnswer>,
    since: number,
  ) => void = primeReadWith,
): number {
  const early = sentEarly()

  if (!early) return 0
  let adopted = 0

  for (const group of early.groups) {
    const results = group.results.then((value) =>
      z.array(readAnswer).length(group.reads.length).parse(value),
    )

    group.reads.forEach((read, index) => {
      hold(
        read,
        results.then((answers) => answers[index]),
        early.at,
      )
      adopted += 1
    })
  }

  return adopted
}
