import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/')
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        <Link to="/" className="text-lg font-semibold text-emerald-700">
          Assistant Administratif
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {user && user.role !== 'admin' && (
            <Link to="/history" className="text-slate-600 hover:text-slate-900">
              Mes démarches
            </Link>
          )}
          {user?.role === 'admin' && (
            <Link to="/admin/procedures" className="text-slate-600 hover:text-slate-900">
              Administration
            </Link>
          )}
          {user ? (
            <>
              <span className="text-slate-500">{user.prenom_user}</span>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
              >
                Déconnexion
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-slate-600 hover:text-slate-900">
                Connexion
              </Link>
              <Link
                to="/register"
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700"
              >
                Inscription
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
