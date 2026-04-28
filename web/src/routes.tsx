import { Navigate, Route, Routes } from 'react-router-dom'
import { CameraPage } from './camera/CameraPage'
import { ViewerPage } from './viewer/ViewerPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/viewer/home" replace />} />
      <Route path="/camera/:roomId" element={<CameraPage />} />
      <Route path="/viewer/:roomId" element={<ViewerPage />} />
      <Route path="*" element={<Navigate to="/viewer/home" replace />} />
    </Routes>
  )
}
