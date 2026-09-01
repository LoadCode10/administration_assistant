const STYLES = {
  en_cours: 'bg-amber-100 text-amber-800',
  termine: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-amber-100 text-amber-800',
  validated: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
}

const LABELS = {
  en_cours: 'En cours',
  termine: 'Terminé',
  pending: 'En attente',
  validated: 'Validé',
  rejected: 'Rejeté',
}

export default function Badge({ status }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STYLES[status] ?? 'bg-slate-100 text-slate-700'
      }`}
    >
      {LABELS[status] ?? status}
    </span>
  )
}
