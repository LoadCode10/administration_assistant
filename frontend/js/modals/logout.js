/* Modale de confirmation de déconnexion.

   Le bouton vit dans la barre latérale, juste sous les entrées de navigation :
   un clic de travers est vite arrivé, d'où la confirmation. Elle sert surtout
   quand une extraction est en cours de modification — recharger la page à ce
   moment-là perd la saisie, et c'est la seule conséquence irréversible ici. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  function open() {
    var busy = false;
    // Le garde « modifications non enregistrées » est posé par l'éditeur.
    var unsaved = !!(App.state && App.state.hasUnsavedChanges);

    var modal = h.openModal('' +
      '<h3>Se déconnecter</h3>' +
      '<p class="dialog-sub">Votre session sera fermée et vous reviendrez ' +
        "à l'écran de connexion.</p>" +
      '<div id="logout-error"></div>' +
      (unsaved
        ? '<div class="info-note is-danger">' + icon('alert') +
          '<div>' +
            '<div class="note-title">Des modifications ne sont pas enregistrées.</div>' +
            '<ul class="note-list">' +
              '<li>Les changements en cours dans l\'éditeur seront perdus.</li>' +
              '<li>Enregistrez-les avant de vous déconnecter pour les conserver.</li>' +
            '</ul>' +
          '</div>' +
        '</div>'
        : '') +
      '<div class="dialog-actions">' +
        '<button type="button" data-action="cancel">Annuler</button>' +
        '<button type="button" class="' + (unsaved ? 'btn-danger' : 'btn-primary') + '" ' +
          'data-action="confirm">Se déconnecter</button>' +
      '</div>',
      { canClose: function () { return !busy; } }
    );

    var dialog = modal.dialog;
    var errorBox = dialog.querySelector('#logout-error');
    var confirmButton = dialog.querySelector('[data-action="confirm"]');
    var cancelButton = dialog.querySelector('[data-action="cancel"]');

    // Quand du travail est en jeu, le bouton par défaut n'est pas celui qui
    // le fait disparaître — même règle que la modale de suppression.
    if (unsaved) cancelButton.focus();

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
      confirmButton.textContent = 'Déconnexion…';
      showError('');

      /* Seul le serveur peut effacer le cookie HttpOnly : sans cet appel, le
         jeton resterait valable. On ne vide la session en memoire qu'une fois
         qu'il a repondu — annoncer une deconnexion qui n'a pas eu lieu serait
         pire que l'echec lui-meme. */
      App.api.logout().then(function () {
        // Le garde de sortie doit tomber AVANT la navigation, sinon le routeur
        // repose la question « modifications non enregistrées » alors que
        // l'utilisateur vient déjà de confirmer ici.
        if (App.state) App.state.hasUnsavedChanges = false;
        App.router.setGuard(null);
        modal.close();
        App.auth.clear();
        App.router.navigate(App.auth.LOGIN_ROUTE);
      }).catch(function (error) {
        // La session est peut-être toujours ouverte : on laisse la modale en
        // place plutôt que de recharger sur un échec et de faire croire à une
        // déconnexion qui n'a pas eu lieu.
        busy = false;
        confirmButton.disabled = false;
        cancelButton.disabled = false;
        confirmButton.textContent = 'Se déconnecter';
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
  App.modals.logout = open;
})(window);
