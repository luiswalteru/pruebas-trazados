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
        </div>
      </div>
    </div>
  )
}
