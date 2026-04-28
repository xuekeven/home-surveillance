import './polyfills'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { appConfig } from './config'
import './shared/styles.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <BrowserRouter basename={appConfig.publicBasePath || undefined}>
    <App />
  </BrowserRouter>
)
