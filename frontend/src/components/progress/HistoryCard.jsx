import { Link } from 'react-router-dom'
import Badge from '../common/Badge'
import ProgressBar from '../common/ProgressBar'

export default function HistoryCard({ userProcedure }) {
  return (
    <Link
      to={`/history/${userProcedure.id_user_procedure}`}
      className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-emerald-300"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-slate-900">{userProcedure.procedure.titre_proc}</h3>
        <Badge status={userProcedure.status} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {userProcedure.procedure.administration.nom_administration} · démarré le{' '}
        {new Date(userProcedure.started_at).toLocaleDateString('fr-FR')}
      </p>
      <div className="mt-3">
        <ProgressBar percent={userProcedure.percent_complete} />
      </div>
    </Link>
  )
}
