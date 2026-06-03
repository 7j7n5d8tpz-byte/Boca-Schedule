-- Two fixes that a fresh database needs but the earlier migrations missed.

-- 1. Grant the backend's service role access to the application tables.
--    20260529000001 enabled RLS on every table. The backend uses the
--    service-role key, which bypasses RLS — but it still needs table-level
--    GRANTs, and those are not present on a fresh database. Without them every
--    backend query fails with "permission denied for table ...", which breaks
--    login and everything else. (anon/authenticated are intentionally NOT
--    granted: all access goes through the backend, and RLS keeps them out.)
GRANT USAGE  ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

-- 2. Bootstrap the owner as admin. On a fresh database there is no admin to
--    approve the first one through the UI, so promote a fixed email to an
--    active admin the moment its profile row is created. The owner just
--    registers through the app and immediately has admin access — no manual
--    SQL, no pending-approval step. Only this one email is affected.
CREATE OR REPLACE FUNCTION public.promote_owner_to_admin()
RETURNS TRIGGER AS $$
BEGIN
  IF lower(NEW.email) = 'andreas@brendstrup.dk' THEN
    NEW.role      := 'admin';
    NEW.is_active := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS promote_owner_to_admin ON public.users;
CREATE TRIGGER promote_owner_to_admin
  BEFORE INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.promote_owner_to_admin();
