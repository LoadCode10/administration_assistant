import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getProcedure } from '../../api/procedures'
import { createProcedure, updateProcedure } from '../../api/admin'
import ProcedureForm from '../../components/admin/ProcedureForm'
import ConfirmDialog from '../../components/common/ConfirmDialog'
import Spinner from '../../components/common/Spinner'

export default function AdminProcedureFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const [initialValue, setInitialValue] = useState(isEdit ? null : undefined)
  const [pendingPayload, setPendingPayload] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isEdit) return
    getProcedure(id).then((procedure) =>
      setInitialValue({
        titre_proc: procedure.titre_proc,
        frais_proc: procedure.frais_proc ?? '',
        delai_proc: procedure.delai_proc ?? '',
        nom_administration: procedure.administration.nom_administration,
        pieces: procedure.pieces.map((piece) => piece.nom_piece),
        etapes: [...procedure.etapes]
          .sort((a, b) => a.ordre_etape - b.ordre_etape)
          .map((etape) => etape.description_etape),
      }),
    )
  }, [id, isEdit])

  function handleSubmit(form) {
    const payload = {
      ...form,
      pieces: form.pieces.filter((x) => x.trim()),
      etapes: form.etapes.filter((x) => x.trim()),
      frais_proc: form.frais_proc || null,
      delai_proc: form.delai_proc || null,
    }
    setPendingPayload(payload)
  }

  async function confirmSubmit() {
    setSubmitting(true)
    setError('')
    try {
      if (isEdit) {
        await updateProcedure(id, pendingPayload)
      } else {
        await createProcedure(pendingPayload)
      }
      navigate('/admin/procedures')
    } catch {
      setError("Erreur lors de l'enregistrement.")
    } finally {
      setPendingPayload(null)
      setSubmitting(false)
    }
  }

  if (isEdit && initialValue === null) return <Spinner />

  return (
    <div className="max-w-xl">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">
        {isEdit ? 'Modifier la procédure' : 'Nouvelle procédure'}
      </h1>
      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}
      <ProcedureForm initialValue={initialValue} onSubmit={handleSubmit} submitting={submitting} />
      <ConfirmDialog
        open={Boolean(pendingPayload)}
        title={isEdit ? 'Modifier cette procédure ?' : 'Créer cette procédure ?'}
        message={
          isEdit
            ? 'Les modifications seront appliquées immédiatement à cette procédure.'
            : 'Cette procédure sera ajoutée à la base et deviendra immédiatement consultable.'
        }
        confirmLabel={isEdit ? 'Modifier' : 'Créer'}
        pendingLabel={isEdit ? 'Modification...' : 'Création...'}
        onConfirm={confirmSubmit}
        onCancel={() => setPendingPayload(null)}
      />
    </div>
  )
}
