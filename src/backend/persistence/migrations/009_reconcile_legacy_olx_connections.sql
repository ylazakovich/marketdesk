-- Reconcile legacy OLX rows that were marked connected by the pre-OAuth
-- implementation. Preserve any marketplace backed by a real connected account.
UPDATE marketplaces AS marketplace
SET connected = FALSE
WHERE marketplace.key = 'olx'
  AND marketplace.connected = TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM marketplace_accounts AS account
    WHERE account.marketplace_id = marketplace.id
      AND account.status = 'connected'
  );
