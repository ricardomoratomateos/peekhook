import SchemaSparkline from '../components/SchemaSparkline.jsx'
import { s, d } from '../styles.js'

export default function SchemaPage({ token }) {
  return (
    <div style={s.page}>
      <header style={s.pageHeader}>
        <div style={d.eyebrow}>sandbox · schema</div>
        <div style={d.headlineRow}>
          <span style={d.methodLg}>schema</span>
          <span style={d.pathLg}>/ shape</span>
        </div>
      </header>
      <div style={s.pageBody}>
        <SchemaSparkline token={token} />
      </div>
    </div>
  )
}