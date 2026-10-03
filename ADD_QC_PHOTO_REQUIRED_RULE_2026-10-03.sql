-- Database rule: a QC inspection cannot be saved without at least one batch photo.
--
-- Why: the QC form now requires a photo (PR "Make the QC batch photo compulsory"), but a form rule only
-- covers that screen. This puts the same rule in the database so it holds for any screen, app or script.
--
-- What it does:
--   * INSERT: rejects a new qc_inspections row whose photo_urls is empty (or only blank entries).
--   * UPDATE of photo_urls: rejects clearing photos from an inspection that has them.
--
-- Deliberately a trigger, not a CHECK constraint: 47 older inspections have no photo (they were saved
-- before photo storage existed and cannot be recovered). A CHECK would make those rows impossible to
-- update, for example when a manager reviews them. This trigger leaves them alone.
--
-- Escape hatch for a deliberate data repair in the SQL Editor (transaction only):
--   select set_config('app.skip_qc_photo_check', 'on', true);
--
-- Only QCInspection.tsx creates inspections; the table has no other triggers. The form uploads the photos
-- first and then saves, so a normal inspection passes. If this is applied before the new form is deployed,
-- the old form's save is refused with the message below.
--
-- STATUS: NOT YET APPLIED. Run in the Supabase SQL Editor (project qwiumswrbddwmlraktvy). Idempotent.

CREATE OR REPLACE FUNCTION public.qc_require_photo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('app.skip_qc_photo_check', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF coalesce(array_length(array_remove(array_remove(NEW.photo_urls, ''), NULL), 1), 0) = 0 THEN
      RAISE EXCEPTION 'A QC inspection needs at least one batch photo'
        USING ERRCODE = '23514', HINT = 'Upload a photo of the batch before saving the inspection.';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF coalesce(array_length(array_remove(array_remove(OLD.photo_urls, ''), NULL), 1), 0) > 0
       AND coalesce(array_length(array_remove(array_remove(NEW.photo_urls, ''), NULL), 1), 0) = 0 THEN
      RAISE EXCEPTION 'Photos cannot be removed from a QC inspection'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS qc_require_photo_trg ON public.qc_inspections;
CREATE TRIGGER qc_require_photo_trg
  BEFORE INSERT OR UPDATE OF photo_urls ON public.qc_inspections
  FOR EACH ROW EXECUTE FUNCTION public.qc_require_photo();

REVOKE ALL ON FUNCTION public.qc_require_photo() FROM PUBLIC, anon, authenticated;

-- Verify: one trigger row, covering INSERT and UPDATE (tgtype shows the events).
SELECT t.tgname, c.relname AS on_table, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE t.tgname = 'qc_require_photo_trg';
