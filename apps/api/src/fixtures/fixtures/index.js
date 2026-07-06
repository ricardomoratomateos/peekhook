/**
 * Fixture registry — the single source of truth for which sample webhooks
 * ship with peekhook. MemoryFixtureRepository hydrates these at construction
 * time. Adding a new fixture = drop a new module into this directory and
 * add it to the array below; nothing else changes.
 *
 * Order matters: it determines the order the Inspector UI renders them.
 * Keep provider-grouped (Stripe, GitHub, Linear, then the generic smoke
 * test as the fallback on the right edge of the menu).
 */
import stripePaymentIntentSucceeded from './stripe-payment-intent-succeeded.js'
import githubPush                    from './github-push.js'
import linearIssueUpdated            from './linear-issue-updated.js'
import genericWebhookTest            from './generic-webhook-test.js'

export const SEEDED_FIXTURES = [
  stripePaymentIntentSucceeded,
  githubPush,
  linearIssueUpdated,
  genericWebhookTest,
]

export {
  stripePaymentIntentSucceeded,
  githubPush,
  linearIssueUpdated,
  genericWebhookTest,
}
