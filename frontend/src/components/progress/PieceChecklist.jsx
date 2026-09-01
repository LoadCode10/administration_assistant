export default function PieceChecklist({ pieces, onToggle, disabledIds = [] }) {
  return (
    <ul className="space-y-2">
      {pieces.map((item) => (
        <li
          key={item.id_user_procedure_piece}
          className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-3"
        >
          <input
            type="checkbox"
            checked={item.is_done}
            disabled={disabledIds.includes(item.id_piece)}
            onChange={(e) => onToggle(item.id_piece, e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span className={`text-sm ${item.is_done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
            {item.piece.nom_piece}
          </span>
        </li>
      ))}
    </ul>
  )
}
