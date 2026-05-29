-- Enable Row Level Security on all tables.
-- The backend exclusively uses the service-role key which bypasses RLS, so
-- application behaviour is unchanged. RLS blocks any direct API access made
-- with the anon or user JWT keys (e.g. from a browser calling Supabase directly).

ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signups             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.selections          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_results       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_performance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swap_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_edit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_players       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config       ENABLE ROW LEVEL SECURITY;

-- No permissive policies are added, so all non-service-role access is denied
-- by default. All data access must go through the backend API.
