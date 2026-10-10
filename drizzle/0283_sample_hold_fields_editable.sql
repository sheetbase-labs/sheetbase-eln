-- LAB-02 follow-up — sample hold fields are user-set metadata.
--
-- The hold condition, start, duration, deadline and allowed-use experiment list
-- are entered by a person when a sample is registered or reviewed, so they must
-- be writable through the canonical sample edit path and the design seed. The
-- initial registration marked them `protected`, which the record guard rejects
-- on any ordinary insert/update. Remove the protected marker from these five
-- sample base fields; every other guard (membership, workspace, validation)
-- still applies.

UPDATE api.model_base_fields
SET presentation = presentation - 'protected'
WHERE model_key = 'sample'
  AND field_key IN (
    'holdCondition',
    'holdStartedAt',
    'holdDurationDays',
    'holdUntil',
    'allowedUseExperimentIds'
  );
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
