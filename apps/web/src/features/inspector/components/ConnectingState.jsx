import { c } from '../lib/tokens.js'

export default function ConnectingState() {
  return (
    <div style={d_emptyStyle}>
      <div style={content}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: c.accent, animation: 'sbpulse 2s ease infinite' }} />
          <span style={{ fontFamily: c.mono, fontSize: '11px', color: c.faint, letterSpacing: '0.2em', textTransform: 'uppercase' }}>connecting…</span>
        </div>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <Sk h={18} w="40%" />
          <Sk h={12} w="75%" />
          <Sk h={12} w="60%" />
          <Sk h={12} w="68%" />
          <Sk h={12} w="52%" />
        </div>
      </div>
    </div>
  )
}

function Sk({ w = '100%', h = 12, style = {} }) {
  return <span className="wg-skel" style={{ display: 'inline-block', width: w, height: h, background: c.ctr, borderRadius: '4px', ...style }} />
}

const d_emptyStyle = { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '40px' }
const content = { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '18px', maxWidth: '480px', width: '100%' }
