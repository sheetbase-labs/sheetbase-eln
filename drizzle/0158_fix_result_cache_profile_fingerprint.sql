-- 0157 replaced the trusted-calculation finalizer (and its enforced profile
-- fingerprint) but left the formula_result_cache profile constraint pinned to
-- the retired fingerprint, so every finalize failed its insert check. Align
-- the constraint with the fingerprint 0157 enforces.
ALTER TABLE internal.formula_result_cache DROP CONSTRAINT formula_result_profile_check;
ALTER TABLE internal.formula_result_cache
  ADD CONSTRAINT formula_result_profile_check
  CHECK (engine_version = '3.3.0' AND profile_fingerprint = 'fnv1a32-12f5dcb7');
