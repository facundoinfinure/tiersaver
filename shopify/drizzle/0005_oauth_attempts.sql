-- One row per Klaviyo authorization that reached the embedded "finish" step.
-- Shopify's admin loads that step more than once and cancels the first load;
-- the authorization code can be exchanged only once. The row makes the step
-- idempotent: the first request exchanges, later ones read its result.
-- Holds no code, token or state: only the SHA-256 of the state.
CREATE TABLE `klaviyo_oauth_attempts` (
  `state_hash` text PRIMARY KEY NOT NULL,
  `shop` text NOT NULL REFERENCES `shops`(`shop`) ON DELETE CASCADE,
  `status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'connected', 'failed')),
  `error_code` text,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
