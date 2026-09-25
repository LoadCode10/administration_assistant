/* Écran 5 — Modale de confirmation « Approuver l'extraction ». */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  /* Statistiques calculées côté client à partir des données éditées.

     Les valeurs éditées sont des paires { fr, ar } : on compte une ligne dès
     que l'une des deux langues porte du texte, et les administrations sont
     dédoublonnées sur leur nom français — le seul des deux que le backend
     utilise pour rapprocher deux imports. */
  function filled(pair) {
    if (pair === null || pair === undefined) return false;
    if (typeof pair !== 'object') return String(pair).trim().length > 0;
    return String(pair.fr || '').trim().length > 0 ||
      String(pair.ar || '').trim().length > 0;
  }

  function computeSummary(procedures) {
    var administrations = {};
    var pieces = 0;
    var steps = 0;

    procedures.forEach(function (procedure) {
      var first = (procedure.proc_administration || [])[0];
      var administration = first && typeof first === 'object'
        ? String(first.fr || first.ar || '').trim()
        : String(first || '').trim();
      if (administration) administrations[administration.toLowerCase()] = true;
      pieces += (procedure.proc_pieces || []).filter(filled).length;
      steps += (procedure.proc_steps || []).filter(filled).length;
    });

    return {
      procedures: procedures.length,
      administrations: Object.keys(administrations).length,
      pieces: pieces,
      steps: steps
    };
  }

  function open(options) {
    var summary = computeSummary(options.procedures);
    var busy = false;

    var modal = h.openModal('' +
      '<h3>Approuver l\'extraction</h3>' +
      '<p class="dialog-sub">Ces procédures seront enregistrées et indexées pour la recherche.</p>' +
      '<div id="approve-error"></div>' +
      '<div class="summary-box">' +
        row('Procédures', summary.procedures) +
        row('Nouvelles administrations', summary.administrations) +
        row('Documents requis', summary.pieces) +
        row('Étapes', summary.steps) +
      '</div>' +
      '<div class="info-note">' + icon('sparkles') +
        '<span>L\'indexation vectorielle démarre après l\'enregistrement et prend quelques secondes.</span></div>' +
      '<div id="approve-progress"></div>' +
      '<div class="dialog-actions">' +
        '<button type="button" data-action="cancel">Annuler</button>' +
        '<button type="button" class="btn-primary" data-action="confirm">Approuver</button>' +
      '</div>',
      { canClose: function () { return !busy; } }
    );

    var dialog = modal.dialog;
    var errorBox = dialog.querySelector('#approve-error');
    var progressBox = dialog.querySelector('#approve-progress');
    var confirmButton = dialog.querySelector('[data-action="confirm"]');
    var cancelButton = dialog.querySelector('[data-action="cancel"]');

    function showError(message) {
      errorBox.innerHTML = message
        ? '<div class="inline-error">' + icon('alert') + '<span>' + esc(message) + '</span></div>'
        : '';
    }

    function showProgress(on) {
      progressBox.innerHTML = on
        ? '<div class="progress-block" style="margin:0 0 4px">' +
            '<div class="progress-track"><div class="progress-bar"></div></div>' +
            '<div class="progress-label">Enregistrement et indexation en cours… ne fermez pas cette fenêtre.</div>' +
          '</div>'
        : '';
    }

    function confirm() {
      if (busy) return;
      busy = true;
      confirmButton.disabled = true;
      cancelButton.disabled = true;
      confirmButton.textContent = 'Enregistrement…';
      showError('');
      showProgress(true);

      // On enregistre d'abord les modifications, puis on approuve.
      App.api.saveExtraction(options.extractionId, options.procedures)
        .then(function () {
          return App.api.approveExtraction(options.extractionId);
        })
        .then(function () {
          busy = false;
          modal.close();
          if (options.onApproved) options.onApproved();
        })
        .catch(function (error) {
          busy = false;
          confirmButton.disabled = false;
          cancelButton.disabled = false;
          confirmButton.textContent = 'Approuver';
          showProgress(false);
          showError(error.message);
          // L'editeur surligne le champ refuse par un 422 ; la modale reste
          // ouverte, avec le message qui le nomme.
          if (options.onError) options.onError(error);
        });
    }

    h.on(dialog, 'click', '[data-action]', function (event, target) {
      var action = target.getAttribute('data-action');
      if (action === 'cancel') modal.requestClose();
      else if (action === 'confirm') confirm();
    });
  }

  function row(label, value) {
    return '<div class="summary-row"><span class="summary-key">' + esc(label) + '</span>' +
      '<span>' + esc(value) + '</span></div>';
  }

  App.modals = App.modals || {};
  App.modals.approve = open;
  App.modals.computeApproveSummary = computeSummary;
})(window);
