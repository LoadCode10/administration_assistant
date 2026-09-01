import { Link } from 'react-router-dom'

export default function StagingList({ stagings }) {
  return (
    <ul className="space-y-2">
      {stagings.map((staging) => (
        <li
          key={staging.id_staging}
          className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3 text-sm"
        >
          <div>
            <p className="font-medium text-slate-800">{staging.source_filenames.join(', ')}</p>
            <p className="text-slate-500">{staging.extracted_data.length} procédure(s) extraite(s)</p>
          </div>
          <Link to={`/admin/extract/${staging.id_staging}`} className="text-emerald-700 hover:underline">
            Examiner
          </Link>
        </li>
      ))}
    </ul>
  )
}
