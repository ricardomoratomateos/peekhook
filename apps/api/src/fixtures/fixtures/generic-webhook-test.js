/**
 * Generic webhook test — the smoke fixture when the user wants a shape
 * with no provider mimicry. Two flat scalar fields plus a small array, so
 * schema-history shows three distinct types in one capture.
 */
export default {
  id:       'generic.webhook_test',
  name:     'Generic — webhook test',
  provider: 'generic',
  label:    'Generic · test',
  headers:  { 'content-type': 'application/json' },
  body: JSON.stringify({
    event:  'test',
    hello:  'world',
    amount: 42,
  }),
}
