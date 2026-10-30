CREATE OR REPLACE FUNCTION "public"."deny_direct_audit_event_mutation"() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '55000';
  END IF;
  -- A user deletion may anonymize its existing audit references through the FK.
  IF TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
