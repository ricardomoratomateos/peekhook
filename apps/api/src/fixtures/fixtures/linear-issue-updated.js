/**
 * Linear Issue updated — Linear's webhook envelope. Linear sends the
 * automatically-named `Linear-Webhook/<version>` User-Agent plus an
 * `X-Linear-Signature` (HMAC of the body, real Linear implementations
 * verify this — we omit the signature here; this is a sample, not a real
 * signed request). Envelope shape: `{ action, type, data, createdAt, ... }`.
 */
export default {
  id:       'linear.issue.updated',
  name:     'Linear — issue updated',
  provider: 'linear',
  label:    'Linear · issue updated',
  headers: {
    'content-type':         'application/json',
    'user-agent':           'Linear-Webhook/1.0',
    'x-linear-event':       'Issue',
    'x-linear-delivery':    'demo-linear-delivery-001',
    'x-linear-signature':   'demo-signature-omit-in-fixtures',
  },
  body: JSON.stringify({
    action:     'update',
    type:       'Issue',
    createdAt:  '2026-07-05T19:02:14.000Z',
    organizationId: 'demo-org-id',
    webhookId:  'demo-webhook-id',
    webhookType:'issue',
    data: {
      id:         'demo-issue-7f9c-a1b2',
      identifier: 'ENG-1421',
      title:      'Webhook demo inbox — show off "send a fixture"',
      description:'Add the four seeded fixtures into the Inspector menu so the landing demo has real Stripe / GitHub / Linear shapes without a signup wall.',
      priority:   3,
      priorityLabel: 'Medium',
      state: {
        id:    'state-triage',
        name:  'In Progress',
        type:  'started',
        color: '#f2c94c',
      },
      team: {
        id:   'team-eng',
        key:  'ENG',
        name: 'Engineering',
      },
      assignee: {
        id:    'user-ricardo',
        name:  'Ricardo',
        email: 'ricardo@acme.example',
      },
      labels: ['demo', 'inspector', 'fixtures'],
      url:    'https://linear.app/acme/issue/ENG-1421',
      createdAt: '2026-07-04T09:15:00.000Z',
      updatedAt: '2026-07-05T19:02:14.000Z',
    },
  }),
}
