/**
 * Turns a dataset into the exact list of Klaviyo requests (payloads included),
 * batched under the verified limits. Pure: used by --dry-run and by the runner.
 */
import { chunk } from "@tiersaver/core";
import { RULE_MODES, type RuleMode } from "./cohorts.js";
import { ENDPOINTS, LIMITS, MACHINE_OPEN_PROPERTY, METRICS, SEED_PROPERTIES, type EndpointName, type MetricKey } from "./klaviyo-config.js";
import { countByCohort, countEmailsReceived, formatDecision, type SeedDataset, type SeedProfile } from "./generate.js";

export type StepKind = "import" | "events" | "suppress" | "unsuppress" | "subscribe_sms";

export interface PlanStep {
  /** Stable across runs with the same options; the key of the progress file. */
  id: string;
  kind: StepKind;
  endpoint: EndpointName;
  body: unknown;
  /** Profiles, events or emails carried by this request. */
  items: number;
  bytes: number;
  /** The response carries a job id that must be polled until it completes. */
  polled: boolean;
}

export interface PlanOptions {
  /** Existing Klaviyo list to add the "protected_group" cohort to. */
  protectedListId?: string;
  skipSms?: boolean;
}

export interface Plan {
  steps: PlanStep[];
  totals: { profiles: number; events: number; suppressed: number; restored: number; sms: number };
  /** Events per Klaviyo metric name, in the order of METRICS. */
  eventsByMetric: { metric: MetricKey; name: string; count: number }[];
  cohorts: { id: string; count: number; expected: Record<RuleMode, string> }[];
  /** Profiles per decision kind in each rule mode, at the dataset's `now` with full coverage. */
  expectedTotals: Record<RuleMode, { candidate: number; protected: number; skipped: number }>;
  /** POSTs plus the one account check; job polling comes on top. */
  submitRequests: number;
  polledJobs: number;
  /** Rough guess. Klaviyo does not document job processing times. */
  estimatedSeconds: number;
  notes: string[];
}

const bytesOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

/**
 * Greedy batching under an item-count limit and a byte budget.
 * `weight` lets one entry count as several items (a profile with N events).
 */
export function packBatches<T>(
  entries: readonly T[],
  limits: { maxItems: number; maxBytes: number; weight?: (entry: T) => number },
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let items = 0;
  let bytes = 0;
  for (const entry of entries) {
    const weight = limits.weight ? limits.weight(entry) : 1;
    const size = bytesOf(entry) + 1;
    if (weight > limits.maxItems || size > limits.maxBytes) throw new RangeError("a single entry exceeds the request limits");
    if (current.length > 0 && (items + weight > limits.maxItems || bytes + size > limits.maxBytes)) {
      batches.push(current);
      current = [];
      items = 0;
      bytes = 0;
    }
    current.push(entry);
    items += weight;
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function profileResource(profile: SeedProfile, dataset: SeedDataset) {
  return {
    type: "profile",
    attributes: {
      email: profile.email,
      first_name: profile.firstName,
      last_name: profile.lastName,
      properties: {
        [SEED_PROPERTIES.run]: dataset.runTag,
        [SEED_PROPERTIES.cohort]: profile.cohort,
        [SEED_PROPERTIES.index]: profile.index,
        [SEED_PROPERTIES.now]: dataset.now.toISOString(),
        [SEED_PROPERTIES.createdAt]: profile.createdAt.toISOString(),
        [SEED_PROPERTIES.expected]: formatDecision(profile.expected.default),
        [SEED_PROPERTIES.expectedWide]: formatDecision(profile.expected.wide),
        [SEED_PROPERTIES.emailsReceived]: countEmailsReceived(profile, dataset.now),
      },
    },
  };
}

function importBody(profiles: unknown[], listId?: string) {
  return {
    data: {
      type: "profile-bulk-import-job",
      attributes: { profiles: { data: profiles } },
      ...(listId ? { relationships: { lists: { data: [{ type: "list", id: listId }] } } } : {}),
    },
  };
}

function eventEntry(profile: SeedProfile, dataset: SeedDataset) {
  return {
    type: "event-bulk-create",
    attributes: {
      // Recorded and segmentable, but never triggers a flow.
      backfill: true,
      profile: { data: { type: "profile", attributes: { email: profile.email } } },
      events: {
        data: profile.events.map((event) => ({
          type: "event",
          attributes: {
            properties: {
              [SEED_PROPERTIES.run]: dataset.runTag,
              [SEED_PROPERTIES.cohort]: profile.cohort,
              ...(event.metric === "open" ? { [MACHINE_OPEN_PROPERTY]: event.machineOpen === true } : {}),
              ...(event.metric === "purchase" ? { OrderId: event.uniqueId } : {}),
            },
            time: event.time.toISOString(),
            unique_id: event.uniqueId,
            ...(event.value === undefined ? {} : { value: event.value, value_currency: "USD" }),
            metric: { data: { type: "metric", attributes: { name: event.metricName } } },
          },
        })),
      },
    },
  };
}

function suppressionBody(type: "profile-suppression-bulk-create-job" | "profile-suppression-bulk-delete-job", emails: string[]) {
  return {
    data: {
      type,
      attributes: { profiles: { data: emails.map((email) => ({ type: "profile", attributes: { email } })) } },
    },
  };
}

function smsBody(profiles: SeedProfile[], dataset: SeedDataset) {
  return {
    data: {
      type: "profile-subscription-bulk-create-job",
      attributes: {
        // Consent is recorded as already collected: no double opt-in message, no "added to list" flow.
        historical_import: true,
        custom_source: `TierSaver seed ${dataset.runTag}`,
        profiles: {
          data: profiles.map((p) => ({
            type: "profile",
            attributes: {
              email: p.email,
              phone_number: p.phoneNumber,
              subscriptions: { sms: { marketing: { consent: "SUBSCRIBED", consented_at: p.createdAt.toISOString() } } },
            },
          })),
        },
      },
    },
  };
}

export function buildPlan(dataset: SeedDataset, options: PlanOptions = {}): Plan {
  const steps: PlanStep[] = [];
  const notes: string[] = [
    "Klaviyo sets every profile's `created` to the import time and it cannot be backdated. Read against that date, every seeded " +
      "profile is `new_profile` for 365 days under the default rules (180 in the wider mode). " +
      `Integration tests must take the profile age from the ${SEED_PROPERTIES.createdAt} property.`,
  ];
  const add = (kind: StepKind, endpoint: EndpointName, n: number, body: unknown, items: number, polled: boolean) => {
    const bytes = bytesOf(body);
    if (bytes > LIMITS.maxPayloadBytes) throw new RangeError(`step ${kind}:${n} is larger than Klaviyo's 5 MB payload limit`);
    steps.push({ id: `${kind}:${n}`, kind, endpoint, body, items, bytes, polled });
  };

  // 1. Profiles. With a protected list, that cohort goes in its own job so only it joins the list.
  const inList = options.protectedListId ? dataset.profiles.filter((p) => p.protectedGroup) : [];
  const rest = options.protectedListId ? dataset.profiles.filter((p) => !p.protectedGroup) : dataset.profiles;
  const importLimits = { maxItems: LIMITS.profilesPerImportJob, maxBytes: LIMITS.payloadBudgetBytes };
  let importIndex = 0;
  for (const [group, listId] of [[rest, undefined], [inList, options.protectedListId]] as const) {
    for (const batch of packBatches(group.map((p) => profileResource(p, dataset)), importLimits)) {
      add("import", "profileImport", importIndex, importBody(batch, listId), batch.length, true);
      importIndex += 1;
    }
  }
  if (!options.protectedListId) {
    notes.push(
      'No --protected-list-id: the "protected_group" cohort is not added to any list. ' +
        `Protect it with a segment on the profile property ${SEED_PROPERTIES.cohort} = "protected_group".`,
    );
  }

  // 2. Events, after the profiles exist. One entry per profile; a profile's events are never split.
  const entries = dataset.profiles.filter((p) => p.events.length > 0).map((p) => eventEntry(p, dataset));
  const eventBatches = packBatches(entries, {
    maxItems: LIMITS.eventsPerBulkRequest,
    maxBytes: LIMITS.payloadBudgetBytes,
    weight: (entry) => entry.attributes.events.data.length,
  });
  eventBatches.forEach((batch, n) => {
    const body = { data: { type: "event-bulk-create-job", attributes: { "events-bulk-create": { data: batch } } } };
    add("events", "eventBulkCreate", n, body, batch.reduce((sum, e) => sum + e.attributes.events.data.length, 0), false);
  });

  // 3. Suppress the "already_suppressed" and "restored" cohorts, then 4. unsuppress the latter.
  const restored = dataset.profiles.filter((p) => p.restored).map((p) => p.email);
  const suppressed = dataset.profiles.filter((p) => p.suppressed).map((p) => p.email);
  chunk([...suppressed, ...restored], LIMITS.emailsPerSuppressionRequest).forEach((emails, n) => {
    add("suppress", "suppress", n, suppressionBody("profile-suppression-bulk-create-job", emails), emails.length, true);
  });
  chunk(restored, LIMITS.emailsPerSuppressionRequest).forEach((emails, n) => {
    add("unsuppress", "unsuppress", n, suppressionBody("profile-suppression-bulk-delete-job", emails), emails.length, true);
  });

  // 5. SMS consent last: it is the step most likely to be rejected (needs SMS set up in the account).
  const sms = dataset.profiles.filter((p) => p.smsConsent);
  if (options.skipSms) {
    notes.push('--skip-sms: the "sms_consented" cohort will NOT have SMS consent and will evaluate as a candidate in both modes.');
  } else {
    chunk(sms, LIMITS.profilesPerSubscribeRequest).forEach((batch, n) => {
      add("subscribe_sms", "subscribe", n, smsBody(batch, dataset), batch.length, false);
    });
  }

  const polledJobs = steps.filter((s) => s.polled).length;
  const imports = steps.filter((s) => s.kind === "import").length;
  const cohortCounts = countByCohort(dataset);
  const expectedByCohort = new Map<string, Record<RuleMode, string>>();
  const expectedTotals = { default: { candidate: 0, protected: 0, skipped: 0 }, wide: { candidate: 0, protected: 0, skipped: 0 } };
  const metricCounts = new Map<MetricKey, number>();
  for (const p of dataset.profiles) {
    if (!expectedByCohort.has(p.cohort)) {
      expectedByCohort.set(p.cohort, { default: formatDecision(p.expected.default), wide: formatDecision(p.expected.wide) });
    }
    for (const mode of RULE_MODES) expectedTotals[mode][p.expected[mode].kind] += 1;
    for (const e of p.events) metricCounts.set(e.metric, (metricCounts.get(e.metric) ?? 0) + 1);
  }
  return {
    steps,
    totals: {
      profiles: dataset.profiles.length,
      events: dataset.profiles.reduce((sum, p) => sum + p.events.length, 0),
      suppressed: suppressed.length,
      restored: restored.length,
      sms: sms.length,
    },
    eventsByMetric: (Object.keys(METRICS) as MetricKey[]).map((metric) => ({ metric, name: METRICS[metric], count: metricCounts.get(metric) ?? 0 })),
    cohorts: [...cohortCounts].map(([id, count]) => ({ id, count, expected: expectedByCohort.get(id) as Record<RuleMode, string> })),
    expectedTotals,
    submitRequests: steps.length + 1,
    polledJobs,
    // ~2 s per request, ~90 s per import job, ~20 s per suppression job. Guesses, not documented figures.
    estimatedSeconds: (steps.length + 1) * 2 + imports * 90 + (polledJobs - imports) * 20,
    notes,
  };
}

export function formatPlan(dataset: SeedDataset, plan: Plan): string {
  const lines: string[] = [];
  lines.push(`Run tag        ${dataset.runTag}`);
  lines.push(`Seed           ${dataset.seed}`);
  lines.push(`Now            ${dataset.now.toISOString()}`);
  lines.push(`Email pattern  ${dataset.runTag}-<nnnnn>@${dataset.emailDomain}`);
  lines.push(`Profiles       ${plan.totals.profiles}`);
  lines.push(`Events         ${plan.totals.events}`);
  for (const m of plan.eventsByMetric) lines.push(`  ${m.name.padEnd(18)} ${String(m.count).padStart(6)}`);
  lines.push("  (all in metrics owned by the API integration, not Klaviyo's built-in ones)");
  lines.push("");
  lines.push("Cohorts (expected decision under the default rules; under the wider mode at its floors when different)");
  for (const cohort of plan.cohorts) {
    const wide = cohort.expected.wide === cohort.expected.default ? "" : `  | wide: ${cohort.expected.wide}`;
    lines.push(`  ${cohort.id.padEnd(40)} ${String(cohort.count).padStart(5)}  ${cohort.expected.default}${wide}`);
  }
  lines.push("");
  lines.push("Expected totals, evaluated at Now with the intended creation dates (ts_seed_created_at)");
  for (const mode of RULE_MODES) {
    const t = plan.expectedTotals[mode];
    lines.push(`  ${mode.padEnd(8)} ${String(t.candidate).padStart(5)} candidates  ${String(t.protected).padStart(5)} protected  ${String(t.skipped).padStart(5)} skipped`);
  }
  lines.push("");
  lines.push("Requests");
  lines.push(`  GET  ${ENDPOINTS.accounts.path.padEnd(46)} 1  (account check)`);
  const byKind = new Map<StepKind, PlanStep[]>();
  for (const step of plan.steps) byKind.set(step.kind, [...(byKind.get(step.kind) ?? []), step]);
  for (const [kind, steps] of byKind) {
    const first = steps[0] as PlanStep;
    const items = steps.reduce((sum, s) => sum + s.items, 0);
    const largest = Math.max(...steps.map((s) => s.bytes));
    lines.push(
      `  POST ${ENDPOINTS[first.endpoint].path.padEnd(46)} ${steps.length}  (${kind}: ${items} items, largest ${(largest / 1024).toFixed(0)} KB${first.polled ? ", polled" : ""})`,
    );
  }
  lines.push(`  Total: ${plan.submitRequests} requests + polling of ${plan.polledJobs} jobs`);
  lines.push(`  Estimated duration: about ${Math.ceil(plan.estimatedSeconds / 60)} min (estimate; job processing time is not documented)`);
  for (const note of plan.notes) lines.push("", `Note: ${note}`);
  return lines.join("\n");
}
