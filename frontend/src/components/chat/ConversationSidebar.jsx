import { useState } from 'react'
import ConfirmDialog from '../common/ConfirmDialog'

export default function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  creating = false,
}) {
  const [toDelete, setToDelete] = useState(null)

  async function confirmDelete() {
    await onDelete(toDelete.id_conversation)
    setToDelete(null)
  }

  return (
    <aside className="w-56 shrink-0 border-r border-slate-200 bg-white">
      <div className="p-3">
        <button
          type="button"
          onClick={onNew}
          disabled={creating}
          className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {creating ? 'Création...' : '+ Nouvelle conversation'}
        </button>
      </div>
      <ul className="space-y-1 overflow-y-auto px-2 pb-3" style={{ maxHeight: 'calc(75vh - 60px)' }}>
        {conversations.map((conversation) => (
          <li key={conversation.id_conversation} className="group flex items-center gap-1">
            <button
              type="button"
              onClick={() => onSelect(conversation.id_conversation)}
              className={`flex-1 truncate rounded-md px-2 py-2 text-left text-sm ${
                conversation.id_conversation === activeId
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
              title={conversation.title || 'Nouvelle conversation'}
            >
              {conversation.title || 'Nouvelle conversation'}
            </button>
            <button
              type="button"
              onClick={() => setToDelete(conversation)}
              className="rounded p-1 text-xs text-slate-300 opacity-0 hover:bg-rose-100 hover:text-rose-600 group-hover:opacity-100"
              title="Supprimer la conversation"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Supprimer cette conversation ?"
        message="Tous les messages de cette conversation seront définitivement supprimés."
        confirmLabel="Supprimer"
        pendingLabel="Suppression..."
        danger
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </aside>
  )
}
