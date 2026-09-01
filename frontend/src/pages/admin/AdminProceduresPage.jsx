import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listProcedures } from '../../api/procedures'
import { deleteProcedure } from '../../api/admin'
import ProcedureTable from '../../components/admin/ProcedureTable'
import ConfirmDialog from '../../components/common/ConfirmDialog'
import Spinner from '../../components/common/Spinner'

export default function AdminProceduresPage() {
  const [procedures, setProcedures] = useState(null)
  const [error, setError] = useState('')
  const [toDelete, setToDelete] = useState(null)

  function load() {
    listProcedures()
      .then(setProcedures)
      .catch(() => setError('Impossible de charger les procédures.'))
  }

  useEffect(load, [])

  async function confirmDelete() {
    await deleteProcedure(toDelete.id_procedure)
    setToDelete(null)
    load()
  }

  if (error) return <p className="text-sm text-rose-600">{error}</p>
  if (procedures === null) return <Spinner />

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Procédures</h1>
        <div className="flex gap-3">
          <Link
            to="/admin/extract"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Importer des fichiers
          </Link>
          <Link
            to="/admin/procedures/new"
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            + Nouvelle procédure
          </Link>
        </div>
      </div>
      <div className="mt-4">
        <ProcedureTable procedures={procedures} onDelete={setToDelete} />
      </div>
      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Supprimer cette procédure ?"
        message={`"${toDelete?.titre_proc}" sera définitivement supprimée, ainsi que le suivi des utilisateurs qui l'ont commencée.`}
        confirmLabel="Supprimer"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}
