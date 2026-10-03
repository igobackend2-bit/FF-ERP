# Live schema facts — verified columns per table

How to read this file: **Confirmed** = seen via `information_schema` or a successful live write in a
real session (date given). **Used by code** = the app reads/writes these columns and the page works
in production, so they exist. **Unverified** = appears only in migration files or conflicting code;
run a `CHECK_*.sql` before relying on it. Add to this file whenever you confirm something.

Contents: profiles · hubs · hub_pincodes · customers · products · sales_orders · sales_order_items ·
invoices · purchase_orders · purchase_order_items · po_assignments · purchase_entries ·
purchase_entry_items · vendors · ff_vendor_payments · ff_transport_payments · ff_payment_batches ·
vendor_payments (legacy) · transit_records · qc_inspections · qc_rejections · inventory · boxes ·
shift_sessions · lop_entries · notifications / audit_logs · storage buckets

---

## profiles  (Confirmed 2026-09)
`id` (= auth.uid), `name` (**not** `full_name`), `email`, `role`, `department`, `hub_id`,
`ff_ops_access` bool, `ff_payment_access` bool, `is_active` (nullable — treat NULL as active:
`.or('is_active.is.null,is_active.eq.true')`), `phone`, `employee_id`, `status`, `created_at`.
Role CHECK includes all FF roles + `director`, `auditor`, `vendor`, `rsh` (case-insensitive fix 2026-02).

## hubs  (Confirmed 2026-08-04)
`id`, `code` ('HUB-1'…), `name`, `address` (**not** `location`), `city`, `state`, `manager_name`,
`channels` text[], `status`, `created_at`. 3 rows live.

## hub_pincodes  (Confirmed 2026-07-22, 103 rows)
`id`, `hub_id` → hubs, `pincode` unique, `area_name`, `created_at`. Routing = trigger on
`sales_orders` (exact pincode, then 4-digit prefix fallback, see `FIX_HUB_ID_PINCODE_FALLBACK.sql`).

## customers  (Used by code)
`id`, `customer_type` ('shop'…), `shop_name`, `name`, `first_name`, `last_name`, `owner_name`, `phone`
(unique-ish — quick-add resolves duplicate-phone conflict to the existing row), `mobile`, `area`,
`pincode`, `address`, `credit_limit`, `outstanding_balance`, `gst_number`, `is_active`.

## products  (Used by code)
`id`, `name`, `sku_code`, `unit`, `category`, `is_active`, price fields. Custom items from NewOrder
are inserted here so they become reusable catalogue entries.

## sales_orders  (Confirmed 2026-08-04 / 08-27)
`id`, `order_number`, `customer_id`, `customer_name`, `hub_id`, `hub_name`, `order_date`,
`delivery_date`, `status` (pending/confirmed/processing/delivered/cancelled), `source`
(app/website/manual/bulk_upload), `payment_mode`, `shift`, `delivery_charges`
(`ADD_DELIVERY_CHARGES_TO_SALES_ORDERS.sql`), `discount` (`ADD_DISCOUNT_TO_SALES_ORDERS.sql`),
`total_amount`, **`net_amount` GENERATED ALWAYS — never in an insert**, `notes`, `created_at`.

## sales_order_items  (Used by code)
`id`, `order_id`, `product_id` (nullable for custom/imported), `product_name` (the text imports fill —
always select it, don't rely on the products join), `qty` / `quantity` / `qty_kg` (engine reads
`COALESCE(qty_kg, quantity)`), `unit`, `unit_price`, `discount_pct` (2026-09-15), `total`, `grade`,
`category`, `is_custom`, `notes`.

## invoices  (Confirmed 2026-07-22)
`id`, `invoice_number` (INV-YYYYMMDD-XXXXXX, XXXXXX = first 6 of order UUID), `order_id`,
`customer_id`, `customer_name`, `customer_phone`, `customer_address`, `invoice_date`, `due_date`,
`subtotal`, `discount_amount`, `tax_amount`, `delivery_charges`, `total_amount`, `payment_mode`,
`status` (draft/issued/…), **`payment_status`** ('unpaid'/'paid' — this is the receivables filter,
not `status`), `notes`. Only `invoiceHelper.ts` creates rows.

## purchase_orders  (Confirmed 2026-09-05)
`id`, `po_number`, `hub_id`, `hub_name`, `vendor_id`, `vendor_name`, `eod_date` (**business date**),
`delivery_date` (mirrors eod_date on write), `order_date`, `status` CHECK
(pending/assigned/purchasing/purchased/received/cancelled — `purchase_orders_status_check`),
`items` JSONB, `items_count`, `sub_total`, `total_estimated`, `total_amount`, `payment_terms`,
`notes`, `assigned_executive_id` (nullable; EOD engine leaves NULL), `created_at`.
Read via `purchaseStore.rowToPO()` which maps `date = eod_date ?? delivery_date ?? created_at`.
NOTE: `fetchOpenPOs()`/`fetchPendingApprovalPOs()` filter on `'approved'`/`'pending_approval'`
which the CHECK does not allow — they return nothing live; legacy code, don't extend it.

## purchase_order_items  (Confirmed 2026-07-29)
`id`, `po_id`, `product_id`, `product_name`, `item_name`, `hub_id`, `required_qty`, `ordered_qty`,
`quantity`, `received_qty`, `unit`, `estimated_price`, `unit_price`, `total_price`, `status`
(CHECK — 'ordered'/'partial' were NOT valid; see `CHECK_PURCHASE_ORDER_ITEMS_STATUS_CONSTRAINT.sql`),
dedup constraint on (po_id, product) added by `FIX_EOD_ENGINE_DEDUP_CONSTRAINT.sql`.
RLS gap for `ff_operations_manager` writes fixed by `FIX_PURCHASE_ORDER_ITEMS_RLS_GAP.sql`.

## po_assignments  (Used by code 2026-07-24)
`id`, `po_id`, `hub_id`, `purchase_executive_id`, `status` ('assigned'), `created_at`. Insert fires
the PE notification trigger.

## purchase_entries / purchase_entry_items  (Used by code 2026-07-29)
entries: `id`, `po_id`, `vendor_id`, `purchased_by`, `total_amount`, `receipt_url`, `notes`.
items: `id`, `purchase_entry_id`, `po_item_id` (`ADD_PO_ITEM_ID_TO_PURCHASE_ENTRY_ITEMS.sql`),
`product_name`, `quantity`, `unit`, `unit_price`, `total`, `item_photo_url`, `scale_photo_url`.
Trigger status fix: `FIX_PURCHASE_ENTRY_TRIGGER_STATUS.sql`.

## vendors  (Confirmed 2026-09-02)
`id`, `name`, `email`, `phone`, `gst_number` (**no `gstin`, no `pan`**), `bank_name`,
`bank_account`, `bank_ifsc`, `account_number`, `ifsc_code` (two pairs — write both), `is_active`,
`vendor_type`, `city`, `address`, `created_at`. Many tables FK `vendors.id` with mixed ON DELETE
rules → never automate merges/deletes (`FIX_CLEANUP_DUPLICATE_VENDOR_ROWS.sql` deactivates only).
`vendor_master` is the separate IGO-Chain sourcing table (typed), not the FF one.

## ff_vendor_payments  (Confirmed 2026-09-04)
`id`, `vendor_id` → vendors, `purchase_order_id` → purchase_orders, `hub_id` → hubs, `items` JSONB
(`[{item_name, quantity, unit, unit_price, total}]`; Buy-cart rows use slightly different keys —
FFPaymentApprovals normalises), `gross_amount`, `deduction_amount`, `net_amount` (generated),
`payment_status` CHECK (pending_ff_ops, pending_gm, pending_l1, pending_auditor, pending_ceo,
pending_admin, pending_accounts, approved, paid, rejected), `ff_ops_approved_by/_at`,
`gm_approved_by/_at`, `l1_approved_by/_at`, `auditor_approved_by/_at`, `ceo_approved_by/_at`,
`admin_approved_by/_at`, `admin_remarks`, `accounts_approved_by/_at`, `accounts_remarks`
(last six from `REFINE_PAYMENT_APPROVAL_CHAIN.sql`), `rejection_reason` (**the only rejection
column**), `payment_proof_url`, `payment_proof_urls` text[], `utr_number`, `paid_at`, `paid_by`,
`batch_id` → ff_payment_batches, `created_by`, `created_at`.
RLS: submit via `is_ff_payment_submitter()`, approve via `is_ff_payment_approver()`, creator may
DELETE own row while `pending_ff_ops` (`FIX_ALLOW_SUBMITTER_DELETE_PENDING_PAYMENTS.sql`).

## ff_transport_payments  (Confirmed 2026-09-03)
`id`, `driver_id`, `hub_id`, `trip_date`, `vehicle_number`, `origin`, `destination`, `km_covered`,
`base_amount`, `toll_charges`, `other_charges` (total = sum of three; no `total_amount`),
`bill_url`, `trip_proof_url`, `payment_status` (same CHECK as vendor), same stage columns,
`rejection_reason`, `utr_number`, `paid_at`, `batch_id`, `created_by`, `created_at`.

## ff_payment_batches  (Confirmed 2026-09-04, `ADD_FF_PAYMENT_BATCHES.sql`)
`id`, `batch_ref` unique (FFPAY-yyyyMMdd-HHmmss), `payment_type` (vendor/transport), `status`
(created/verified/processed), `total_amount`, `payment_count`, `kotak_file_generated_at`,
`statement_uploaded_at`, `processed_at`, `processed_by`, `created_by`, `created_at`.
RLS: single policy on `is_ff_payment_approver()`.

## vendor_payments  (legacy IGO purchase table — Confirmed 2026-09-03)
FKs exist ONLY on `hub_id`, `po_id`, `purchase_entry_id`, `vendor_id`. `created_by` has **no FK** →
no `profiles` embed; fetch names separately. No `admin_approved_at` / `director_approved_at`.
Child `payment_deduction_lines(payment_id → vendor_payments.id)` confirmed live.

## transit_records  (Used by code)
`id`, `po_id`, `hub_id`, `vehicle_number`, `vehicle_type`, `driver_name`, `transit_cost`, `notes`,
`status` (scheduled/received/in_progress/in_qc/completed/returned; QC sets `arrived → in_qc`),
`created_by`, `created_at`.

## qc_inspections  (Used by code)
`id`, `grn_number`, `hub_id`, `product_id`, `vendor_id`, `po_item_id`, `transit_record_id`,
`inspector_id`, `gross_weight_kg`, `tare_weight_kg`, `grade_a_kg`, `grade_b_kg`, `grade_c_kg`,
`grade_d_kg`, `overall_grade`, `acceptance_pct`, `rejection_reason`, `defect_notes`,
`inspection_checklist` JSONB, `photo_urls` text[], `review_status` ('submitted'), `status`
(accepted/partial/rejected), `created_at`.

## qc_rejections  (Used by code)
`id`, `qc_inspection_id`, `vendor_id`, `product_id`, `rejected_kg`, `rejection_reason`,
`return_status` ('pending'…), `created_at`.

## inventory  (UNVERIFIED — conflicting code)
The live EOD engine reads `inventory.quantity` (with `hub_id`, `product_id`). Warehouse dashboard
reads `quantity, min_threshold, hubs(...)`; InventoryDashboard reads `current_stock,
min_stock_level, product:products(...), hub:hubs(...)`. At least one of those pairs is wrong live.
Run `CHECK` before touching inventory; prefer the engine's `quantity` until proven otherwise.

## boxes  (Used by code)
`id`, `box_code` (FF-{HUB}-{YYYYMMDD}-{SEQ}), `qr_data`, `product_name`, `product_id`, `hub_id`,
`hub_name`, `weight_kg`, `po_ref`, `description`, `status`, `scanned` bool, `scanned_at`,
`pre_printed`. Created by `POBatchLabels` before PDF (2026-06-16) and by the scanner app.

## shift_sessions  (Confirmed 2026-07-25 via CHECK_SHIFT_SESSIONS_SCHEMA.sql)
`id`, `user_id`, `date`, `login_selfie_url`, `status` ('active'…), `target_hours`, `max_hours`,
`login_time`/`logout_time`, `created_at`. Trigger `FIX_HUB_MANAGER_LATE_LOGIN_TRIGGER.sql` uses
`NEW.user_id, NEW.date, NEW.created_at` (grace 07:15 IST).

## lop_entries  (Confirmed 2026-07-25 via CHECK_LOP_ENTRIES_SCHEMA.sql)
`id`, `employee_id`, `lop_date`, `lop_type` ('0.1_day', '1_day'…), `reason`, `status`
(pending_admin/approved/rejected), `source` ('SYSTEM_LATE_SHIFT_START', 'SYSTEM_NO_SHOW'…),
`evidence_url`, `created_at`.

## notifications / audit_logs  (typed, Used by code)
notifications: `user_id`, `title`, `message`, `type`, `link`, `is_read`, created via
`create_notification()` or direct insert. audit_logs: `action`, `performed_by`,
`performed_by_name`, `performed_by_role`, `record_type`, `record_id`, `before_state`, `after_state`
JSONB, `remarks`. INSERT policy must exist or logging silently disables (Feb 2026 incident).

## Storage buckets  (Used by code)
`payment-proofs` (slip photos, Buy receipts), `qc-photos`, `app-images`, `rental-bills`,
`project-photos`, `voice-comments`. Bucket listing RLS: `FIX_STORAGE_BUCKET_LISTING.sql`.

## Accounts-module findings  (Confirmed 2026-09-24 via Supabase MCP, read-only)
- `sales_orders.net_amount` = `total_amount − discount` (generated). `delivery_charges` is NOT in it;
  `total_amount = subtotal` on 742/768 rows. Status CHECK: pending/confirmed/processing/dispatched/
  delivered/cancelled. `payment_status` CHECK: unpaid/partial/paid/refunded. `amount_paid` exists (all 0).
- `invoices`: live has `hub_id` (always NULL), `amount` (NOT NULL), `issued_at`, `discount`, `tax`,
  `discount_amount` (NOT NULL), `tax_amount` (NOT NULL, all 0). **2–3 invoices per order** (860 duplicate
  rows from backfills) → never sum invoices for revenue; the ledger posts from `sales_orders`.
- `ff_transport_payments.total_amount` **does exist** — GENERATED = base + toll + other (the older
  note above saying "no total_amount" is wrong). Also has `is_bulk`, `purchase_order_ids`, `po_breakdown`.
- `ff_vendor_payments` also has `purchase_entry_id`, `is_bulk`, `purchase_order_ids[]`, `po_breakdown`.
- `cash_collections` live columns: id, amount!, collection_date!, collector_id, customer_id, status!,
  payment_mode, receipt_number, proof_url, notes, verified_by/at, deposited_at, created/updated_at.
  **`CollectionEntryPage.tsx` inserts columns that don't exist** (order_id, collected_amount, collected_by,
  hub_id, shop_name…) → every insert fails; table has 0 rows.
- Empty on 2026-09-24: payments_received, payments_made, credit_notes, vendor_credits, wastage_entries,
  cash_collections, client_collections. A legacy table named `accounts` exists — unrelated to `acct_*`.
- Accounts ledger objects all use the `acct_` prefix (ADD_ACCOUNTS_LEDGER_CORE.sql applied 2026-09-24).

## Stock cost valuation  (Confirmed 2026-10-03 read-only; install = ADD_INVENTORY_COST_2026-10-04.sql)
- `purchase_order_items.unit_price` is the buying rate; **every line has `unit = 'kg'`** (even for items
  stocked in piece/bunch/litre), **no `product_id`** (0 of 78 stocked products link), names are free text
  upper-case ("ONION", "TOMATO NAVEEN") and link to the PO via **`po_id`** (not `purchase_order_id`).
  Typo outliers exist (tomato 450-600/kg) - anchor to 1/4x..4x of `products.price` before using a rate.
- `products.grade_a_price` is a flat 45.00 on every product - never use it for valuation.
- QC vendor equals the PO vendor in only 2 of 97 inspections: match PO lines by product name, not vendor.
- `profiles.role` is plain text with no CHECK constraint; `is_staff()` = any active profile.
- After install: `inventory.avg_cost/cost_source/cost_updated_at`, `inventory_log.unit_cost`,
  `qc_inspections.unit_cost/unit_cost_source`; `inv__move` has an optional 9th arg `p_unit_cost`
  (receipts update the moving average; sales/wastage/adjustments leave it unchanged).
