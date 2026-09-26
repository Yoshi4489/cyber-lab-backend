-- Run as the migration/table owner after migrations. The NOLOGIN role must
-- already exist; grant it only to the API/worker login, never the migrator.
-- Run this file in one transaction (psql --single-transaction).
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM cyber_range_app;
GRANT USAGE ON SCHEMA public TO cyber_range_app;

GRANT SELECT, INSERT ON TABLE
  users, user_profiles, sessions, email_tokens, challenges, lab_nodes,
  instances, instance_operations, submissions, solves, audit_events
TO cyber_range_app;

GRANT UPDATE ON TABLE
  users, sessions, email_tokens, challenges, lab_nodes,
  instances, instance_operations, submissions
TO cyber_range_app;

-- No DELETE or TRUNCATE grants. In particular, audit_events is insert-only
-- for the application. New tables receive no grants until explicitly reviewed.
