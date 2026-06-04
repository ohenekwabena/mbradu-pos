-- handle_new_user() only ever runs from the on_auth_user_created trigger (as the
-- definer). It must not be callable as a PostgREST RPC by API roles, so revoke
-- the default PUBLIC EXECUTE grant. Flagged by the Supabase security advisor.

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
