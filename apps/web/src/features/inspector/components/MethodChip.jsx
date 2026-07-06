import { c } from '../lib/tokens.js'
import { methodTone } from '../lib/format.js'

export default function MethodChip({ method }) {
  const t = methodTone(method)
  return (
    <span style={{
      display: 'inline-block', padding: '2px 6px', borderRadius: '4px',
      border: `1px solid ${c.border}`, color: t.color, fontWeight: t.weight,
      fontSize: '10px', letterSpacing: '0.04em', flexShrink: 0, fontFamily: c.mono,
    }}>
      {(method || '?').toLowerCase()}
    </span>
  )
}
