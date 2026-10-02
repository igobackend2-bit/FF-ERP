-- Deactivate seed/test customer records cluttering the customer picker on
-- Party Statements, General Ledger, and Journal Entry pages.
--
-- Root cause: two seed batches (2026-07-24 "Test Customer *" and 2026-07-29
-- "Test Flow *") created 12 fake customers with placeholder phone numbers
-- 9000000001-9000000006 and 9000000011-9000000016, all with hub_id = NULL.
-- searchParties() in src/hooks/useAccounts.ts never filtered customers by
-- is_active (unlike the vendor branch right below it, which already did),
-- so these test rows showed up in every customer search regardless of
-- status. Fixed in the same commit as this file.
--
-- Deactivated, not deleted: some of these test customers have real ledger
-- postings against them (e.g. CN-TEST-0001/0002 credit notes), and this
-- repo's rule is to never hard-delete business rows with transactional
-- history — is_active = false removes them from pickers while preserving
-- the audit trail.
--
-- STATUS: already applied directly via Supabase MCP on 2026-10-02 (verified
-- via a RETURNING clause, 12/12 rows updated). This file is committed so
-- the fix is documented and reproducible; running it again is a no-op.

update customers
set is_active = false
where phone in (
  '9000000001','9000000002','9000000003','9000000004','9000000005','9000000006',
  '9000000011','9000000012','9000000013','9000000014','9000000015','9000000016'
);

-- Verify: should return 0 rows.
select id, name, phone, is_active
from customers
where phone like '9000000%' and is_active = true;
