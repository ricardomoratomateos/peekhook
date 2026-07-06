import ResponseConfigPanel from '../components/ResponseConfigPanel.jsx'
import { s } from '../styles.js'
import { d } from '../styles.js'

export default function ReplyPage({ token }) {
  return (
    <div style={s.page}>
      <header style={s.pageHeader}>
        <div style={d.eyebrow}>sandbox · reply</div>
        <div style={d.headlineRow}>
          <span style={d.methodLg}>reply</span>
          <span style={d.pathLg}>/ config</span>
        </div>
      </header>
      <div style={s.pageBody}>
        <ResponseConfigPanel token={token} />
      </div>
    </div>
  )
}