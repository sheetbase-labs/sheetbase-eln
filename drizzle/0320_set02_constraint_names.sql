-- The original ADMIN-001 migration used PostgreSQL's implicit check name;
-- align it with the committed schema before generating the flag transition.
ALTER TABLE api.project_access RENAME CONSTRAINT project_access_access_level_check TO chk_project_access_access_level;
