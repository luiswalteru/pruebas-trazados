import { Link } from 'react-router-dom'

export default function HomePage() {
  return (
    <div className="home-page">
      <div className="hero">
        <h2>Generador de Trazados de Letras</h2>
        <p className="hero-subtitle">
          Genera trazados interactivos para letras en tipografía ligada y mayúsculas
          dibujando el recorrido manualmente con el cursor.
        </p>
        <div className="hero-actions">
          <Link to="/generator" className="btn btn-primary btn-lg">
            Comenzar a Generar
          </Link>
          <Link to="/preview" className="btn btn-secondary btn-lg">
            Ver Preview
          </Link>
        </div>
      </div>

      <div className="features-grid">
        <div className="feature-card">
          <div className="feature-icon">✍️</div>
          <h3>Trazado Manual</h3>
          <p>Dibuja el recorrido de cada letra con el cursor, trazo a trazo, con control total sobre la dirección.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon">👁️</div>
          <h3>Preview Interactivo</h3>
          <p>Visualiza y prueba los trazados generados con interacción real de trazado.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon">📦</div>
          <h3>Exportación Completa</h3>
          <p>Descarga la estructura de carpetas completa lista para usar en el componente React.</p>
        </div>
      </div>
    </div>
  )
}
