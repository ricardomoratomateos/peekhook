import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import Landing from './pages/Landing.jsx'
import Docs from './pages/Docs.jsx'
import Inspector from './pages/Inspector.jsx'
import SharedCaptureView from './features/inspector/components/SharedCaptureView.jsx'

const TABS = [
  { id: 'inbox',  path: '',         label: 'Inbox',  icon: 'inbox'        },
  { id: 'reply',  path: '/reply',   label: 'Reply',  icon: 'reply'        },
  { id: 'schema', path: '/schema',  label: 'Schema', icon: 'data_object'  },
  { id: 'mcp',    path: '/mcp',     label: 'MCP',    icon: 'terminal'     },
]

function InspectorWithTab() {
  const { tab } = useParams()
  return <Inspector tab={tab || 'inbox'} />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/i/:token" element={<InspectorWithTab />} />
        <Route path="/i/:token/:tab" element={<InspectorWithTab />} />
        <Route path="/c/:id" element={<SharedCaptureRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

function SharedCaptureRoute() {
  const { id } = useParams()
  return <SharedCaptureView id={id} />
}

export { TABS }
