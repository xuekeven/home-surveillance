import { Link } from 'react-router-dom'
import { AppRoutes } from './routes'

export function App() {
  return (
    <>
      <header className="topbar">
        <Link to="/viewer/home" className="brand">Home Surveillance</Link>
      </header>
      <AppRoutes />
    </>
  )
}
