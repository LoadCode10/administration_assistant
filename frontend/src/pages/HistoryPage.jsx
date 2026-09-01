import { useEffect, useState } from 'react'
import { listMyProcedures } from '../api/progress'
import HistoryCard from '../components/progress/HistoryCard'
import Spinner from '../components/common/Spinner'

export default function HistoryPage() {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    listMyProcedures()
      .then(setItems)
      .catch(() => setError('Impossible de charger vos démarches.'))
  }, [])

  if (error) return <p className="text-sm text-rose-600">{error}</p>
  if (items === null) return <Spinner />

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Mes démarches</h1>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">
          Vous n'avez pas encore démarré de démarche. Posez une question dans le chat pour commencer.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <HistoryCard key={item.id_user_procedure} userProcedure={item} />
          ))}
        </div>
      )}
    </div>
  )
}
