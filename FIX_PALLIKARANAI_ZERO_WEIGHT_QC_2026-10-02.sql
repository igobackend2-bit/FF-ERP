-- Repair Pallikaranai Hub QC inspections that were saved with 0 kg (gross typed equal to tare).
--
-- What happened: GRN-2026-0007 (Beans, 16), GRN-2026-0012 (Cabbage, 40) and GRN-2026-0014
-- (Brinjal Vari, 23) were saved on 2026-10-02 between 10:27 and 10:32 IST with gross = tare, so
-- net weight and every grade are 0 and increment_inventory() never ran. Pallikaranai inventory
-- stayed empty. The form now blocks this (net weight must be above 0, PR #61).
--
-- BEFORE RUNNING
--   * The true Gross / Tare / grade weights are not stored anywhere. The numbers below are the
--     weights the hub manager typed, treated as the full net weight (tare 0) and all Grade A.
--     Confirm them with the hub and edit the three VALUES rows if they differ.
--   * Run this ONLY if those three loads have NOT been re-entered on the QC screen, otherwise
--     the stock is added twice.
--
-- WHAT IT DOES, per GRN, in one transaction (any error rolls everything back):
--   1. Sets gross, tare, grade A/B/C/D and acceptance_pct on the existing inspection.
--   2. Adds A+B+C kg to inventory through increment_inventory(), the same function the QC
--      screen calls.
--
-- SAFEGUARDS
--   * Aborts if net weight is not above 0, or graded total differs from net weight by > 0.1 kg.
--   * Only touches an inspection that is still in the broken state (gross = tare, all grades 0)
--     and belongs to Pallikaranai Hub, so running it twice adds nothing the second time.
--   * Grade D is not handled here (it needs a qc_rejections / return record): if any load had
--     rejected weight, re-enter that GRN on the QC screen instead.
--
-- STATUS: NOT YET APPLIED. Run in the Supabase SQL Editor (project qwiumswrbddwmlraktvy), then
-- click "Sync Data" on the Inventory page.

DO $$
DECLARE
  r        record;
  v_hub    uuid;
  v_hub_id uuid;
  v_prod   uuid;
BEGIN
  SELECT id INTO v_hub FROM hubs WHERE name = 'Pallikaranai Hub';
  IF v_hub IS NULL THEN RAISE EXCEPTION 'Pallikaranai Hub not found'; END IF;

  FOR r IN
    SELECT * FROM (VALUES
      -- grn,             gross,        tare,         grade A,      grade B,      grade C,      grade D
      ('GRN-2026-0007', 16::numeric,  0::numeric,   16::numeric,  0::numeric,   0::numeric,   0::numeric),  -- Beans, MS. SKM VEG
      ('GRN-2026-0012', 40::numeric,  0::numeric,   40::numeric,  0::numeric,   0::numeric,   0::numeric),  -- Cabbage, MS. SR E110
      ('GRN-2026-0014', 23::numeric,  0::numeric,   23::numeric,  0::numeric,   0::numeric,   0::numeric)   -- Brinjal Vari, MS. KVP E 88
    ) AS t(grn, gross, tare, a, b, c, d)
  LOOP
    IF r.gross - r.tare <= 0 THEN
      RAISE EXCEPTION '%: net weight must be above 0 (gross %, tare %)', r.grn, r.gross, r.tare;
    END IF;
    IF abs((r.a + r.b + r.c + r.d) - (r.gross - r.tare)) > 0.1 THEN
      RAISE EXCEPTION '%: graded total % must equal net weight %', r.grn, r.a + r.b + r.c + r.d, r.gross - r.tare;
    END IF;
    IF r.d > 0 THEN
      RAISE EXCEPTION '%: Grade D needs a rejection record - re-enter this GRN on the QC screen instead', r.grn;
    END IF;

    UPDATE qc_inspections q
       SET gross_weight_kg = r.gross,
           tare_weight_kg  = r.tare,
           grade_a_kg      = r.a,
           grade_b_kg      = r.b,
           grade_c_kg      = r.c,
           grade_d_kg      = r.d,
           acceptance_pct  = 100
     WHERE q.grn_number = r.grn
       AND q.hub_id = v_hub
       AND q.gross_weight_kg = q.tare_weight_kg
       AND COALESCE(q.grade_a_kg, 0) + COALESCE(q.grade_b_kg, 0)
         + COALESCE(q.grade_c_kg, 0) + COALESCE(q.grade_d_kg, 0) = 0
    RETURNING q.hub_id, q.product_id INTO v_hub_id, v_prod;

    IF FOUND THEN
      PERFORM increment_inventory(v_hub_id, v_prod, r.a, r.b, r.c);
      RAISE NOTICE '% corrected: % kg added to inventory', r.grn, r.a + r.b + r.c;
    ELSE
      RAISE NOTICE '% skipped: not found, or already corrected', r.grn;
    END IF;
  END LOOP;
END $$;

-- Verify: three corrected inspections ...
SELECT q.grn_number, p.name AS product, q.gross_weight_kg, q.tare_weight_kg,
       q.grade_a_kg, q.grade_b_kg, q.grade_c_kg, q.grade_d_kg, q.acceptance_pct
FROM qc_inspections q JOIN products p ON p.id = q.product_id
WHERE q.grn_number IN ('GRN-2026-0007', 'GRN-2026-0012', 'GRN-2026-0014')
ORDER BY q.grn_number;

-- ... and Pallikaranai stock: expect Beans 16, Cabbage 40, Brinjal Vari 23 (with the default numbers).
SELECT i.product_name, i.quantity, i.updated_at
FROM inventory i JOIN hubs h ON h.id = i.hub_id
WHERE h.name = 'Pallikaranai Hub'
ORDER BY i.product_name;
