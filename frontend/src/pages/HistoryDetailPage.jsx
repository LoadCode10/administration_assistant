import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { getMyProcedure, toggleEtape, togglePiece } from '../api/progress'
import Badge from '../components/common/Badge'
import ProgressBar from '../components/common/ProgressBar'
import EtapeChecklist from '../components/progress/EtapeChecklist'
import PieceChecklist from '../components/progress/PieceChecklist'
import Spinner from '../components/common/Spinner'

export default function HistoryDetailPage() {
  const { id } = useParams()
  const [userProcedure, setUserProcedure] = useState(null)
  const [error, setError] = useState('')
  const [pendingIds, setPendingIds] = useState([])

  const load = useCallback(() => {
    getMyProcedure(id)
      .then(setUserProcedure)
      .catch(() => setError('Impossible de charger cette démarche.'))
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function handleToggleEtape(etapeId, isDone) {
    setPendingIds((prev) => [...prev, etapeId])
    try {
      const updated = await toggleEtape(id, etapeId, isDone)
      setUserProcedure(updated)
    } finally {
      setPendingIds((prev) => prev.filter((x) => x !== etapeId))
    }
  }

  async function handleTogglePiece(pieceId, isDone) {
    setPendingIds((prev) => [...prev, pieceId])
    try {
      const updated = await togglePiece(id, pieceId, isDone)
      setUserProcedure(updated)
    } finally {
      setPendingIds((prev) => prev.filter((x) => x !== pieceId))
    }
  }

  if (error) return <p className="text-sm text-rose-600">{error}</p>
  if (!userProcedure) return <Spinner />

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">{userProcedure.procedure.titre_proc}</h1>
        <Badge status={userProcedure.status} />
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {userProcedure.procedure.administration.nom_administration}
      </p>

      <div className="mt-4">
        <ProgressBar percent={userProcedure.percent_complete} />
      </div>

      {userProcedure.pieces.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-slate-700">Documents requis</h2>
          <PieceChecklist
            pieces={userProcedure.pieces}
            onToggle={handleTogglePiece}
            disabledIds={pendingIds}
          />
        </div>
      )}

      {userProcedure.etapes.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-slate-700">Étapes à compléter</h2>
          <EtapeChecklist
            etapes={userProcedure.etapes}
            onToggle={handleToggleEtape}
            disabledIds={pendingIds}
          />
        </div>
      )}
    </div>
  )
}
