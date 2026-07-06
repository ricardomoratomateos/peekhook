/**
 * Stripe payment_intent.succeeded — realistic shape, not an exact replica.
 *
 * Mirrors the parts of the Stripe envelope the Inspector demo uses to teach
 * schema-history: the outer `id` + `type` envelope plus a nested
 * `data.object` payload with the canonical amount/currency/status fields
 * and a couple of representative metadata fields. The full Stripe spec has
 * dozens more — this stays small on purpose so the demo payload fits in the
 * UI without scrolling.
 */
export default {
  id:       'stripe.payment_intent.succeeded',
  name:     'Stripe — payment_intent.succeeded',
  provider: 'stripe',
  label:    'Stripe · payment succeeded',
  headers:  { 'content-type': 'application/json' },
  body: JSON.stringify({
    id:      'evt_demo_payment_intent_succeeded',
    object:  'event',
    type:    'payment_intent.succeeded',
    created: 1730000000,
    livemode: false,
    data: {
      object: {
        id:                       'pi_demo_3MtwQvL8Kb9XmZ',
        object:                   'payment_intent',
        amount:                   4200,
        amount_received:          4200,
        currency:                 'usd',
        status:                   'succeeded',
        payment_method:           'pm_demo_card_visa',
        customer:                 'cus_demo_a1b2c3',
        description:              'Order #1042 — Pro plan (annual)',
        metadata:                 { order_id: '1042', plan: 'pro-annual' },
        created:                  1730000000,
        latest_charge:            'ch_demo_charge_xyz',
        receipt_email:            null,
        shipping:                 null,
        automatic_payment_methods: { enabled: true },
      },
    },
    request: { id: null, idempotency_key: null },
  }),
}
