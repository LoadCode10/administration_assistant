export default function SuggestionChips({ suggestions, onSelect, loadingId = null }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {suggestions.map((suggestion) => {
        const isLoading = loadingId === suggestion.id_procedure
        return (
          <button
            key={suggestion.id_procedure}
            type="button"
            onClick={() => onSelect(suggestion)}
            disabled={Boolean(loadingId)}
            className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
          >
            {isLoading ? 'Chargement...' : suggestion.titre_proc}
          </button>
        )
      })}
    </div>
  )
}
