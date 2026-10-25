-- DealLens server-side operations, part 1: shared helpers, accounts, administration.
-- Every public function here is SECURITY DEFINER with an empty search_path and performs its own
-- identity, role, scope and state checks. Errors use SQLSTATE 42501 (forbidden), 22023 (invalid
-- input), P0002 (not found) and 55000 (invalid state) so the app can map them to safe messages.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function private.require_active() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_status public.account_status;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select account_status into v_status from public.profiles where id = auth.uid();
  if v_status is distinct from 'active' then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create or replace function private.require_role(p_role text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_active();
begin
  if not private.has_role(p_role) then
    raise exception 'Insufficient role' using errcode = '42501';
  end if;
  return v_uid;
end $$;

create or replace function private.audit(
  p_action text, p_entity_type text, p_entity_id text,
  p_company uuid default null, p_submission uuid default null, p_metadata jsonb default '{}'::jsonb,
  p_actor uuid default auth.uid()
) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, company_id, submission_id, metadata)
  values (p_actor, p_action, p_entity_type, p_entity_id, p_company, p_submission, coalesce(p_metadata, '{}'::jsonb));
$$;

create or replace function private.notify(
  p_user uuid, p_type text, p_title text, p_message text,
  p_entity_type text default null, p_entity_id uuid default null, p_link text default null
) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, notification_type, title, message, related_entity_type, related_entity_id, link_path)
  select p_user, p_type, p_title, p_message, p_entity_type, p_entity_id, p_link where p_user is not null;
$$;

create or replace function private.notify_role(
  p_role text, p_type text, p_title text, p_message text,
  p_entity_type text default null, p_entity_id uuid default null, p_link text default null
) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, notification_type, title, message, related_entity_type, related_entity_id, link_path)
  select distinct ur.user_id, p_type, p_title, p_message, p_entity_type, p_entity_id, p_link
  from public.user_roles ur join public.roles r on r.id = ur.role_id join public.profiles p on p.id = ur.user_id
  where r.role_key = p_role and ur.revoked_at is null and p.account_status = 'active';
$$;

create or replace function private.notify_company(
  p_company uuid, p_type text, p_title text, p_message text,
  p_entity_type text default null, p_entity_id uuid default null, p_link text default null
) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, notification_type, title, message, related_entity_type, related_entity_id, link_path)
  select m.user_id, p_type, p_title, p_message, p_entity_type, p_entity_id, p_link
  from public.company_memberships m join public.profiles p on p.id = m.user_id
  where m.company_id = p_company and m.status = 'active' and p.account_status = 'active';
$$;

create or replace function private.role_id(p_role text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.roles where role_key = p_role;
$$;

create or replace function private.grant_role_internal(p_user uuid, p_role text, p_granted_by uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if private.role_id(p_role) is null then
    raise exception 'Unknown role' using errcode = '22023';
  end if;
  insert into public.user_roles (user_id, role_id, granted_by)
  select p_user, private.role_id(p_role), p_granted_by
  where not exists (select 1 from public.user_roles where user_id = p_user and role_id = private.role_id(p_role) and revoked_at is null);
end $$;

-- ---------------------------------------------------------------------------
-- Profile lifecycle
-- ---------------------------------------------------------------------------
-- New auth users get a pending profile. Identity data is copied from auth.users (trusted), never from the client.
create or replace function private.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, coalesce(new.email, ''),
          coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
          new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (new.id, 'account.created', 'profile', new.id::text, jsonb_build_object('provider', new.raw_app_meta_data ->> 'provider'));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_auth_user();

create or replace function public.record_login() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  update public.profiles set last_login_at = now() where id = auth.uid();
  perform private.audit('auth.login', 'profile', auth.uid()::text);
end $$;

-- Superadmin bootstrap. Executable ONLY by service_role: the Next.js server verifies the session with
-- Supabase Auth, compares the verified email to SUPERADMIN_BOOTSTRAP_EMAIL and then calls this.
-- The function re-checks that the email on auth.users matches and is confirmed.
create or replace function public.bootstrap_superadmin(p_user uuid, p_expected_email text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_confirmed timestamptz;
begin
  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = p_user;
  if v_email is null or lower(v_email) <> lower(trim(p_expected_email)) or v_confirmed is null then
    raise exception 'Bootstrap identity mismatch' using errcode = '42501';
  end if;
  if private.user_has_role(p_user, 'superadmin') then
    return false;
  end if;
  update public.profiles set account_status = 'active' where id = p_user;
  perform private.grant_role_internal(p_user, 'superadmin', null);
  perform private.audit('admin.superadmin_bootstrapped', 'profile', p_user::text, null, null,
    jsonb_build_object('mechanism', 'SUPERADMIN_BOOTSTRAP_EMAIL'), p_user);
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Access requests
-- ---------------------------------------------------------------------------
create or replace function public.submit_access_request(
  p_company_name text, p_justification text, p_requested_role text default 'company_user', p_company_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_status public.account_status; v_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select account_status into v_status from public.profiles where id = v_uid;
  if v_status in ('suspended', 'rejected') then
    raise exception 'This account cannot submit access requests' using errcode = '42501';
  end if;
  if p_requested_role not in ('company_user', 'finance_analyst') then
    raise exception 'Requested role is not self-service' using errcode = '22023';
  end if;
  if exists (select 1 from public.access_requests where user_id = v_uid and status = 'pending') then
    raise exception 'You already have a pending access request' using errcode = '55000';
  end if;
  insert into public.access_requests (user_id, requested_company_name, requested_company_id, requested_role, business_justification)
  values (v_uid, trim(p_company_name), p_company_id, p_requested_role, trim(p_justification))
  returning id into v_id;
  perform private.audit('access_request.submitted', 'access_request', v_id::text, p_company_id, null,
    jsonb_build_object('requested_role', p_requested_role));
  perform private.notify_role('superadmin', 'access_request', 'New access request',
    'A new access request is awaiting review.', 'access_request', v_id, '/admin/access-requests');
  return v_id;
end $$;

create or replace function public.review_access_request(
  p_request uuid, p_decision text, p_notes text default null, p_company_id uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_role('superadmin'); r public.access_requests;
begin
  select * into r from public.access_requests where id = p_request for update;
  if not found then raise exception 'Access request not found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'Access request already reviewed' using errcode = '55000'; end if;
  if r.user_id = v_admin then raise exception 'You cannot review your own request' using errcode = '42501'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'Invalid decision' using errcode = '22023'; end if;

  if p_decision = 'approved' then
    if r.requested_role = 'company_user' then
      if coalesce(p_company_id, r.requested_company_id) is null then
        raise exception 'Select the company the user should join' using errcode = '22023';
      end if;
      if not exists (select 1 from public.companies where id = coalesce(p_company_id, r.requested_company_id) and status = 'active') then
        raise exception 'Company not found or inactive' using errcode = 'P0002';
      end if;
      insert into public.company_memberships (company_id, user_id, approved_by, status)
      values (coalesce(p_company_id, r.requested_company_id), r.user_id, v_admin, 'active')
      on conflict do nothing;
    end if;
    perform private.grant_role_internal(r.user_id, r.requested_role, v_admin);
    update public.profiles set account_status = 'active' where id = r.user_id and account_status = 'pending_approval';
  else
    update public.profiles set account_status = 'rejected'
    where id = r.user_id and account_status = 'pending_approval'
      and not exists (select 1 from public.user_roles where user_id = r.user_id and revoked_at is null);
  end if;

  update public.access_requests
    set status = p_decision::public.request_status, reviewed_by = v_admin, review_notes = p_notes, reviewed_at = now(),
        requested_company_id = coalesce(p_company_id, requested_company_id)
    where id = p_request;
  perform private.audit('access_request.' || p_decision, 'access_request', p_request::text,
    coalesce(p_company_id, r.requested_company_id), null, jsonb_build_object('user_id', r.user_id, 'role', r.requested_role));
  perform private.notify(r.user_id, 'access_request', 'Access request ' || p_decision,
    case when p_decision = 'approved' then 'Your DealLens access has been approved.' else 'Your DealLens access request was not approved.' end,
    'access_request', p_request, '/dashboard');
end $$;

-- ---------------------------------------------------------------------------
-- User and role administration (superadmin only, never on oneself)
-- ---------------------------------------------------------------------------
create or replace function public.set_account_status(p_user uuid, p_status public.account_status, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_role('superadmin'); v_old public.account_status;
begin
  if p_user = v_admin then raise exception 'You cannot change your own account status' using errcode = '42501'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'A reason is required' using errcode = '22023'; end if;
  select account_status into v_old from public.profiles where id = p_user for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  update public.profiles set account_status = p_status where id = p_user;
  perform private.audit('user.status_changed', 'profile', p_user::text, null, null,
    jsonb_build_object('from', v_old, 'to', p_status, 'reason', p_reason));
end $$;

create or replace function public.grant_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_role('superadmin');
begin
  if p_user = v_admin then raise exception 'Self role changes are not permitted' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_user and account_status = 'active') then
    raise exception 'Roles can only be granted to active accounts' using errcode = '55000';
  end if;
  perform private.grant_role_internal(p_user, p_role, v_admin);
  perform private.audit('role.granted', 'profile', p_user::text, null, null, jsonb_build_object('role', p_role));
end $$;

create or replace function public.revoke_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_role('superadmin');
begin
  if p_user = v_admin then raise exception 'Self role changes are not permitted' using errcode = '42501'; end if;
  update public.user_roles set revoked_at = now()
    where user_id = p_user and role_id = private.role_id(p_role) and revoked_at is null;
  if not found then raise exception 'Role not assigned' using errcode = 'P0002'; end if;
  perform private.audit('role.revoked', 'profile', p_user::text, null, null, jsonb_build_object('role', p_role));
end $$;

-- ---------------------------------------------------------------------------
-- Companies, memberships, invitations
-- ---------------------------------------------------------------------------
create or replace function public.upsert_company(
  p_id uuid, p_legal_name text, p_display_name text, p_industry text, p_country text,
  p_currency text, p_unit text, p_description text, p_status public.record_status default 'active'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_role('superadmin'); v_id uuid;
begin
  if p_id is null then
    insert into public.companies (legal_name, display_name, industry, country, reporting_currency, reporting_unit, description, status)
    values (trim(p_legal_name), trim(p_display_name), p_industry, p_country, upper(p_currency), p_unit, p_description, p_status)
    returning id into v_id;
    perform private.audit('company.created', 'company', v_id::text, v_id);
  else
    update public.companies set legal_name = trim(p_legal_name), display_name = trim(p_display_name), industry = p_industry,
      country = p_country, reporting_currency = upper(p_currency), reporting_unit = p_unit, description = p_description, status = p_status
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Company not found' using errcode = 'P0002'; end if;
    perform private.audit('company.updated', 'company', v_id::text, v_id, null, jsonb_build_object('status', p_status));
  end if;
  return v_id;
end $$;

create or replace function public.set_membership_status(p_membership uuid, p_status public.membership_status) returns void
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_role('superadmin'); m public.company_memberships;
begin
  update public.company_memberships set status = p_status where id = p_membership returning * into m;
  if not found then raise exception 'Membership not found' using errcode = 'P0002'; end if;
  perform private.audit('membership.status_changed', 'company_membership', p_membership::text, m.company_id, null,
    jsonb_build_object('user_id', m.user_id, 'status', p_status));
end $$;

create or replace function public.create_invitation(p_company uuid, p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_role('superadmin'); v_token text; v_ttl int; v_id uuid;
begin
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Invalid email' using errcode = '22023'; end if;
  if not exists (select 1 from public.companies where id = p_company and status = 'active') then
    raise exception 'Company not found or inactive' using errcode = 'P0002';
  end if;
  select (value #>> '{}')::int into v_ttl from public.platform_settings where key = 'invitation_ttl_hours';
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (company_id, email, token_hash, invited_by, expires_at)
  values (p_company, lower(trim(p_email)), encode(extensions.digest(v_token, 'sha256'), 'hex'), v_admin,
          now() + make_interval(hours => coalesce(v_ttl, 168)))
  returning id into v_id;
  perform private.audit('invitation.created', 'invitation', v_id::text, p_company, null, jsonb_build_object('email', lower(trim(p_email))));
  return v_token;  -- shown once to the admin; only the hash is stored
end $$;

create or replace function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_role('superadmin'); v_company uuid;
begin
  update public.invitations set revoked_at = now() where id = p_invitation and accepted_at is null and revoked_at is null
  returning company_id into v_company;
  if not found then raise exception 'Invitation not found or no longer pending' using errcode = 'P0002'; end if;
  perform private.audit('invitation.revoked', 'invitation', p_invitation::text, v_company);
end $$;

create or replace function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_email text; i public.invitations; v_status public.account_status;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select email into v_email from auth.users where id = v_uid;
  select * into i from public.invitations where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') for update;
  if not found or i.revoked_at is not null or i.accepted_at is not null or i.expires_at < now() then
    raise exception 'Invitation is invalid or has expired' using errcode = '42501';
  end if;
  if lower(v_email) <> i.email then
    raise exception 'This invitation was issued to a different email address' using errcode = '42501';
  end if;
  select account_status into v_status from public.profiles where id = v_uid;
  if v_status in ('suspended') then raise exception 'Account is suspended' using errcode = '42501'; end if;
  insert into public.company_memberships (company_id, user_id, invited_by, approved_by, status)
  values (i.company_id, v_uid, i.invited_by, i.invited_by, 'active') on conflict do nothing;
  perform private.grant_role_internal(v_uid, 'company_user', i.invited_by);
  update public.profiles set account_status = 'active' where id = v_uid and account_status in ('pending_approval', 'rejected');
  update public.invitations set accepted_by = v_uid, accepted_at = now() where id = i.id;
  update public.access_requests set status = 'withdrawn' where user_id = v_uid and status = 'pending';
  perform private.audit('invitation.accepted', 'invitation', i.id::text, i.company_id);
  return i.company_id;
end $$;

create or replace function public.update_platform_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_role('superadmin'); v_old jsonb;
begin
  select value into v_old from public.platform_settings where key = p_key for update;
  if not found then raise exception 'Unknown setting' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_value) <> jsonb_typeof(v_old) then raise exception 'Setting type mismatch' using errcode = '22023'; end if;
  if p_key = 'max_upload_mb' and ((p_value #>> '{}')::numeric not between 1 and 50) then
    raise exception 'max_upload_mb must be between 1 and 50' using errcode = '22023';
  end if;
  update public.platform_settings set value = p_value, updated_by = v_admin, updated_at = now() where key = p_key;
  perform private.audit('settings.updated', 'platform_setting', p_key, null, null, jsonb_build_object('from', v_old, 'to', p_value));
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns void
language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
$$;
