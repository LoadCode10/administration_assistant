export default function Spinner({ className = '' }) {
  return (
    <div className={`flex items-center justify-center py-8 ${className}`}>
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-600" />
    </div>
  )
}
