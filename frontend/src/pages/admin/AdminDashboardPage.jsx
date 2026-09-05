import { useEffect, useState } from 'react'
import { getStats } from '../../api/admin'
import StatCard from '../../components/admin/StatCard'
import Spinner from '../../components/common/Spinner'

export default function AdminDashboardPage() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getStats()
      .then(setStats)
      .catch(() => setError('Impossible de charger les statistiques.'))
  }, [])

  if (error) return <p className="text-sm text-rose-600">{error}</p>
  if (stats === null) return <Spinner />

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Tableau de bord</h1>

      <h2 className="mt-6 text-sm font-medium text-slate-700">Contenu</h2>
      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Procédures" value={stats.total_procedures} to="/admin/procedures" />
        <StatCard label="Administrations" value={stats.total_administrations} />
        <StatCard
          label="Sans embedding"
          value={stats.procedures_missing_embedding}
          sublabel={stats.procedures_missing_embedding > 0 ? 'Ne seront pas trouvées par le chat' : 'Tout est indexé'}
          warn={stats.procedures_missing_embedding > 0}
        />
      </div>

      <h2 className="mt-6 text-sm font-medium text-slate-700">Comptes</h2>
      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Utilisateurs" value={stats.total_users} />
        <StatCard label="Administrateurs" value={stats.total_admins} />
        <StatCard
          label="Lots à valider"
          value={stats.pending_extraction_batches}
          sublabel="Extractions en attente de revue"
          to="/admin/extract"
          warn={stats.pending_extraction_batches > 0}
        />
      </div>

      <h2 className="mt-6 text-sm font-medium text-slate-700">Chat — 7 derniers jours</h2>
      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Questions posées" value={stats.questions_last_7_days} />
        <StatCard label="Réponses directes" value={stats.direct_answers_last_7_days} />
        <StatCard label="Suggestions proposées" value={stats.suggestions_last_7_days} />
      </div>

      <h2 className="mt-6 text-sm font-medium text-slate-700">Engagement</h2>
      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Démarches en cours" value={stats.procedures_in_progress} />
        <StatCard label="Démarches terminées" value={stats.procedures_completed} />
        <StatCard
          label="Procédure la plus démarrée"
          value={stats.top_procedure ? stats.top_procedure.titre_proc : '—'}
          sublabel={stats.top_procedure ? `${stats.top_procedure.times_started} fois` : undefined}
        />
      </div>
    </div>
  )
}
