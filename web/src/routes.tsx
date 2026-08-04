import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

const AdminPage = lazy(async () => {
  const module = await import('./admin/AdminPage')
  return { default: module.AdminPage }
})

const CameraPage = lazy(async () => {
  const module = await import('./camera/CameraPage')
  return { default: module.CameraPage }
})

const ViewerPage = lazy(async () => {
  const module = await import('./viewer/ViewerPage')
  return { default: module.ViewerPage }
})

export function AppRoutes() {
  return (
    <Suspense fallback={<div className="route-loading">页面加载中...</div>}>
      <Routes>
        <Route path="/" element={<Navigate to="/viewer/home" replace />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/camera/:roomId" element={<CameraPage />} />
        <Route path="/viewer/:roomId" element={<ViewerPage />} />
        <Route path="*" element={<Navigate to="/viewer/home" replace />} />
      </Routes>
    </Suspense>
  )
}
