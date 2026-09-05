import { Link } from 'react-router-dom'

export default function StatCard({ label, value, sublabel, to, warn }) {
  const content = (
    <>
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${warn ? 'text-amber-600' : 'text-slate-900'}`}>
        {value}
      </p>
      {sublabel && <p className="mt-1 text-xs text-slate-500">{sublabel}</p>}
    </>
  )

  const className = 'block rounded-lg border border-slate-200 bg-white p-4 shadow-sm'

  if (to) {
    return (
      <Link to={to} className={`${className} hover:border-emerald-300`}>
        {content}
      </Link>
    )
  }

  return <div className={className}>{content}</div>
}
