import { Routes, Route, Link, useLocation } from 'react-router-dom'
import HomePage from './pages/HomePage'
import GeneratorPage from './pages/GeneratorPage'
import PreviewPage from './pages/PreviewPage'

function App() {
  const location = useLocation()

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <h1 className="logo">
            <Link to="/">Generador de Trazados</Link>
          </h1>
          <nav className="nav">
            <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>
              Inicio
            </Link>
            <Link to="/generator" className={`nav-link ${location.pathname === '/generator' ? 'active' : ''}`}>
              Generador
            </Link>
            <Link to="/preview" className={`nav-link ${location.pathname === '/preview' ? 'active' : ''}`}>
              Preview
            </Link>
          </nav>
        </div>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/generator" element={<GeneratorPage />} />
          <Route path="/preview" element={<PreviewPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
