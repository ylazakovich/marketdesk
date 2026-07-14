-- Retain the newest connected account (or newest account when none are connected)
-- before enforcing one credential-bearing account per marketplace.
WITH ranked_accounts AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY marketplace_id
           ORDER BY (status = 'connected') DESC, updated_at DESC, created_at DESC, id
         ) AS row_number
  FROM marketplace_accounts
)
DELETE FROM marketplace_accounts AS account
USING ranked_accounts AS ranked
WHERE account.id = ranked.id
  AND ranked.row_number > 1;
