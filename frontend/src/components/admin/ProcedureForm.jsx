import { useState } from 'react'
import ListEditor from '../common/ListEditor'

export default function ProcedureForm({ initialValue, onSubmit, submitting }) {
  const [form, setForm] = useState(
    initialValue ?? {
      titre_proc: '',
      frais_proc: '',
      delai_proc: '',
      nom_administration: '',
      pieces: [],
      etapes: [],
    },
  )

  function update(field) {
    return (e) => setForm({ ...form, [field]: e.target.value })
  }

  function handleSubmit(e) {
    e.preventDefault()
    onSubmit(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-slate-700">Titre</label>
        <input
          required
          value={form.titre_proc}
          onChange={update('titre_proc')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="text-sm font-medium text-slate-700">Administration</label>
        <input
          required
          value={form.nom_administration}
          onChange={update('nom_administration')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-slate-700">Frais</label>
          <input
            value={form.frais_proc}
            onChange={update('frais_proc')}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700">Délai</label>
          <input
            value={form.delai_proc}
            onChange={update('delai_proc')}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>
      <ListEditor
        label="Documents requis"
        items={form.pieces}
        onChange={(pieces) => setForm({ ...form, pieces })}
        placeholder="Ex : CIN"
      />
      <ListEditor
        label="Étapes"
        items={form.etapes}
        onChange={(etapes) => setForm({ ...form, etapes })}
        placeholder="Ex : Se rendre au guichet"
      />
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {submitting ? 'Enregistrement...' : 'Enregistrer'}
      </button>
    </form>
  )
}
