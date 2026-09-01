export default function ProgressBar({ percent }) {
  const value = Math.max(0, Math.min(100, percent ?? 0))
  return (
    <div className="w-full">
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-emerald-600 transition-all"
          style={{ width: `${value}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-slate-500">{value.toFixed(0)}% complété</p>
    </div>
  )
}
