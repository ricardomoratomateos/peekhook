import { c } from '../lib/tokens.js'

export default function Meta({ label, value, style }) {
  return (
    <span style={{ ...metaItem, ...style }}>
      <span style={metaLabel}>{label}</span>
      <span style={metaVal}>{value}</span>
    </span>
  )
}

const metaItem  = { display: 'flex', flexDirection: 'column', gap: '3px', padding: '10px 18px', borderRight: `1px solid ${c.borderSoft}` }
const metaLabel = { fontFamily: c.mono, fontSize: '10px', color: c.faint, letterSpacing: '0.18em', textTransform: 'uppercase' }
const metaVal   = { fontSize: '12px', color: c.dim, fontFamily: c.mono }
