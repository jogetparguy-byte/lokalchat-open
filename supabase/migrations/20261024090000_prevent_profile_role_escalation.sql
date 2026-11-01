-- Prevent privilege escalation through public.profiles.role.
--
-- Before this migration the "Owners manage own profile" RLS policy allowed an
-- authenticated user to update every column of their own profile, including
-- role. A user could therefore run:
--
--   UPDATE public.profiles SET role = 'admin' WHERE id = auth.uid();
--
-- and gain access to the admin-only policies/functions.
--
-- This migration adds a defense-in-depth trigger. It does not drop or replace
-- any existing RLS policy. Service-role and migration/database-owner contexts
-- are still allowed to assign roles, which keeps admin bootstrap and backend
-- service-role operations working.

CREATE OR REPLACE FUNCTION public.guard_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_is_privileged boolean;
BEGIN
  caller_is_privileged :=
    coalesce(auth.role(), '') = 'service_role'
    OR current_user IN (
      'service_role',
      'postgres',
      'supabase_admin',
      'supabase_auth_admin'
    );

  IF TG_OP = 'INSERT' THEN
    -- New accounts must start as 'sme'. Only trusted server/database contexts
    -- may create a profile with an elevated role.
    IF NEW.role IS DISTINCT FROM 'sme' AND NOT caller_is_privileged THEN
      RAISE EXCEPTION 'Only administrators may assign profile roles'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  -- UPDATE: no-op role updates are allowed (for example an upsert that sends
  -- the unchanged value). Actual role changes require an existing admin or a
  -- trusted service-role/database context.
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT caller_is_privileged THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only administrators may change profile roles'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger functions do not need to be directly callable by API roles.
REVOKE ALL ON FUNCTION public.guard_profile_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_profile_role() TO service_role;

DROP TRIGGER IF EXISTS guard_profile_role ON public.profiles;
CREATE TRIGGER guard_profile_role
  BEFORE INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_role();
