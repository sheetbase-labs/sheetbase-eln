/** Opt-in, disposable-container verification: PIPELINE_PYTHON_TEST_IMAGE must be pinned. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { runDockerJob } from './pipeline-python-runner.mjs'

const image = process.env.PIPELINE_PYTHON_TEST_IMAGE
const job = (statement, inputs = {}, parameters = {}) => ({
  statement,
  inputs,
  parameters,
  runtime: image,
})

test(
  'real Python uses pinned scientific libraries and preserves decimal/date strings',
  { skip: !image },
  async () => {
    const result = await runDockerJob(
      job(
        `import pandas as pd
import numpy as np
from scipy import stats
def transform(inputs, parameters):
    data = pd.DataFrame(inputs['readings'])
    print('Processed', len(data), 'readings')
    return pd.DataFrame([{'mean': float(np.mean(data['value'])) * parameters['scale'], 'median': float(stats.scoreatpercentile(data['value'], 50)), 'original': inputs['readings'][0]['precise'], 'date': inputs['readings'][0]['date']}])`,
        {
          readings: [
            { value: 1, precise: '0.00000000000000001', date: '2026-09-07' },
            { value: 3, precise: '2', date: '2026-09-07' },
          ],
        },
        { scale: 2 },
      ),
      image,
    )
    assert.deepEqual(result.rows, [
      {
        mean: 4,
        median: 2,
        original: '0.00000000000000001',
        date: '2026-09-07',
      },
    ])
    assert.deepEqual(result.logs, ['Processed 2 readings'])
    assert.equal(result.runtime, image)
  },
)

test(
  'real container has no network, root writes, credentials or Docker socket',
  { skip: !image },
  async () => {
    const result = await runDockerJob(
      job(`import os, socket
def transform(inputs, parameters):
    root_readonly = False
    try:
        open('/probe', 'w').close()
    except OSError:
        root_readonly = True
    network_blocked = False
    connection = socket.socket()
    connection.settimeout(1)
    try:
        connection.connect(('1.1.1.1', 443))
    except OSError:
        network_blocked = True
    finally:
        connection.close()
    return [{'uid': os.getuid(), 'root_readonly': root_readonly, 'network_blocked': network_blocked, 'socket_present': os.path.exists('/var/run/docker.sock'), 'secret_present': 'PIPELINE_PYTHON_RUNNER_TOKEN' in os.environ}]`),
      image,
    )
    assert.deepEqual(result.rows, [
      {
        uid: 65532,
        root_readonly: true,
        network_blocked: true,
        socket_present: false,
        secret_present: false,
      },
    ])
  },
)

test(
  'real worker rejects non-finite scientific output instead of replacing it',
  { skip: !image },
  async () => {
    await assert.rejects(
      runDockerJob(
        job(
          "def transform(inputs, parameters): return [{'value': float('nan')}]",
        ),
        image,
      ),
      /Out of range float/,
    )
  },
)

test(
  'real worker bounds logs and rejects incompatible pinned runtime',
  { skip: !image },
  async () => {
    await assert.rejects(
      runDockerJob(
        job(
          "def transform(inputs, parameters):\n    print('x' * 70000)\n    return []",
        ),
        image,
      ),
      /log output exceeds/,
    )
    await assert.rejects(
      runDockerJob(
        {
          ...job('def transform(inputs, parameters): return []'),
          runtime: `other@sha256:${'a'.repeat(64)}`,
        },
        image,
      ),
      /pinned Python runtime/,
    )
  },
)

test(
  'real execution timeout removes a still-running Python container',
  { skip: !image, timeout: 75_000 },
  async () => {
    await assert.rejects(
      runDockerJob(
        job('def transform(inputs, parameters):\n    while True: pass'),
        image,
      ),
      (error) => error.code === 'transform_timed_out',
    )
  },
)
