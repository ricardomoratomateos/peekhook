import { ReplayOutcome } from '../domain/ReplayOutcome.js'
import { ReplayTarget }  from '../domain/ReplayTarget.js'

const MUTATION_BODY_MAX_BYTES = 1_048_576  // 1 MB, mirrors the capture body cap
const MUTATION_PATH_MAX       = 2048
const MUTATION_METHOD_MAX     = 10

/**
 * ReplayEvent — re-run a previously captured event, either against the
 * inbox's OWN mock reply (`mode: 'mock'`, the default) or against the
 * inbox's already-configured forward target (`mode: 'forward'`).
 *
 * The use case never persists a new capture. In mock mode it reads the
 * inbox + event + responseConfig and produces a ReplayTarget describing
 * what the in-process reply would emit. In forward mode it re-sends the
 * (optionally mutated) captured request to `inbox.forwardTo` through the
 * injected `forward` port and returns the upstream response.
 *
 * Why forward-mode replay is safe without inbox claim: the old MVP gate
 * rejected any non-mock replay because forwarding an inbound payload to
 * an *arbitrary* URL from an anonymous sandbox is an SSRF / open-relay
 * risk. Forward-mode replay does NOT take a URL from the caller — it
 * reuses `inbox.forwardTo`, which was validated (`validateForwardUrl`)
 * and loop-checked at config time and already receives this inbox's
 * live traffic. Replaying to it carries no exposure the live forward
 * doesn't already have. If no forward target is configured, the request
 * is rejected with INVALID.
 *
 * Mutations (`mutations: { method?, path?, headers?, body? }`) are
 * applied on top of the captured request before the mock script runs or
 * the forward fires — this is the "edit and re-send" loop: tweak the
 * amount, drop a field, flip the method, replay. Absent / empty
 * mutations replay the capture verbatim.
 *
 *   - Rate limit (token bucket per inbox) gates repeat replays.
 *     Denied attempts return RATE_LIMITED with `retryAfterSec`.
 *
 * Scripting (mock mode): when `responseConfig.scriptEnabled` is true and
 * the script source is present, the use case delegates to a
 * `scriptRunner` port over the mutated request. THREW/TIMEOUT outcomes
 * fall back to the static responseConfig body — same recovery the ingest
 * route uses — so a buggy stored script can never wedge a replay.
 *
 * @param {{
 *   inboxes:     import('../../../domain/InboxRepository.js').InboxRepository,
 *   requests:    import('../../../domain/RequestListReadModel.js').RequestListReadModel,
 *   rateLimiter: import('../domain/ReplayRateLimiter.js').ReplayRateLimiter,
 *   runScript?:  { execute(cmd: { script: string, request: object, timeoutMs?: number }): Promise<{ outcome: string, body?: string, error?: string }> },
 *   forward?:    (req: { targetUrl: string, method: string, headers: object, body: string }) => Promise<object>,
 *   now?:        () => Date,
 * }} deps
 */
export class ReplayEvent {
  constructor({ inboxes, requests, rateLimiter, runScript, forward, now }) {
    this.inboxes     = inboxes
    this.requests    = requests
    this.rateLimiter = rateLimiter
    this.runScript   = runScript ?? null
    this.forward     = forward ?? null
    this.now         = now ?? (() => new Date())
  }

  /**
   * @param {{
   *   inboxToken: string,
   *   eventId: string,
   *   mode?: 'mock' | 'forward',
   *   mockOnly?: boolean,
   *   mutations?: { method?: string, path?: string, headers?: object, body?: string } | null,
   * }} cmd
   * @returns {Promise<
   *   | { outcome: 'replayed', target: ReplayTarget, replayedAt: Date }
   *   | { outcome: 'not_found' }
   *   | { outcome: 'invalid', error: string }
   *   | { outcome: 'rate_limited', retryAfterSec: number }
   * >}
   */
  async execute({ inboxToken, eventId, mode, mockOnly, mutations }) {
    if (typeof inboxToken !== 'string' || inboxToken.length === 0) {
      return { outcome: ReplayOutcome.INVALID, error: 'inboxToken required' }
    }
    if (typeof eventId !== 'string' || eventId.length === 0) {
      return { outcome: ReplayOutcome.INVALID, error: 'eventId required' }
    }

    // Resolve the mode. Absent mode (or the legacy `mockOnly: true`)
    // means mock; only an explicit `mode: 'forward'` selects forward.
    const resolvedMode = mode === 'forward' ? 'forward' : 'mock'

    let cleanMutations
    try {
      cleanMutations = validateMutations(mutations)
    } catch (err) {
      return { outcome: ReplayOutcome.INVALID, error: err.message }
    }

    // Resolve the inbox + event and validate the requested mode BEFORE
    // consuming a rate-limit token — a not-found, misconfigured, or
    // otherwise-rejected replay must not burn the 1/min budget.
    const inbox = await this.inboxes.findByToken(inboxToken)
    if (!inbox) return { outcome: ReplayOutcome.NOT_FOUND }

    const captured = await this.requests.findById({ inboxToken, id: eventId })
    if (!captured) return { outcome: ReplayOutcome.NOT_FOUND }

    if (resolvedMode === 'forward') {
      if (!inbox.forwardTo) {
        return {
          outcome: ReplayOutcome.INVALID,
          error:   'no forward target configured: set a forward URL on this inbox before replaying to it',
        }
      }
      if (!this.forward) {
        return { outcome: ReplayOutcome.INVALID, error: 'forward replay is not available' }
      }
    }

    const limit = await this.rateLimiter.tryConsume({ inboxToken })
    if (!limit || !limit.allowed) {
      return {
        outcome:       ReplayOutcome.RATE_LIMITED,
        retryAfterSec: limit?.retryAfterSec ?? 60,
      }
    }

    const effective = applyMutations(captured, cleanMutations)

    if (resolvedMode === 'forward') {
      const fwd = await this.forward({
        targetUrl: inbox.forwardTo,
        method:    effective.method,
        headers:   effective.headers,
        body:      effective.body,
      })
      return {
        outcome:    ReplayOutcome.REPLAYED,
        target:     ReplayTarget.fromForward(fwd),
        replayedAt: this.now(),
      }
    }

    const target = await this.#resolveTarget(inbox.responseConfig, effective)
    return {
      outcome:    ReplayOutcome.REPLAYED,
      target,
      replayedAt: this.now(),
    }
  }

  /**
   * @returns {Promise<ReplayTarget>}
   */
  async #resolveTarget(cfg, request) {
    if (!cfg || cfg.enabled !== true) return ReplayTarget.default()

    const hasScript = cfg.scriptEnabled === true
      && typeof cfg.script === 'string'
      && cfg.script.length > 0

    if (hasScript && this.runScript) {
      const result = await this.runScript.execute({
        script: cfg.script,
        request: {
          method:      request.method,
          path:        request.path,
          headers:     request.headers ?? {},
          body:        request.body ?? '',
          contentType: request.contentType ?? '',
          query:       request.query ?? {},
        },
      })
      if (result && result.outcome === 'ok' && typeof result.body === 'string') {
        return ReplayTarget.scripted(cfg, result.body)
      }
      // THREW / TIMEOUT / INVALID / malformed: fall back to the
      // configured static body, matching the ingest route's
      // recovery semantics.
      return ReplayTarget.fromConfig(cfg)
    }

    return ReplayTarget.fromConfig(cfg)
  }
}

/**
 * Validate and normalise the optional mutation set. Returns null when no
 * mutations are supplied. Throws on a malformed field so the use case
 * can surface an INVALID outcome.
 */
function validateMutations(mutations) {
  if (mutations === null || mutations === undefined) return null
  if (typeof mutations !== 'object' || Array.isArray(mutations)) {
    throw new Error('mutations must be an object')
  }
  const out = {}

  if (mutations.method !== undefined) {
    if (typeof mutations.method !== 'string' || mutations.method.length === 0 || mutations.method.length > MUTATION_METHOD_MAX) {
      throw new Error('mutations.method must be a non-empty string')
    }
    out.method = mutations.method.toUpperCase()
  }
  if (mutations.path !== undefined) {
    if (typeof mutations.path !== 'string' || mutations.path.length > MUTATION_PATH_MAX) {
      throw new Error(`mutations.path must be a string ≤ ${MUTATION_PATH_MAX} chars`)
    }
    out.path = mutations.path
  }
  if (mutations.body !== undefined) {
    if (typeof mutations.body !== 'string') {
      throw new Error('mutations.body must be a string')
    }
    if (Buffer.byteLength(mutations.body, 'utf8') > MUTATION_BODY_MAX_BYTES) {
      throw new Error('mutations.body exceeds 1 MB limit')
    }
    out.body = mutations.body
  }
  if (mutations.headers !== undefined) {
    if (typeof mutations.headers !== 'object' || mutations.headers === null || Array.isArray(mutations.headers)) {
      throw new Error('mutations.headers must be an object')
    }
    const headers = {}
    for (const [k, v] of Object.entries(mutations.headers)) {
      if (typeof v === 'string') headers[k] = v
      else if (Array.isArray(v)) headers[k] = v.join(', ')
      else if (v != null) headers[k] = String(v)
    }
    out.headers = headers
  }

  return Object.keys(out).length > 0 ? out : null
}

/**
 * Overlay the mutation set on the captured request, producing the
 * effective request the replay acts on. Mutated `headers` are merged
 * onto the captured headers (per-key override), not replaced wholesale,
 * so a caller can tweak one header without re-sending them all.
 */
function applyMutations(captured, mutations) {
  const base = {
    method:      captured.method,
    path:        captured.path,
    query:       captured.query ?? {},
    headers:     captured.headers ?? {},
    body:        captured.body ?? '',
    contentType: captured.contentType ?? '',
  }
  if (!mutations) return base
  return {
    ...base,
    ...(mutations.method !== undefined ? { method: mutations.method } : {}),
    ...(mutations.path   !== undefined ? { path:   mutations.path }   : {}),
    ...(mutations.body   !== undefined ? { body:   mutations.body }   : {}),
    ...(mutations.headers !== undefined ? { headers: { ...base.headers, ...mutations.headers } } : {}),
  }
}
