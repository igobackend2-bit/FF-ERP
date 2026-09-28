-- ADD_SALARY_BATCH_EMPLOYEE_UTR.sql — Run on: qwiumswrbddwmlraktvy → Supabase SQL Editor.
-- Purpose: Accounts Salary Batch page's "Bulk file" upload lets Accounts upload the bank's
-- returned salary payment statement to auto-match UTRs against employees, the same way
-- ExecutionDeskPage already does for vendor payments (see ADD_VENDOR_... history) — but
-- salary_batch_employees had nowhere to store a matched UTR. Additive, idempotent.

ALTER TABLE public.salary_batch_employees
  ADD COLUMN IF NOT EXISTS utr_number text;

-- Verify
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'salary_batch_employees' AND column_name = 'utr_number';
