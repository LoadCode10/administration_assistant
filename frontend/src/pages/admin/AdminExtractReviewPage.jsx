import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getStaging, updateStaging, validateStaging, rejectStaging } from '../../api/admin'
import ExtractionReviewForm from '../../components/admin/ExtractionReviewForm'
import ConfirmDialog from '../../components/common/ConfirmDialog'
import Badge from '../../components/common/Badge'
import Spinner from '../../components/common/Spinner'

function sanitize(list) {
  return list.map((item) => ({
    proc_title: item.proc_title,
    proc_administration: item.proc_administration.filter((x) => x.trim()),
    proc_pieces: item.proc_pieces.filter((x) => x.trim()),
    proc_steps: item.proc_steps.filter((x) => x.trim()),
    fee: item.fee || null,
  }))
}

export default function AdminExtractReviewPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [staging, setStaging] = useState(null)
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)

  useEffect(() => {
    getStaging(id).then((data) => {
      setStaging(data)
      setItems(data.extracted_data)
    })
  }, [id])

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const updated = await updateStaging(id, sanitize(items))
      setStaging(updated)
      setItems(updated.extracted_data)
      return true
    } catch {
      setError('Erreur lors de la sauvegarde.')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleValidate() {
    const saved = await handleSave()
    if (!saved) return
    await validateStaging(id)
    navigate('/admin/procedures')
  }

  async function handleReject() {
    await rejectStaging(id)
    navigate('/admin/extract')
  }

  if (!staging) return <Spinner />

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">
          Révision : {staging.source_filenames.join(', ')}
        </h1>
        <Badge status={staging.status} />
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Corrigez les données extraites par l'IA avant de les valider et de les ajouter à la base.
      </p>

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

      <div className="mt-4">
        <ExtractionReviewForm items={items} onChange={setItems} />
      </div>

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={() => setConfirmAction('save')}
          disabled={saving}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          Enregistrer les modifications
        </button>
        <button
          type="button"
          onClick={() => setConfirmAction('validate')}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Valider et ajouter à la base
        </button>
        <button
          type="button"
          onClick={() => setConfirmAction('reject')}
          className="rounded-md border border-rose-300 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
        >
          Rejeter
        </button>
      </div>

      <ConfirmDialog
        open={confirmAction === 'save'}
        title="Enregistrer les modifications ?"
        message="Les corrections apportées ci-dessus seront sauvegardées sur ce lot (rien n'est encore ajouté à la base)."
        confirmLabel="Enregistrer"
        onConfirm={() => {
          setConfirmAction(null)
          handleSave()
        }}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === 'validate'}
        title="Valider ce lot ?"
        message="Les procédures ci-dessus seront ajoutées définitivement à la base et deviendront immédiatement consultables et indexées."
        confirmLabel="Valider"
        onConfirm={() => {
          setConfirmAction(null)
          handleValidate()
        }}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === 'reject'}
        title="Rejeter ce lot ?"
        message="Les données extraites seront écartées et rien ne sera ajouté à la base."
        confirmLabel="Rejeter"
        danger
        onConfirm={() => {
          setConfirmAction(null)
          handleReject()
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  )
}
