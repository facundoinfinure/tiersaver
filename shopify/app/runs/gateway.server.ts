import { NonRetryableError } from "cloudflare:workflows";
import type { SuppressionGateway } from "./engine";

/**
 * Gateway used by deployed runs.
 *
 * The Klaviyo client arrives in Phase 3 (OAuth connection, resolving profile
 * ids to emails, bulk suppress / unsuppress jobs). Until then this gateway
 * refuses every batch with a non-retryable error, so a run that somehow starts
 * ends as "failed" with every profile untouched.
 */
export function createSuppressionGateway(_env: Env, _shop: string): SuppressionGateway {
  return {
    async submitBatch() {
      throw new NonRetryableError("klaviyo_gateway_not_implemented");
    },
  };
}
