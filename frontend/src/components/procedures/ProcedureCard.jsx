export default function ProcedureCard({ procedure, onStart, starting = false }) {
  const sortedEtapes = [...procedure.etapes].sort((a, b) => a.ordre_etape - b.ordre_etape)

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-base font-semibold text-slate-900">{procedure.titre_proc}</h3>
      <p className="mt-1 text-sm text-slate-500">{procedure.administration.nom_administration}</p>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-slate-400">Frais</dt>
          <dd className="text-slate-700">{procedure.frais_proc || 'Non spécifié'}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Délai</dt>
          <dd className="text-slate-700">{procedure.delai_proc || 'Non spécifié'}</dd>
        </div>
      </dl>

      {procedure.pieces.length > 0 && (
        <div className="mt-3">
          <h4 className="text-sm font-medium text-slate-700">Documents requis</h4>
          <ul className="mt-1 list-inside list-disc text-sm text-slate-600">
            {procedure.pieces.map((piece) => (
              <li key={piece.id_piece}>{piece.nom_piece}</li>
            ))}
          </ul>
        </div>
      )}

      {sortedEtapes.length > 0 && (
        <div className="mt-3">
          <h4 className="text-sm font-medium text-slate-700">Étapes</h4>
          <ol className="mt-1 list-inside list-decimal text-sm text-slate-600">
            {sortedEtapes.map((etape) => (
              <li key={etape.id_etape}>{etape.description_etape}</li>
            ))}
          </ol>
        </div>
      )}

      {onStart && (
        <button
          type="button"
          onClick={onStart}
          disabled={starting}
          className="mt-4 w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {starting ? 'Démarrage...' : 'Commencer la procédure'}
        </button>
      )}
    </div>
  )
}
