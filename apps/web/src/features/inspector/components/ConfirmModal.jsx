import { useEffect } from 'react'
import { md } from '../styles.js'

export default function ConfirmModal({ title, body, monoBlock, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onCancel()
  }

  return (
    <div
      onClick={handleBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={md.backdrop}
    >
      <div style={md.box}>
        <div style={md.title}>{title}</div>
        {typeof body === 'string'
          ? <div style={md.body}>{body}</div>
          : body
        }
        {monoBlock && <div style={md.bodyMono}>{monoBlock}</div>}
        <div style={md.actions}>
          <button
            type="button"
            onClick={onCancel}
            className="sb-btn-ghost"
            style={md.btnGhost ?? { background: 'transparent', color: 'var(--text-body)', border: '1px solid var(--border-strong)', borderRadius: '6px', padding: '9px 18px', fontFamily: 'var(--font-sans)', fontSize: '13px', cursor: 'pointer' }}
          >
            {cancelLabel || 'cancel'}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none', borderRadius: '6px', padding: '9px 18px', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
          >
            {confirmLabel || 'confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
