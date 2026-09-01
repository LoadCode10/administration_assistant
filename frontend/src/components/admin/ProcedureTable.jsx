import { Link } from 'react-router-dom'

export default function ProcedureTable({ procedures, onDelete }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2">Titre</th>
            <th className="px-4 py-2">Administration</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {procedures.map((procedure) => (
            <tr key={procedure.id_procedure}>
              <td className="px-4 py-2 font-medium text-slate-900">{procedure.titre_proc}</td>
              <td className="px-4 py-2 text-slate-600">{procedure.administration.nom_administration}</td>
              <td className="px-4 py-2 text-right">
                <div className="flex justify-end gap-3">
                  <Link
                    to={`/admin/procedures/${procedure.id_procedure}/edit`}
                    className="text-emerald-700 hover:underline"
                  >
                    Modifier
                  </Link>
                  <button
                    type="button"
                    onClick={() => onDelete(procedure)}
                    className="text-rose-600 hover:underline"
                  >
                    Supprimer
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
