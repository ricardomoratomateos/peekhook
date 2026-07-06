import { ReplayOutcome } from '../domain/ReplayOutcome.js'
import { ReplayTarget }  from '../domain/ReplayTarget.js'

/**
 * ReplayEvent — replays a previously captured event against the
 * inbox's OWN mock-reply endpoint.
 *
 * The use case does NOT persist a new capture. It reads the inbox
 * + event + responseConfig and produces a ReplayTarget describing
 * what the in-process reply would emit. Future claim-gated external
 * forwarding will reuse the same shape (`ReplayTarget`) so the
 * transport adapter doesn't need to change.
 *
 * MVP scope rules:
 *   - `mockOnly` MUST be true. Forwarding to an external URL would
 *     re-send an inbound payload to the open internet from an
 *     anonymous sandbox; we never expose that path until inbox
 *     claim (auth) lands. A `mockOnly: false` request is rejected
 *     with INVALID before any side effect.
 *   - Rate limit (token bucket per inbox) gates repeat replays.
 *     Denied attempts return RATE_LIMITED with `retryAfterSec`.
 *
 * Scripting: when `responseConfig.scriptEnabled` is true and the
 * script source is present, the use case delegates to a
 * `scriptRunner` port. THREW/TIMEOUT outcomes fall back to the
 * static responseConfig body — same recovery the ingest route
 * uses — so a buggy script on the stored config can never wedge
 * a replay attempt.
 *
 * <TODO gated on inbox-claim ROADMAP item>: when claim lands, add
 * a `forward` branch that POSTs the original capture to an
 * inbox-claimed `targetUrl` with `X-Peek-Replay: 1` injected. The
 * surface for that branch already exists (a `forward_url`-typed
 * ReplayTarget); only the use case wiring is missing.
 *
 * @param {{
 *   inboxes:     import('../../../domain/InboxRepository.js').InboxRepository,
 *   requests:    import('../../../domain/RequestListReadModel.js').RequestListReadModel,
 *   rateLimiter: import('../domain/ReplayRateLimiter.js').ReplayRateLimiter,
 *   runScript?:  { execute(cmd: { script: string, request: object, timeoutMs?: number }): Promise<{ outcome: string, body?: string, error?: string }> },
 *   now?:        () => Date,
 * }} deps
 */
export class ReplayEvent {
  constructor({ inboxes, requests, rateLimiter, runScript, now }) {
    this.inboxes     = inboxes
    this.requests    = requests
    this.rateLimiter = rateLimiter
    this.runScript   = runScript ?? null
    this.now         = now ?? (() => new Date())
  }

  /**
   * @param {{ inboxToken: string, eventId: string, mockOnly: true }} cmd
   * @returns {Promise<
   *   | { outcome: 'replayed', target: ReplayTarget, replayedAt: Date }
   *   | { outcome: 'not_found' }
   *   | { outcome: 'invalid', error: string }
   *   | { outcome: 'rate_limited', retryAfterSec: number }
   * >}
   */
  async execute({ inboxToken, eventId, mockOnly }) {
    if (typeof inboxToken !== 'string' || inboxToken.length === 0) {
      return { outcome: ReplayOutcome.INVALID, error: 'inboxToken required' }
    }
    if (typeof eventId !== 'string' || eventId.length === 0) {
      return { outcome: ReplayOutcome.INVALID, error: 'eventId required' }
    }
    if (mockOnly !== true) {
      return {
        outcome: ReplayOutcome.INVALID,
        error:   'mockOnly must be true: external URL replay is gated on inbox claim',
      }
    }

    const limit = await this.rateLimiter.tryConsume({ inboxToken })
    if (!limit || !limit.allowed) {
      return {
        outcome:       ReplayOutcome.RATE_LIMITED,
        retryAfterSec: limit?.retryAfterSec ?? 60,
      }
    }

    const inbox = await this.inboxes.findByToken(inboxToken)
    if (!inbox) return { outcome: ReplayOutcome.NOT_FOUND }

    const captured = await this.requests.findById({ inboxToken, id: eventId })
    if (!captured) return { outcome: ReplayOutcome.NOT_FOUND }

    const cfg = inbox.responseConfig
    const target = await this.#resolveTarget(cfg, captured)

    return {
      outcome:    ReplayOutcome.REPLAYED,
      target,
      replayedAt: this.now(),
    }
  }

  /**
   * @returns {Promise<ReplayTarget>}
   */
  async #resolveTarget(cfg, captured) {
    if (!cfg || cfg.enabled !== true) return ReplayTarget.default()

    const hasScript = cfg.scriptEnabled === true
      && typeof cfg.script === 'string'
      && cfg.script.length > 0

    if (hasScript && this.runScript) {
      const result = await this.runScript.execute({
        script: cfg.script,
        request: {
          method:      captured.method,
          path:        captured.path,
          headers:     captured.headers ?? {},
          body:        captured.body ?? '',
          contentType: captured.contentType ?? '',
          query:       captured.query ?? {},
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
