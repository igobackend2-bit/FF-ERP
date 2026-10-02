-- Admin Day Backup: the two database functions behind /admin/day-backup.
--
-- Why functions instead of plain table reads from the browser: row-level security means an
-- admin session cannot be assumed to see every table, and PostgREST silently stops at 1000 rows.
-- A backup that quietly misses tables is worse than none, so the export goes through
-- SECURITY DEFINER functions that read every table in the public schema, refuse anyone who is not
-- an admin, and report exact row counts so the page can prove the export is complete.
--
-- What it adds (no table, column or data is changed):
--   admin_backup_manifest(p_date)          exact row count for EVERY public base table, optionally
--                                          limited to rows created/updated on p_date (IST)
--   admin_backup_rows(table, offset, limit, p_date)
--                                          one page of rows as a JSON array
--   _admin_backup_day_filter(table, date)  internal helper that builds the day WHERE clause
--
-- Safeguards:
--   * Both public functions raise an error unless get_my_role() = 'admin'.
--   * The table name must be a real public base table and is quoted with %I - no free-form SQL.
--   * Page size is capped at 5000 rows. Paging is ORDER BY ctid so pages never overlap.
--   * Day filter = created_at OR updated_at falls on p_date in Asia/Kolkata (all of these columns
--     are timestamptz). Tables without them use their own "date" / logged_at / submitted_at /
--     assigned_at column. Only tables with none of these (site_settings, app_config,
--     acct_voucher_series) are exported whole; the manifest marks them day_filtered = false.
--   * EXECUTE is revoked from PUBLIC and anon; only logged-in users can call them, and the
--     admin check inside decides.
--
-- STATUS: NOT YET APPLIED. Run in the Supabase SQL Editor (project qwiumswrbddwmlraktvy).
-- Idempotent: CREATE OR REPLACE plus re-runnable REVOKE/GRANT.
-- Note: running the manifest/rows functions inside the SQL Editor itself returns
-- "Only admins can export backups", because the editor has no logged-in app user. That is expected.

CREATE OR REPLACE FUNCTION public._admin_backup_day_filter(p_table text, p_date date)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_parts text[] := ARRAY[]::text[];
  c       record;
BEGIN
  IF p_date IS NULL THEN
    RETURN '';
  END IF;

  -- Preferred: created_at / updated_at (new or changed on that day).
  FOR c IN
    SELECT col.column_name
    FROM information_schema.columns col
    WHERE col.table_schema = 'public' AND col.table_name = p_table
      AND col.column_name IN ('created_at', 'updated_at')
      AND col.data_type = 'timestamp with time zone'
    ORDER BY col.column_name
  LOOP
    v_parts := v_parts || format('(%I AT TIME ZONE ''Asia/Kolkata'')::date = %L::date', c.column_name, p_date);
  END LOOP;

  -- Tables without those (daily-workflow reports, GPS log, PO assignments): fall back to their own
  -- business date ("date") or event timestamp (logged_at / submitted_at / assigned_at).
  IF array_length(v_parts, 1) IS NULL THEN
    FOR c IN
      SELECT col.column_name, col.data_type
      FROM information_schema.columns col
      WHERE col.table_schema = 'public' AND col.table_name = p_table
        AND ((col.column_name IN ('logged_at', 'submitted_at', 'assigned_at') AND col.data_type = 'timestamp with time zone')
          OR (col.column_name = 'date' AND col.data_type = 'date'))
      ORDER BY col.column_name
    LOOP
      IF c.data_type = 'date' THEN
        v_parts := v_parts || format('%I = %L::date', c.column_name, p_date);
      ELSE
        v_parts := v_parts || format('(%I AT TIME ZONE ''Asia/Kolkata'')::date = %L::date', c.column_name, p_date);
      END IF;
    END LOOP;
  END IF;

  -- Still nothing (small settings tables such as site_settings): export the whole table.
  IF array_length(v_parts, 1) IS NULL THEN
    RETURN '';
  END IF;

  RETURN 'WHERE ' || array_to_string(v_parts, ' OR ');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_backup_manifest(p_date date DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r       record;
  v_cnt   bigint;
  v_where text;
  v_out   jsonb := '[]'::jsonb;
BEGIN
  IF lower(coalesce(get_my_role(), '')) <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can export backups' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT t.table_name
    FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name
  LOOP
    v_where := public._admin_backup_day_filter(r.table_name, p_date);
    EXECUTE format('SELECT count(*) FROM public.%I %s', r.table_name, v_where) INTO v_cnt;
    v_out := v_out || jsonb_build_object(
      'table', r.table_name,
      'rows', v_cnt,
      'day_filtered', (p_date IS NOT NULL AND v_where <> '')
    );
  END LOOP;

  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_backup_rows(
  p_table  text,
  p_offset integer DEFAULT 0,
  p_limit  integer DEFAULT 2000,
  p_date   date    DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_where text;
  v_out   jsonb;
BEGIN
  IF lower(coalesce(get_my_role(), '')) <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can export backups' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND t.table_name = p_table
  ) THEN
    RAISE EXCEPTION 'Unknown table: %', p_table;
  END IF;

  p_limit  := LEAST(GREATEST(COALESCE(p_limit, 2000), 1), 5000);
  p_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_where  := public._admin_backup_day_filter(p_table, p_date);

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM (SELECT * FROM public.%I %s ORDER BY ctid OFFSET %s LIMIT %s) t',
    p_table, v_where, p_offset, p_limit
  ) INTO v_out;

  RETURN v_out;
END;
$function$;

-- Lock down who can call what. Supabase grants new functions to anon/authenticated by default,
-- so revoke explicitly; the helper is internal only and is reached through the two functions above.
REVOKE ALL ON FUNCTION public._admin_backup_day_filter(text, date)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_backup_manifest(date)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_backup_rows(text, integer, integer, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_backup_manifest(date)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_backup_rows(text, integer, integer, date) TO authenticated;

-- Verify: three rows, the two public ones SECURITY DEFINER (prosecdef = true) ...
SELECT proname, prosecdef
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace AND proname IN ('admin_backup_manifest', 'admin_backup_rows', '_admin_backup_day_filter')
ORDER BY proname;

-- ... anon must NOT be able to run them (expect false, false), logged-in users can (true, true).
SELECT
  has_function_privilege('anon',          'public.admin_backup_manifest(date)', 'EXECUTE')                      AS anon_manifest,
  has_function_privilege('anon',          'public.admin_backup_rows(text,integer,integer,date)', 'EXECUTE')     AS anon_rows,
  has_function_privilege('authenticated', 'public.admin_backup_manifest(date)', 'EXECUTE')                      AS authed_manifest,
  has_function_privilege('authenticated', 'public.admin_backup_rows(text,integer,integer,date)', 'EXECUTE')     AS authed_rows;
