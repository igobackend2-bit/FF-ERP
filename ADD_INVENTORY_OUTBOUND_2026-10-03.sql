-- Inventory: take stock OUT when goods are sold, and a movement ledger the Inventory page can filter by date.
--
-- Why: stock only went up (QC inspection) and down (wastage). Nothing reduced it when goods were
-- sold, so it never fell, and run_eod_po_engine (demand minus inventory.quantity) under-bought.
--
-- What it adds. Everything below is INERT until you run ENABLE_INVENTORY_OUTBOUND_2026-10-03.sql:
--   inventory_outbound_settings   the on/off switch (enabled = false) and the first date counted (2026-10-02)
--   inventory_order_deductions    one row per order already deducted, so an order is never deducted twice
--   inv_deduct_for_order()        takes an order's sold quantities out of its hub's stock via inv__move()
--   3 triggers                    the signals that mean "delivered", first one wins:
--                                   a collection entry for the order (cash_collections insert)
--                                   its invoice becoming 'paid'
--                                   the order status becoming 'delivered'
--   inventory_log checks          its two allowed-value lists are EXTENDED with 'qc_receive' / 'sale' and
--                                 'qc_inspection' / 'sales_order' (section 0); nothing already allowed is removed
--   increment_inventory()         QC receipts now write the movement ledger too (see section 5)
--   inventory_movement_summary()  opening / received / sold / wastage / closing for a date range
--
-- How a sale is deducted:
--   * quantity = coalesce(qty_kg, quantity) - the same figure run_eod_po_engine uses for demand.
--   * product = the line's product_id, else the ONE product whose name matches exactly (trimmed,
--     ignoring case). Lines that match nothing, or whose product has no stock record at that hub, are
--     NOT deducted; they are listed in inventory_order_deductions.unmatched. Roughly 4 in 10 recent
--     sale lines are custom item names and fall here.
--   * inv__move() never lets stock go below 0 and logs "requested X, limited by stock on hand".
--   * Orders with no hub are skipped and recorded. Orders delivering before start_date are ignored.
--   * A failure inside a trigger becomes a WARNING and never blocks saving a collection, invoice or order.
--
-- Not handled (later): stock is not added back for returns or for cancellations after deduction.
--
-- SECURITY FIX included: increment_inventory() was executable by anyone holding the public (anon) key,
-- which would let outsiders change stock. It is now limited to logged-in users.
--
-- STATUS: NOT YET APPLIED. Run in the Supabase SQL Editor (project qwiumswrbddwmlraktvy).
-- Then run CHECK_INVENTORY_OUTBOUND_PREVIEW_2026-10-03.sql, and only when happy, ENABLE_... .
-- Idempotent: safe to run twice.

-- 0. Allow the new ledger values ------------------------------------------------------------------------
-- inventory_log has two CHECK lists. The first version of this script was rejected by them (error 23514,
-- inventory_log_event_type_check) because it wrote the event names 'qc_receive' and 'sale' and the
-- reference types 'qc_inspection' and 'sales_order'. Both lists are EXTENDED, never shrunk: every value
-- that was allowed before still is. Re-running is harmless.
ALTER TABLE public.inventory_log DROP CONSTRAINT IF EXISTS inventory_log_event_type_check;
ALTER TABLE public.inventory_log ADD CONSTRAINT inventory_log_event_type_check
  CHECK (event_type = ANY (ARRAY['receive', 'dispatch', 'wastage', 'qc_reject', 'return', 'adjustment',
                                 'qc_receive', 'sale']));
ALTER TABLE public.inventory_log DROP CONSTRAINT IF EXISTS inventory_log_ref_type_check;
ALTER TABLE public.inventory_log ADD CONSTRAINT inventory_log_ref_type_check
  CHECK (ref_type IS NULL OR ref_type = ANY (ARRAY['box', 'pack', 'order', 'adjustment', 'wastage', 'manual',
                                                   'qc_inspection', 'sales_order']));

-- 1. Settings ----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_outbound_settings (
  id          boolean     PRIMARY KEY DEFAULT true CHECK (id),
  enabled     boolean     NOT NULL DEFAULT false,
  start_date  date        NOT NULL DEFAULT DATE '2026-10-02',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.inventory_outbound_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.inventory_outbound_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inv_outbound_settings_read ON public.inventory_outbound_settings;
CREATE POLICY inv_outbound_settings_read ON public.inventory_outbound_settings
  FOR SELECT TO authenticated USING (public.is_staff());
DROP POLICY IF EXISTS inv_outbound_settings_admin_update ON public.inventory_outbound_settings;
CREATE POLICY inv_outbound_settings_admin_update ON public.inventory_outbound_settings
  FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'admin') WITH CHECK (public.get_my_role() = 'admin');

-- 2. One row per deducted order -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_order_deductions (
  order_id       uuid        PRIMARY KEY REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  source         text        NOT NULL,
  deducted_at    timestamptz NOT NULL DEFAULT now(),
  lines_total    integer     NOT NULL DEFAULT 0,
  lines_matched  integer     NOT NULL DEFAULT 0,
  requested_kg   numeric     NOT NULL DEFAULT 0,
  applied_kg     numeric     NOT NULL DEFAULT 0,
  unmatched      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  skipped_reason text
);
ALTER TABLE public.inventory_order_deductions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inv_order_deductions_read ON public.inventory_order_deductions;
CREATE POLICY inv_order_deductions_read ON public.inventory_order_deductions
  FOR SELECT TO authenticated USING (public.is_staff());

-- 3. The deduction itself --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_deduct_for_order(p_order_id uuid, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_set       public.inventory_outbound_settings;
  v_order     record;
  v_claimed   integer;
  r           record;
  v_prod      uuid;
  v_nmatch    integer;
  v_qty       numeric;
  v_applied   numeric;
  v_total     integer := 0;
  v_matched   integer := 0;
  v_req       numeric := 0;
  v_app       numeric := 0;
  v_unmatched jsonb   := '[]'::jsonb;
BEGIN
  SELECT * INTO v_set FROM public.inventory_outbound_settings LIMIT 1;
  IF v_set.enabled IS DISTINCT FROM true THEN RETURN; END IF;

  SELECT so.id, so.hub_id, so.status, so.order_number, coalesce(so.delivery_date, so.order_date) AS d
    INTO v_order
  FROM public.sales_orders so WHERE so.id = p_order_id;
  IF v_order.id IS NULL OR v_order.status = 'cancelled' OR v_order.d < v_set.start_date THEN RETURN; END IF;

  IF v_order.hub_id IS NULL THEN
    INSERT INTO public.inventory_order_deductions (order_id, source, skipped_reason)
    VALUES (p_order_id, p_source, 'no hub')
    ON CONFLICT (order_id) DO NOTHING;
    RETURN;
  END IF;

  -- Claim the order first. A row that is only a skip record (for example "no hub" that has since been
  -- fixed) can be claimed again; a real deduction cannot, which is what makes this once-only.
  INSERT INTO public.inventory_order_deductions (order_id, source)
  VALUES (p_order_id, p_source)
  ON CONFLICT (order_id) DO UPDATE
    SET source = EXCLUDED.source, skipped_reason = NULL, deducted_at = now()
    WHERE public.inventory_order_deductions.skipped_reason IS NOT NULL
  RETURNING 1 INTO v_claimed;
  IF v_claimed IS NULL THEN RETURN; END IF;

  FOR r IN
    SELECT soi.product_id, soi.product_name, coalesce(soi.qty_kg, soi.quantity, 0) AS qty
    FROM public.sales_order_items soi
    WHERE soi.order_id = p_order_id
  LOOP
    v_total := v_total + 1;
    v_qty   := r.qty;
    v_prod  := r.product_id;

    IF v_prod IS NULL AND coalesce(btrim(r.product_name), '') <> '' THEN
      SELECT count(*), min(p.id::text)::uuid INTO v_nmatch, v_prod
      FROM public.products p
      WHERE lower(btrim(p.name)) = lower(btrim(r.product_name));
      IF v_nmatch <> 1 THEN v_prod := NULL; END IF;
    END IF;

    IF v_qty <= 0 THEN CONTINUE; END IF;

    IF v_prod IS NULL THEN
      v_unmatched := v_unmatched || jsonb_build_object('name', r.product_name, 'qty', v_qty, 'reason', 'no product match');
      CONTINUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.inventory i WHERE i.hub_id = v_order.hub_id AND i.product_id = v_prod) THEN
      v_unmatched := v_unmatched || jsonb_build_object('name', r.product_name, 'qty', v_qty, 'reason', 'not in this hub''s stock list');
      CONTINUE;
    END IF;

    v_matched := v_matched + 1;
    v_req     := v_req + v_qty;
    v_applied := -public.inv__move(
      v_order.hub_id, v_prod, -v_qty, 'sale', 'sales_order', p_order_id,
      'Sold: ' || coalesce(v_order.order_number, p_order_id::text) || ' (' || p_source || ')', NULL);
    v_app := v_app + v_applied;
  END LOOP;

  UPDATE public.inventory_order_deductions
     SET lines_total   = v_total,
         lines_matched = v_matched,
         requested_kg  = v_req,
         applied_kg    = v_app,
         unmatched     = v_unmatched
   WHERE order_id = p_order_id;
END;
$function$;

-- 4. The three "delivered" signals (first one wins; later ones find the order already claimed) ------------
CREATE OR REPLACE FUNCTION public.trg_inv_outbound_collection()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    PERFORM public.inv_deduct_for_order(NEW.order_id, 'collection');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'inventory outbound (collection) failed for order %: %', NEW.order_id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_inv_outbound_invoice_paid()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    PERFORM public.inv_deduct_for_order(NEW.order_id, 'invoice_paid');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'inventory outbound (invoice paid) failed for order %: %', NEW.order_id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_inv_outbound_order_delivered()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    PERFORM public.inv_deduct_for_order(NEW.id, 'order_delivered');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'inventory outbound (order delivered) failed for order %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS inv_outbound_on_collection ON public.cash_collections;
CREATE TRIGGER inv_outbound_on_collection
  AFTER INSERT ON public.cash_collections
  FOR EACH ROW WHEN (NEW.order_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_inv_outbound_collection();

DROP TRIGGER IF EXISTS inv_outbound_on_invoice_paid ON public.invoices;
CREATE TRIGGER inv_outbound_on_invoice_paid
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW WHEN (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.order_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_inv_outbound_invoice_paid();

DROP TRIGGER IF EXISTS inv_outbound_on_order_delivered ON public.sales_orders;
CREATE TRIGGER inv_outbound_on_order_delivered
  AFTER UPDATE OF status ON public.sales_orders
  FOR EACH ROW WHEN (NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered')
  EXECUTE FUNCTION public.trg_inv_outbound_order_delivered();

-- 5. QC receipts now write the movement ledger --------------------------------------------------------
-- Same first five arguments, plus an optional inspection id. The old five-argument function must be
-- dropped first: two overloads would make rpc() calls ambiguous. Existing five-argument callers keep working.
DROP FUNCTION IF EXISTS public.increment_inventory(uuid, uuid, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION public.increment_inventory(
  p_hub_id        uuid,
  p_product_id    uuid,
  p_grade_a       numeric,
  p_grade_b       numeric,
  p_grade_c       numeric,
  p_inspection_id uuid DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric := COALESCE(p_grade_a, 0) + COALESCE(p_grade_b, 0) + COALESCE(p_grade_c, 0);
BEGIN
  IF v_total <= 0 THEN RETURN; END IF;
  PERFORM public.inv__move(p_hub_id, p_product_id, v_total, 'qc_receive', 'qc_inspection',
                           p_inspection_id, 'QC inspection', auth.uid());
END;
$function$;

-- 6. Backfill the ledger for QC receipts that happened before this change ---------------------------------
-- Adds history only; inventory.quantity is NOT changed. Re-running adds nothing.
INSERT INTO public.inventory_log (inventory_id, hub_id, product_id, event_type, qty_delta, ref_id, ref_type, notes, created_by, created_at)
SELECT inv.id, q.hub_id, q.product_id, 'qc_receive',
       COALESCE(q.grade_a_kg, 0) + COALESCE(q.grade_b_kg, 0) + COALESCE(q.grade_c_kg, 0),
       q.id, 'qc_inspection', 'QC ' || COALESCE(q.grn_number, '') || ' (backfilled)', NULL, q.created_at
FROM public.qc_inspections q
LEFT JOIN public.inventory inv ON inv.hub_id = q.hub_id AND inv.product_id = q.product_id
WHERE q.hub_id IS NOT NULL AND q.product_id IS NOT NULL
  AND COALESCE(q.grade_a_kg, 0) + COALESCE(q.grade_b_kg, 0) + COALESCE(q.grade_c_kg, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.inventory_log l WHERE l.ref_type = 'qc_inspection' AND l.ref_id = q.id);

-- 7. Date view: opening / received / sold / wastage / closing for a range (India time) --------------------
-- closing = stock now minus every movement after the range; opening = stock now minus every movement since it started.
CREATE OR REPLACE FUNCTION public.inventory_movement_summary(p_from date, p_to date, p_hub uuid DEFAULT NULL)
 RETURNS TABLE (
   hub_id       uuid,
   product_id   uuid,
   hub_name     text,
   product_name text,
   opening      numeric,
   received     numeric,
   sold         numeric,
   wastage      numeric,
   other        numeric,
   closing      numeric
 )
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH b AS (
    SELECT (p_from::timestamp AT TIME ZONE 'Asia/Kolkata')        AS s,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')    AS e
  ),
  cur AS (
    SELECT i.hub_id AS c_hub, i.product_id AS c_prod, i.quantity::numeric AS qty
    FROM public.inventory i
    WHERE p_hub IS NULL OR i.hub_id = p_hub
  ),
  mv AS (
    -- qty_delta is double precision; cast so the sums are numeric and round(..., 3) works.
    SELECT l.hub_id AS m_hub, l.product_id AS m_prod,
      sum(l.qty_delta::numeric)  FILTER (WHERE l.created_at >= b.s)                                                    AS since_from,
      sum(l.qty_delta::numeric)  FILTER (WHERE l.created_at >= b.e)                                                    AS after_to,
      sum(l.qty_delta::numeric)  FILTER (WHERE l.created_at >= b.s AND l.created_at < b.e
                                           AND l.event_type IN ('qc_receive', 'receive'))                              AS received,
      sum(-l.qty_delta::numeric) FILTER (WHERE l.created_at >= b.s AND l.created_at < b.e AND l.event_type = 'sale')   AS sold,
      sum(-l.qty_delta::numeric) FILTER (WHERE l.created_at >= b.s AND l.created_at < b.e AND l.event_type = 'wastage') AS wastage,
      sum(l.qty_delta::numeric)  FILTER (WHERE l.created_at >= b.s AND l.created_at < b.e
                                           AND l.event_type NOT IN ('qc_receive', 'receive', 'sale', 'wastage'))       AS other
    FROM public.inventory_log l CROSS JOIN b
    WHERE l.hub_id IS NOT NULL AND l.product_id IS NOT NULL AND (p_hub IS NULL OR l.hub_id = p_hub)
    GROUP BY l.hub_id, l.product_id
  )
  SELECT cur.c_hub, cur.c_prod,
         coalesce(h.display_name, h.name), p.name,
         round(cur.qty - coalesce(mv.since_from, 0), 3),
         round(coalesce(mv.received, 0), 3),
         round(coalesce(mv.sold, 0), 3),
         round(coalesce(mv.wastage, 0), 3),
         round(coalesce(mv.other, 0), 3),
         round(cur.qty - coalesce(mv.after_to, 0), 3)
  FROM cur
  LEFT JOIN mv ON mv.m_hub = cur.c_hub AND mv.m_prod = cur.c_prod
  LEFT JOIN public.hubs h ON h.id = cur.c_hub
  LEFT JOIN public.products p ON p.id = cur.c_prod
  ORDER BY p.name, coalesce(h.display_name, h.name);
$function$;

-- 8. Who may call what ---------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.inv_deduct_for_order(uuid, text)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_inv_outbound_collection()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_inv_outbound_invoice_paid()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_inv_outbound_order_delivered()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_inventory(uuid, uuid, numeric, numeric, numeric, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.increment_inventory(uuid, uuid, numeric, numeric, numeric, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.inventory_movement_summary(date, date, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.inventory_movement_summary(date, date, uuid) TO authenticated;

-- Verify ------------------------------------------------------------------------------------------------------
-- (a) switch is OFF and counting starts 2026-10-02
SELECT enabled, start_date FROM public.inventory_outbound_settings;

-- (b) three new triggers
SELECT c.relname AS on_table, t.tgname
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE t.tgname IN ('inv_outbound_on_collection', 'inv_outbound_on_invoice_paid', 'inv_outbound_on_order_delivered')
ORDER BY 1;

-- (c) increment_inventory: anon must be false now (it was true before), logged-in users true
SELECT has_function_privilege('anon',          'public.increment_inventory(uuid,uuid,numeric,numeric,numeric,uuid)', 'EXECUTE') AS anon_can_run,
       has_function_privilege('authenticated', 'public.increment_inventory(uuid,uuid,numeric,numeric,numeric,uuid)', 'EXECUTE') AS logged_in_can_run;

-- (d) the backfilled QC receipts should add up to the stock now on hand (both numbers equal)
SELECT (SELECT round(sum(quantity)::numeric, 3) FROM public.inventory)                              AS stock_now_kg,
       (SELECT round(sum(qty_delta)::numeric, 3) FROM public.inventory_log WHERE ref_type = 'qc_inspection') AS ledger_qc_kg;
