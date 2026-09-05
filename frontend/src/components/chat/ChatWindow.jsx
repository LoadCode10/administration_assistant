import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  listConversations,
  createConversation,
  getConversation,
  deleteConversation,
  sendMessage,
  editMessage,
  deleteMessage,
} from '../../api/conversations'
import { getProcedure } from '../../api/procedures'
import { startProcedure } from '../../api/progress'
import ConversationSidebar from './ConversationSidebar'
import MessageBubble from './MessageBubble'
import SuggestionChips from './SuggestionChips'
import ProcedureCard from '../procedures/ProcedureCard'
import ChatInput from './ChatInput'
import ConfirmDialog from '../common/ConfirmDialog'
import Spinner from '../common/Spinner'

export default function ChatWindow() {
  const navigate = useNavigate()
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [turns, setTurns] = useState([])
  const [loadingTurns, setLoadingTurns] = useState(false)
  const [sending, setSending] = useState(false)
  const [startingId, setStartingId] = useState(null)
  const [expandedByQuestion, setExpandedByQuestion] = useState({})
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [creatingConversation, setCreatingConversation] = useState(false)
  const [savingEditId, setSavingEditId] = useState(null)
  const [loadingSuggestionId, setLoadingSuggestionId] = useState(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    listConversations().then((list) => {
      setConversations(list)
      if (list.length > 0) {
        selectConversation(list[0].id_conversation)
      }
    })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  function selectConversation(id) {
    setActiveId(id)
    setExpandedByQuestion({})
    setLoadingTurns(true)
    getConversation(id)
      .then((data) => setTurns(data.messages))
      .finally(() => setLoadingTurns(false))
  }

  async function handleNew() {
    setCreatingConversation(true)
    try {
      const conversation = await createConversation()
      setConversations((prev) => [conversation, ...prev])
      setActiveId(conversation.id_conversation)
      setTurns([])
      setExpandedByQuestion({})
    } finally {
      setCreatingConversation(false)
    }
  }

  async function handleDeleteConversation(id) {
    await deleteConversation(id)
    setConversations((prev) => prev.filter((c) => c.id_conversation !== id))
    if (id === activeId) {
      setActiveId(null)
      setTurns([])
    }
  }

  async function handleSend(text) {
    setSending(true)
    try {
      let conversationId = activeId
      if (!conversationId) {
        const conversation = await createConversation()
        setConversations((prev) => [conversation, ...prev])
        setActiveId(conversation.id_conversation)
        conversationId = conversation.id_conversation
      }
      const turn = await sendMessage(conversationId, { question_content: text })
      setTurns((prev) => [...prev, turn])
      const updatedList = await listConversations()
      setConversations(updatedList)
    } finally {
      setSending(false)
    }
  }

  async function handleEdit(questionId, newText) {
    setSavingEditId(questionId)
    try {
      const updated = await editMessage(activeId, questionId, newText)
      setTurns((prev) => prev.map((t) => (t.id_question === questionId ? updated : t)))
      setExpandedByQuestion((prev) => {
        const next = { ...prev }
        delete next[questionId]
        return next
      })
    } finally {
      setSavingEditId(null)
    }
  }

  async function confirmDeleteMessage() {
    const questionId = deleteTarget
    await deleteMessage(activeId, questionId)
    setDeleteTarget(null)
    setTurns((prev) => prev.filter((t) => t.id_question !== questionId))
  }

  async function handleSuggestionSelect(questionId, suggestion) {
    setLoadingSuggestionId(suggestion.id_procedure)
    try {
      const procedure = await getProcedure(suggestion.id_procedure)
      setExpandedByQuestion((prev) => ({ ...prev, [questionId]: procedure }))
    } finally {
      setLoadingSuggestionId(null)
    }
  }

  async function handleStart(procedure) {
    setStartingId(procedure.id_procedure)
    try {
      const userProcedure = await startProcedure(procedure.id_procedure)
      navigate(`/history/${userProcedure.id_user_procedure}`)
    } finally {
      setStartingId(null)
    }
  }

  return (
    <div className="flex h-[75vh] overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <ConversationSidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={selectConversation}
        onNew={handleNew}
        onDelete={handleDeleteConversation}
        creating={creatingConversation}
      />

      <div className="flex flex-1 flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {loadingTurns && <Spinner />}

          {!loadingTurns && !activeId && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-slate-500">
              <p>Sélectionnez une conversation ou commencez-en une nouvelle.</p>
            </div>
          )}

          {!loadingTurns &&
            turns.map((turn) => (
              <div key={turn.id_question} className="space-y-2">
                <MessageBubble
                  role="user"
                  onEdit={(newText) => handleEdit(turn.id_question, newText)}
                  onDelete={() => setDeleteTarget(turn.id_question)}
                  saving={savingEditId === turn.id_question}
                >
                  {turn.question_content}
                </MessageBubble>

                {turn.type === 'answer' && turn.procedure && (
                  <div className="max-w-[85%]">
                    <ProcedureCard
                      procedure={turn.procedure}
                      onStart={() => handleStart(turn.procedure)}
                      starting={startingId === turn.procedure.id_procedure}
                    />
                  </div>
                )}

                {turn.type === 'suggestions' && (
                  <>
                    <MessageBubble role="assistant">
                      Je n'ai pas trouvé de correspondance évidente. Voici quelques démarches
                      proches :
                    </MessageBubble>
                    <SuggestionChips
                      suggestions={turn.suggestions}
                      onSelect={(s) => handleSuggestionSelect(turn.id_question, s)}
                      loadingId={loadingSuggestionId}
                    />
                    {expandedByQuestion[turn.id_question] && (
                      <div className="max-w-[85%]">
                        <ProcedureCard
                          procedure={expandedByQuestion[turn.id_question]}
                          onStart={() => handleStart(expandedByQuestion[turn.id_question])}
                          starting={startingId === expandedByQuestion[turn.id_question].id_procedure}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}

          {sending && <Spinner />}
          <div ref={bottomRef} />
        </div>
        <ChatInput onSend={handleSend} disabled={sending} />
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Supprimer ce message ?"
        message="Ce message et sa réponse seront définitivement supprimés."
        confirmLabel="Supprimer"
        pendingLabel="Suppression..."
        danger
        onConfirm={confirmDeleteMessage}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
