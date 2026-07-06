/**
 * GitHub push event — X-GitHub-Event header is the canonical signal, plus a
 * representative ref/commits/repository envelope. We carry two commits to
 * make the schema-history demo show a non-trivial field mix (paths on the
 * commit object, varied author/msg shapes) without bloating the payload.
 */
export default {
  id:       'github.push',
  name:     'GitHub — push',
  provider: 'github',
  label:    'GitHub · push',
  headers: {
    'content-type':    'application/json',
    'x-github-event':  'push',
    'x-github-delivery': 'demo-72f0a8e0-1c0a-4f8a-9e2a-abcdef012345',
    'user-agent':      'GitHub-Hookshot/demo',
  },
  body: JSON.stringify({
    ref:          'refs/heads/main',
    before:       'a1b2c3d4e5f607182930a1b2c3d4e5f607182930',
    after:        'f1e2d3c4b5a607182930f1e2d3c4b5a607182930',
    created:      false,
    deleted:      false,
    forced:       false,
    base_ref:     null,
    compare:      'https://github.com/acme/webhookguard-demo/compare/a1b2c3d...f1e2d3c',
    repository: {
      id:       7654321,
      name:     'webhookguard-demo',
      full_name:'acme/webhookguard-demo',
      private:  false,
      default_branch: 'main',
      html_url: 'https://github.com/acme/webhookguard-demo',
    },
    pusher: { name: 'ricardo', email: 'ricardo@acme.example' },
    sender: { login: 'ricardo', id: 12345, type: 'User' },
    commits: [
      {
        id:        'f1e2d3c4b5a607182930f1e2d3c4b5a607182930',
        tree_id:   '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b',
        message:   'feat(fixtures): add Stripe payment_intent.succeeded sample',
        timestamp: '2026-07-05T18:43:12Z',
        author:    { name: 'Ricardo', email: 'ricardo@acme.example', username: 'ricardo' },
        url:       'https://github.com/acme/webhookguard-demo/commit/f1e2d3c4',
      },
      {
        id:        'e2d3c4b5a607182930f1e2d3c4b5a607182930f1',
        tree_id:   '8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9a',
        message:   'docs: note stripe-payment-intent-succeeded in README fixtures section',
        timestamp: '2026-07-05T18:45:01Z',
        author:    { name: 'Ricardo', email: 'ricardo@acme.example', username: 'ricardo' },
        url:       'https://github.com/acme/webhookguard-demo/commit/e2d3c4b5',
      },
    ],
    head_commit: {
      id:      'f1e2d3c4b5a607182930f1e2d3c4b5a607182930',
      message: 'feat(fixtures): add Stripe payment_intent.succeeded sample',
      url:     'https://github.com/acme/webhookguard-demo/commit/f1e2d3c4',
    },
  }),
}
