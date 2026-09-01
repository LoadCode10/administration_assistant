import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    nom_user: '',
    prenom_user: '',
    email_user: '',
    phone_user: '',
    password: '',
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function update(field) {
    return (e) => setForm({ ...form, [field]: e.target.value })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await register({ ...form, phone_user: form.phone_user || undefined })
      navigate('/', { replace: true })
    } catch (err) {
      if (err.response?.status === 409) {
        setError('Cet email est déjà utilisé.')
      } else {
        setError("Une erreur est survenue lors de l'inscription.")
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-xl font-semibold text-slate-900">Inscription</h1>
      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <input
            required
            placeholder="Prénom"
            value={form.prenom_user}
            onChange={update('prenom_user')}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            placeholder="Nom"
            value={form.nom_user}
            onChange={update('nom_user')}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <input
          type="email"
          required
          placeholder="Email"
          value={form.email_user}
          onChange={update('email_user')}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          placeholder="Téléphone (optionnel)"
          value={form.phone_user}
          onChange={update('phone_user')}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          type="password"
          required
          placeholder="Mot de passe"
          value={form.password}
          onChange={update('password')}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {submitting ? 'Inscription...' : "S'inscrire"}
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-500">
        Déjà un compte ?{' '}
        <Link to="/login" className="text-emerald-700 hover:underline">
          Connectez-vous
        </Link>
      </p>
    </div>
  )
}
