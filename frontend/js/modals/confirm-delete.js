/* Modale de confirmation d'une action irréversible.

   Générique : l'appelant fournit le libellé, le nom de l'élément visé, la liste
   de ce qui va se passer et la fonction qui exécute réellement l'action.
   Voir delete-document.js pour un exemple d'utilisation.

   Les valeurs par défaut sont celles d'une suppression — c'est le cas le plus
   fréquent. Une action qui ne détruit rien (marquer une procédure obsolète)
   passe ses propres libellés et son propre ton : l'encart ne doit pas annoncer
   une destruction là où la ligne est conservée. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  /* options : {
       title,           titre de la modale
       target,          nom de l'élément visé, affiché en évidence
       intro,           phrase d'introduction, « Confirmez la suppression de »
                        par défaut ; le nom visé la termine
       noteTitle,       titre de l'encart, « Cette action est définitive. »
       consequences,    tableau de phrases (HTML déjà échappé par l'appelant)
       tone,            'danger' (défaut) ou 'warning' : couleur de l'encart et
                        du bouton de confirmation
       confirmLabel,    libellé du bouton, « Supprimer » par défaut
       confirmIcon,     icône du bouton, « trash » par défaut
       busyLabel,       libellé pendant l'appel, « Suppression… » par défaut
       run,             function () -> Promise, l'action elle-même
       onDeleted        appelée après succès, avec la valeur renvoyée par run
     } */
  function open(options) {
    var busy = false;
    var consequences = options.consequences || [];
    var warning = options.tone === 'warning';
    var confirmLabel = options.confirmLabel || 'Supprimer';
    var confirmIcon = options.confirmIcon || 'trash';
    var busyLabel = options.busyLabel || 'Suppression…';

    var modal = h.openModal('' +
      '<h3>' + esc(options.title) + '</h3>' +
      '<p class="dialog-sub">' +
        esc(options.intro || 'Confirmez la suppression de') + ' ' +
        '<span class="dialog-target" dir="auto">' + esc(options.target) + '</span>.' +
      '</p>' +
      '<div id="delete-error"></div>' +
      '<div class="info-note ' + (warning ? 'is-warning' : 'is-danger') + '">' + icon('alert') +
        '<div>' +
          '<div class="note-title">' +
            esc(options.noteTitle || 'Cette action est définitive.') + '</div>' +
          '<ul class="note-list">' +
            consequences.map(function (line) { return '<li>' + line + '</li>'; }).join('') +
          '</ul>' +
        '</div>' +
      '</div>' +
      '<div class="dialog-actions">' +
        '<button type="button" data-action="cancel">Annuler</button>' +
        '<button type="button" class="' + (warning ? 'btn-warning' : 'btn-danger') + '" ' +
          'data-action="confirm">' +
          icon(confirmIcon) + esc(confirmLabel) + '</button>' +
      '</div>',
      { canClose: function () { return !busy; } }
    );

    var dialog = modal.dialog;
    var errorBox = dialog.querySelector('#delete-error');
    var confirmButton = dialog.querySelector('[data-action="confirm"]');
    var cancelButton = dialog.querySelector('[data-action="cancel"]');

    // Le bouton dangereux ne doit pas être celui qu'on active par inertie.
    cancelButton.focus();

    function showError(message) {
      errorBox.innerHTML = message
        ? '<div class="inline-error">' + icon('alert') + '<span>' + esc(message) + '</span></div>'
        : '';
    }

    function confirm() {
      if (busy) return;
      busy = true;
      confirmButton.disabled = true;
      cancelButton.disabled = true;
      confirmButton.textContent = busyLabel;
      showError('');

      Promise.resolve().then(options.run).then(function (result) {
        busy = false;
        modal.close();
        // Le résultat est transmis tel quel : l'appelant y lit par exemple le
        // nombre de citoyens concernés.
        if (options.onDeleted) options.onDeleted(result);
      }).catch(function (error) {
        busy = false;
        confirmButton.disabled = false;
        cancelButton.disabled = false;
        confirmButton.innerHTML = icon(confirmIcon) + esc(confirmLabel);
        showError(error.message);
      });
    }

    h.on(dialog, 'click', '[data-action]', function (event, target) {
      var action = target.getAttribute('data-action');
      if (action === 'cancel') modal.requestClose();
      else if (action === 'confirm') confirm();
    });
  }

  App.modals = App.modals || {};
  /* Deux noms, une seule modale : « confirmDelete » pour les suppressions,
     qui n'ont rien à configurer, « confirm » quand l'action est autre. */
  App.modals.confirmDelete = open;
  App.modals.confirm = open;
})(window);
