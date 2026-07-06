import { useEffect, useRef, useState, useCallback } from 'react'

const PERMISSION_REQUESTED_KEY = 'peekhook-notif-perm-asked'

function supportsNotifications() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function useBrowserNotify() {
  const [permission, setPermission] = useState(() => {
    if (!supportsNotifications()) return 'unsupported'
    return Notification.permission
  })

  const requestPermission = useCallback(async () => {
    if (!supportsNotifications()) return 'unsupported'
    if (Notification.permission === 'granted') return 'granted'
    if (Notification.permission === 'denied') return 'denied'
    try {
      const result = await Notification.requestPermission()
      try { localStorage.setItem(PERMISSION_REQUESTED_KEY, '1') } catch (_) {}
      setPermission(result)
      return result
    } catch (err) {
      return 'denied'
    }
  }, [])

  return { permission, requestPermission, supported: supportsNotifications() }
}

export function useCaptureNotifications(enabled) {
  const lastShownId = useRef(null)

  useEffect(() => {
    if (!enabled || !supportsNotifications()) return
    if (Notification.permission !== 'granted') return

    const handler = (event) => {
      if (event.type !== 'request' || !event.data) return
      if (lastShownId.current === event.data.id) return
      if (document.visibilityState !== 'hidden') return
      lastShownId.current = event.data.id

      const method = (event.data.method || 'POST').toLowerCase()
      const path = event.data.path || ''
      try {
        const n = new Notification(`new ${method} on ${path.slice(0, 50)}`, {
          body: 'click to open the inspector',
          tag: 'peekhook-capture',
          silent: false,
        })
        n.onclick = () => {
          window.focus()
          n.close()
        }
        setTimeout(() => n.close(), 6000)
      } catch (_) {
        // notifications can throw in some browsers; ignore
      }
    }

    if (typeof EventSource !== 'undefined' && window.__peekhookEventSource) {
      window.__peekhookEventSource.addEventListener('message', handler)
      return () => window.__peekhookEventSource.removeEventListener('message', handler)
    }
  }, [enabled])
}
