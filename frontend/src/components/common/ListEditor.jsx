export default function ListEditor({ label, items, onChange, placeholder }) {
  function updateItem(index, value) {
    const next = [...items]
    next[index] = value
    onChange(next)
  }

  function addItem() {
    onChange([...items, ''])
  }

  function removeItem(index) {
    onChange(items.filter((_, i) => i !== index))
  }

  return (
    <div>
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <div className="mt-1 space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex gap-2">
            <input
              value={item}
              onChange={(e) => updateItem(index, e.target.value)}
              placeholder={placeholder}
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => removeItem(index)}
              className="rounded-md border border-slate-300 px-2 text-sm text-slate-500 hover:bg-slate-50"
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" onClick={addItem} className="text-sm text-emerald-700 hover:underline">
          + Ajouter
        </button>
      </div>
    </div>
  )
}
