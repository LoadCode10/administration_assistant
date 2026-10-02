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

    function showProgress(on, label) {
      progressBox.innerHTML = on
        ? '<div class="progress-block" style="margin:0 0 4px">' +
            '<div class="progress-track"><div class="progress-bar"></div></div>' +
            '<div class="progress-label">' + esc(label ||
              'Enregistrement et indexation en cours… ne fermez pas cette fenêtre.') + '</div>' +
          '</div>'
        : '';
    }

    /* Verrouille la modale et le bouton « Approuver et enregistrer » de
       l'editeur : deux approbations simultanees enregistreraient deux fois
       les memes procedures. */
    function setBusy(on) {
      busy = on;
      confirmButton.disabled = on;
      cancelButton.disabled = on;
      confirmButton.textContent = on ? 'Enregistrement…' : 'Approuver';
      if (options.onBusyChange) options.onBusyChange(on);
    }

    // type : « success », ou « info » quand l'extraction l'etait deja.
    function succeed(message, type) {
      setBusy(false);
      modal.close();
      if (options.onApproved) options.onApproved(message, type || 'success');
    }

    function fail(error) {
      setBusy(false);
      showProgress(false);
      showError(error.message);
      // L'editeur surligne le champ refuse par un 422 ; la modale reste
      // ouverte, avec le message qui le nomme.
      if (options.onError) options.onError(error);
    }

    function wait(ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    /* 502/503/504 sur l'approbation : c'est le proxy qui a abandonne, pas
       forcement le serveur. On relit le statut deux fois, a quelques secondes
       d'intervalle, avant de conclure a un echec. */
    function verifyAfterTimeout(error) {
      showProgress(true, 'Le serveur met trop de temps à répondre. ' +
        'L\'enregistrement continue peut-être : vérification en cours…');

      function attempt(remaining) {
        return wait(4000)
          .then(function () { return App.api.getExtractionStatus(options.extractionId); })
          .catch(function () { return ''; })
          .then(function (status) {
            if (status === 'approved') {
              succeed('Procédures enregistrées. Le nombre exact n\'a pas pu être récupéré ; ' +
                'l\'indexation pour la recherche se termine en arrière-plan.');
            } else if (remaining > 1) {
              return attempt(remaining - 1);
            } else {
              fail(error);
            }
          });
      }
      return attempt(2);
    }

    /* 409 « Extraction déjà traitée » : le plus souvent, une approbation
       precedente a abouti (apres un delai depasse, par exemple). On le
       confirme par le statut avant de le presenter comme tel. */
    function handleConflict(error) {
      return App.api.getExtractionStatus(options.extractionId)
        .catch(function () { return 'approved'; })
        .then(function (status) {
          if (status === 'approved') {
            succeed('Cette extraction est déjà approuvée : ses procédures sont enregistrées.', 'info');
          } else {
            fail(error);
          }
        });
    }

    function successMessage(result) {
      var text = h.plural(result.created, 'procédure') +
        (result.created >= 2 ? ' enregistrées' : ' enregistrée');
      if (result.skipped > 0) {
        text += ', ' + result.skipped + (result.skipped >= 2 ? ' ignorées (doublons)' : ' ignorée (doublon)');
      }
      return text + '. L\'indexation pour la recherche se termine en arrière-plan.';
    }

    function confirm() {
      if (busy) return;
      setBusy(true);
      showError('');
      showProgress(true);

      var approving = false;
      // On enregistre d'abord les modifications, puis on approuve.
      App.api.saveExtraction(options.extractionId, options.procedures)
        .then(function () {
          approving = true;
          return App.api.approveExtraction(options.extractionId);
        })
        .then(function (result) {
          succeed(successMessage(result));
        })
        .catch(function (error) {
          // Le PUT d'enregistrement renvoie lui aussi 409 une fois l'extraction
          // approuvee : meme conclusion dans les deux cas.
          if (error && error.status === 409) return handleConflict(error);
          if (approving && error && error.gateway) return verifyAfterTimeout(error);
          fail(error);
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
