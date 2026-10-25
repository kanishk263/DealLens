-- DealLens private storage buckets and object policies.
-- Object names are always '<company_id>/<submission_id>/<entity_id>/<sanitised filename>' and are
-- generated server-side (register_document / report worker). Policies resolve access through the
-- metadata row that owns the exact object path, so guessing a path grants nothing.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documents', 'documents', false, 52428800, array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel', 'text/csv', 'application/pdf']),
  ('reports', 'reports', false, 52428800, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Upload: only the registering user, only to the exact path of a document row still in 'uploading'.
create policy documents_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'documents' and exists (
    select 1 from public.documents d
    where d.storage_path = storage.objects.name and d.processing_status = 'uploading'
      and d.uploaded_by = auth.uid() and private.is_submission_member(d.submission_id)));

-- Read (signed URL creation / download): members of the company or in-scope finance team. Not superadmin.
create policy documents_select on storage.objects for select to authenticated using (
  bucket_id = 'documents' and exists (
    select 1 from public.documents d
    where d.storage_path = storage.objects.name and d.deleted_at is null and private.can_view_content(d.submission_id)));

-- Cleanup of an interrupted upload by its uploader.
create policy documents_delete_abandoned on storage.objects for delete to authenticated using (
  bucket_id = 'documents' and exists (
    select 1 from public.documents d
    where d.storage_path = storage.objects.name and d.processing_status = 'uploading' and d.uploaded_by = auth.uid()));

-- Reports are written only by the worker (service role). Company members can read published versions.
create policy reports_select on storage.objects for select to authenticated using (
  bucket_id = 'reports' and exists (
    select 1 from public.reports r
    where r.storage_path = storage.objects.name and (
      private.is_internal_in_scope(r.submission_id)
      or (r.status in ('published', 'superseded') and private.is_submission_member(r.submission_id)))));
