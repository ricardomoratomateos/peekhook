import { c } from '../lib/tokens.js'

export default function NotifyPermissionBanner({ permission, onEnable, supported }) {
  if (!supported) return null
  if (permission === 'granted') return null
  if (permission === 'denied') {
    return (
      <div style={banner} className="sb-notify">
        <span style={materialIcon}>notifications_off</span>
        <span style={msg}>browser notifications blocked. enable them in your browser's site settings to get pinged on new captures.</span>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onEnable}
      className="sb-notify"
      style={bannerBtn}
    >
      <span style={materialIcon}>notifications_active</span>
      <span style={msg}>enable browser notifications — get pinged on new captures when this tab is in the background.</span>
    </button>
  )
}

const banner = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  margin: '0 12px 12px',
  padding: '8px 10px',
  border: '1px dashed rgba(64,64,64,0.4)',
  borderRadius: '6px',
  fontFamily: 'inherit',
  fontSize: '11px',
  color: 'rgba(131,131,131,0.9)',
  lineHeight: 1.4,
}

const bannerBtn = {
  ...banner,
  cursor: 'pointer',
  background: 'transparent',
  textAlign: 'left',
}

const materialIcon = {
  fontFamily: "'Material Symbols Outlined'",
  fontSize: '14px',
  flexShrink: 0,
}

const msg = { flex: 1 }
