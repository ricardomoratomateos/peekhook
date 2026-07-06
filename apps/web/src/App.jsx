import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import Landing from './pages/Landing.jsx'
import Inspector from './pages/Inspector.jsx'
import SharedCaptureView from './features/inspector/components/SharedCaptureView.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/i/:token" element={<Inspector />} />
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
