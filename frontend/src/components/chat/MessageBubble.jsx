import { useState } from 'react'

export default function MessageBubble({ role, children, onEdit, onDelete, saving = false }) {
  const isUser = role === 'user'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEdit() {
    setDraft(typeof children === 'string' ? children : '')
    setEditing(true)
  }

  async function handleSave() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== children) {
      await onEdit(trimmed)
    }
    setEditing(false)
  }

  return (
    <div className={`group flex items-start gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {isUser && !editing && (onEdit || onDelete) && (
        <div className="mt-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {onEdit && (
            <button
              type="button"
              onClick={startEdit}
              title="Modifier"
              className="rounded p-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              Modifier
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              title="Supprimer"
              className="rounded p-1 text-xs text-slate-400 hover:bg-rose-100 hover:text-rose-600"
            >
              Supprimer
            </button>
          )}
        </div>
      )}

      {editing ? (
        <div className="max-w-[85%] rounded-2xl border border-emerald-300 bg-white p-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            autoFocus
            disabled={saving}
            className="w-full resize-none rounded-md border border-slate-200 p-2 text-sm focus:border-emerald-500 focus:outline-none disabled:opacity-60"
          />
          <div className="mt-1 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="text-xs text-slate-500 hover:underline disabled:opacity-60"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="text-xs font-medium text-emerald-700 hover:underline disabled:opacity-60"
            >
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-2 text-sm ${
            isUser
              ? 'rounded-br-sm bg-emerald-600 text-white'
              : 'rounded-bl-sm border border-slate-200 bg-white text-slate-800'
          }`}
        >
          {children}
        </div>
      )}
    </div>
  )
}
