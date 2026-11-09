import { describe, expect, it } from 'vitest'

import { migrationObjects, sharedObjects } from './migration-objects.mjs'

describe('migrationObjects', () => {
  it('reads tables, indexes, policies and foreign keys', () => {
    const objects = migrationObjects(`
      -- touches "ignored_comment"
      CREATE TABLE IF NOT EXISTS public."robot_runs" (
        id uuid primary key,
        sample_id uuid REFERENCES samples (id)
      );
      ALTER TABLE ONLY public.experiments ADD COLUMN note text;
      CREATE UNIQUE INDEX IF NOT EXISTS robot_runs_idx ON robot_runs (id);
      CREATE POLICY runs_read ON robot_runs FOR SELECT USING (true);
      CREATE OR REPLACE FUNCTION api.refresh_runs() RETURNS void AS $$ select 1 $$;
      UPDATE settings SET v = 1;
      GRANT SELECT ON TABLE robot_runs TO authenticated;
    `)

    for (const name of [
      'robot_runs',
      'samples',
      'experiments',
      'robot_runs_idx',
      'runs_read',
      'refresh_runs',
      'settings',
    ]) {
      expect(objects.has(name)).toBe(true)
    }

    expect(objects.has('ignored_comment')).toBe(false)
  })

  it('finds what two migrations share', () => {
    const a = migrationObjects('ALTER TABLE samples ADD COLUMN a int;')
    const b = migrationObjects('ALTER TABLE samples ADD COLUMN b int;')
    const c = migrationObjects('ALTER TABLE plates ADD COLUMN c int;')
    expect(sharedObjects(a, b)).toEqual(['samples'])
    expect(sharedObjects(a, c)).toEqual([])
  })
})
