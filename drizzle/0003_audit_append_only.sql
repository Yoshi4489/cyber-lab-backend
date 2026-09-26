CREATE FUNCTION "public"."deny_direct_audit_event_mutation"() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '55000';
  END IF;
  -- Existing user foreign keys anonymize actor/target references during deletion.
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "audit_events_append_only" BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION "public"."deny_direct_audit_event_mutation"();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_events" FROM PUBLIC;
