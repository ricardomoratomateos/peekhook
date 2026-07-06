/**
 * Pure anti-loop rule for `forwardTo` URLs.
 *
 * A forward target creates a loop iff its origin matches the configured
 * public ingest origin AND its pathname targets the webhook ingest
 * (`/i/...`). The path-based half of the rule exists because:
 *
 *   - the only surface that recurses is the ingest endpoint itself.
 *     Other app routes are idempotent reads (GET /api/...) or config
 *     writes, none of which re-enter the forward chain.
 *   - a misconfigured inbox pointing to, say, `/api/inboxes/...` does
 *     not loop; it just hits the API. Blocking it would be a false
 *     positive that punishes legitimate dev workflows.
 *
 * The rule is intentionally side-effect free and synchronous so the
 * same implementation can run in:
 *   - the API at config time  (ConfigureForward use case)
 *   - the API at forward time (ForwardRequest — defense in depth)
 *   - the web inspector       (ForwardConfigPanel — instant feedback)
 *
 * The frontend ships a mirrored copy under
 * `apps/web/src/features/inspector/lib/loopRule.js`. A parity test in
 * `loopRule.parity.spec.js` loads both copies and asserts they produce
 * identical outputs for a fixed table of cases — any drift between
 * the two implementations breaks CI.
 *
 * @param {string|null|undefined} forwardTo    the URL the user wants to forward to
 * @param {string|null|undefined} ingestOrigin  e.g. "https://peekhook.dev"
 * @returns {{ ok: true } | { ok: false, reason: 'loop', message: string }}
 */
export function checkForwardLoop(forwardTo, ingestOrigin) {
  if (!forwardTo || typeof forwardTo !== 'string') return { ok: true }
  if (!ingestOrigin || typeof ingestOrigin !== 'string') return { ok: true }

  let target, ingest
  try { target = new URL(forwardTo) }    catch { return { ok: true } }
  try { ingest = new URL(ingestOrigin) } catch { return { ok: true } }

  if (target.origin !== ingest.origin) return { ok: true }
  if (!target.pathname.startsWith('/i/')) return { ok: true }

  return {
    ok: false,
    reason: 'loop',
    message: `forwardTo would recurse into this ingest origin (${ingestOrigin})`,
  }
}
