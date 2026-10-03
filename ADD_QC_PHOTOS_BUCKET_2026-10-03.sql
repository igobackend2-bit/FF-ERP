-- Create the missing "qc-photos" storage bucket used by the QC Inspection page.
--
-- What the user saw (2026-10-03): photos uploaded while a hub manager inspects a delivery were not
-- shown anywhere. Cause: QCInspection.tsx uploads to a bucket called "qc-photos", but that bucket
-- was never created in this project (existing buckets: app-images, banner, employee-selfies,
-- product-images, products, transport-proofs, wastage-photos). Every upload failed, the old code
-- ignored the error and saved the inspection with photo_urls = [] - all 37 inspections so far have
-- no photos. The page now reports upload failures instead of hiding them.
--
-- What it does:
--   * Creates the bucket (public, so the Inventory page can show thumbnails by link - same as the
--     other photo buckets), images only, 10 MB per file.
--   * Lets any logged-in user upload and read QC photos; there is no update/delete policy, so
--     uploaded evidence cannot be overwritten or removed from the app.
--
-- Photos taken before this is run were never stored and cannot be recovered; only new inspections
-- will have photos.
--
-- STATUS: NOT YET APPLIED. Run in the Supabase SQL Editor (project qwiumswrbddwmlraktvy), BEFORE
-- the hub managers use the new QC form. Idempotent.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('qc-photos', 'qc-photos', true, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists qc_photos_upload on storage.objects;
create policy qc_photos_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'qc-photos');

drop policy if exists qc_photos_read on storage.objects;
create policy qc_photos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'qc-photos');

-- Verify: one bucket row (public = true, 10485760) and the two policies.
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'qc-photos';
select policyname, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'qc_photos%'
order by policyname;
