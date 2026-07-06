import { c } from '../lib/tokens.js'
import { methodTone, formatBody, formatSize, prettyPath } from '../lib/format.js'
import KVTable from './KVTable.jsx'
import Meta from './Meta.jsx'
import { d } from '../styles.js'

export default function DetailPanel({ req, token }) {
  if (!req) {
    return (
      <div style={d.noSel}>
        <p style={d.noSelText}>select a request to inspect</p>
        <p style={d.noSelSub}>click any request in the list to view its headers and body.</p>
      </div>
    )
  }
  const t = methodTone(req.method)
  const bodyText = formatBody(req.body, req.contentType)
  const queryRows = req.query && typeof req.query === 'object' ? Object.entries(req.query) : []
  const headerRows = req.headers ? Object.entries(req.headers) : []

  return (
    <div style={d.panel}>
      <div style={d.header}>
        <div style={d.headerLeft}>
          <div style={d.eyebrow}>sandbox · inbox</div>
          <div style={d.headlineRow}>
            <span style={{ ...d.methodLg, color: t.color, fontWeight: t.weight }}>{(req.method || '?').toLowerCase()}</span>
            <span style={d.pathLg}>{prettyPath(req.path, token)}</span>
          </div>
        </div>
        <span style={d.timestamp}>{new Date(req.createdAt).toISOString().replace('T', ' ').slice(0, 19)}</span>
      </div>

      <div style={d.meta}>
        {req.ip && <Meta label="ip" value={req.ip} />}
        {req.contentType && <Meta label="content-type" value={req.contentType} />}
        {req.size != null && <Meta label="size" value={formatSize(req.size)} />}
      </div>

      <div style={d.scroll}>
        {queryRows.length > 0 && (
          <section style={d.section}>
            <div style={d.sectionTitle}>query params</div>
            <KVTable rows={queryRows} />
          </section>
        )}
        <section style={d.section}>
          <div style={d.sectionTitle}>headers</div>
          <KVTable rows={headerRows} />
        </section>
        <section style={{ ...d.section, flex: 1, display: 'flex', flexDirection: 'column', borderBottom: 'none' }}>
          <div style={d.sectionTitle}>body</div>
          {bodyText
            ? <pre style={d.bodyPre}>{bodyText}</pre>
            : <span style={{ fontSize: '12px', color: c.faint }}>empty body</span>}
        </section>
      </div>
    </div>
  )
}
