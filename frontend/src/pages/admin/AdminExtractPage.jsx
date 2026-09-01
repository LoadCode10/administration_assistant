import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadExtraction, listStagings } from '../../api/admin'
import FileUploader from '../../components/admin/FileUploader'
import ConfirmDialog from '../../components/common/ConfirmDialog'
import StagingList from '../../components/admin/StagingList'
import Spinner from '../../components/common/Spinner'

export default function AdminExtractPage() {
  const navigate = useNavigate()
  const [pendingFiles, setPendingFiles] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [stagings, setStagings] = useState(null)

  function loadStagings() {
    listStagings('pending')
      .then(setStagings)
      .catch(() => setStagings([]))
  }

  useEffect(loadStagings, [])

  async function handleConfirmExtract() {
    setUploading(true)
    setError('')
    try {
      const staging = await uploadExtraction(pendingFiles)
      navigate(`/admin/extract/${staging.id_staging}`)
    } catch {
      setError("L'extraction a échoué. Vérifiez le format des fichiers.")
    } finally {
      setPendingFiles(null)
      setUploading(false)
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Importer des procédures</h1>
      <p className="mt-1 text-sm text-slate-500">
        Formats acceptés : .txt, .json, .docx, .pdf. Les données extraites devront être validées avant
        d'être ajoutées à la base.
      </p>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
        <FileUploader onFilesSelected={setPendingFiles} />
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-medium text-slate-700">Lots en attente de validation</h2>
        {stagings === null ? (
          <Spinner />
        ) : stagings.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Aucun lot en attente.</p>
        ) : (
          <div className="mt-2">
            <StagingList stagings={stagings} />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingFiles) && !uploading}
        title="Lancer l'extraction ?"
        message={`${pendingFiles?.length ?? 0} fichier(s) sélectionné(s). L'extraction utilise l'IA pour lire le contenu — si vous annulez, rien ne sera envoyé.`}
        confirmLabel="Oui, extraire"
        onConfirm={handleConfirmExtract}
        onCancel={() => setPendingFiles(null)}
      />
      {uploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-lg bg-white p-6">
            <Spinner />
            <p className="mt-2 text-sm text-slate-600">Extraction en cours...</p>
          </div>
        </div>
      )}
    </div>
  )
}
