import ListEditor from '../common/ListEditor'

export default function ExtractionReviewForm({ items, onChange }) {
  function updateItem(index, patch) {
    const next = [...items]
    next[index] = { ...next[index], ...patch }
    onChange(next)
  }

  function removeItem(index) {
    onChange(items.filter((_, i) => i !== index))
  }

  function addItem() {
    onChange([
      ...items,
      { proc_title: '', proc_administration: [], proc_pieces: [], proc_steps: [], fee: '' },
    ])
  }

  return (
    <div className="space-y-6">
      {items.map((item, index) => (
        <div key={index} className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-3">
              <div>
                <label className="text-sm font-medium text-slate-700">Titre</label>
                <input
                  value={item.proc_title}
                  onChange={(e) => updateItem(index, { proc_title: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Frais</label>
                <input
                  value={item.fee ?? ''}
                  onChange={(e) => updateItem(index, { fee: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <ListEditor
                label="Administration(s)"
                items={item.proc_administration}
                onChange={(proc_administration) => updateItem(index, { proc_administration })}
                placeholder="Ex : OMPIC"
              />
              <ListEditor
                label="Documents requis"
                items={item.proc_pieces}
                onChange={(proc_pieces) => updateItem(index, { proc_pieces })}
                placeholder="Ex : CIN"
              />
              <ListEditor
                label="Étapes"
                items={item.proc_steps}
                onChange={(proc_steps) => updateItem(index, { proc_steps })}
                placeholder="Ex : Se rendre au guichet"
              />
            </div>
            <button
              type="button"
              onClick={() => removeItem(index)}
              className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
            >
              Retirer
            </button>
          </div>
        </div>
      ))}
      <button type="button" onClick={addItem} className="text-sm text-emerald-700 hover:underline">
        + Ajouter une procédure
      </button>
    </div>
  )
}
