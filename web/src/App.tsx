import { Link } from 'react-router-dom'
import { AppRoutes } from './routes'

export function App() {
  return (
    <>
      <header className="topbar">
        <Link to="/viewer/home" className="brand">Home Surveillance</Link>
        <nav>
          <Link to="/camera/home">采集端</Link>
          <Link to="/viewer/home">观看端</Link>
        </nav>
      </header>
      <AppRoutes />
    </>
  )
}
