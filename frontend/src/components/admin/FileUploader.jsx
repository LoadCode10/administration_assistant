import { useState } from 'react'

export default function FileUploader({ onFilesSelected }) {
  const [selected, setSelected] = useState([])

  function handleChange(e) {
    setSelected(Array.from(e.target.files ?? []))
  }

  function handleConfirm() {
    if (selected.length === 0) return
    onFilesSelected(selected)
  }

  return (
    <div className="space-y-3">
      <input
        type="file"
        multiple
        accept=".txt,.json,.docx,.pdf"
        onChange={handleChange}
        className="block text-sm text-slate-600"
      />
      {selected.length > 0 && (
        <ul className="text-sm text-slate-600">
          {selected.map((file) => (
            <li key={file.name}>{file.name}</li>
          ))}
        </ul>
      )}
      <button
        type="button"
        disabled={selected.length === 0}
        onClick={handleConfirm}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        Extraire les données
      </button>
    </div>
  )
}
