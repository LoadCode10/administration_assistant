/* Écran 2 — Modale « Importer un document » (PDF ou TXT, 10 Mo max). */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  var ACCEPT = ['.pdf', '.txt'];

  function open(options) {
    options = options || {};
    var file = null;
    var busy = false;

    var modal = h.openModal('' +
      '<h3>Importer un document</h3>' +
      '<p class="dialog-sub">Le document officiel sera analysé pour en extraire les procédures.</p>' +
      '<div id="upload-error"></div>' +
      '<div class="dropzone" id="upload-zone" role="button" tabindex="0" ' +
        'aria-label="Choisir un fichier PDF ou TXT">' +
        '<div id="upload-zone-content">' +
          '<div>Glissez un fichier ici ou cliquez pour parcourir</div>' +
          '<div class="dz-hint">PDF ou TXT · 10 Mo maximum</div>' +
        '</div>' +
      '</div>' +
      '<div class="field-group">' +
        '<label class="field-label" for="upload-title">Titre du document</label>' +
        '<input type="text" dir="auto" id="upload-title" placeholder="Ex. : Guide des formalités d\'entreprise">' +
      '</div>' +
      '<div class="field-group">' +
        '<label class="field-label" for="upload-url">URL source (facultatif)</label>' +
        '<input type="url" id="upload-url" placeholder="https://…">' +
      '</div>' +
      '<div class="info-note">' + icon('sparkles') +
        '<span>L\'extraction démarre automatiquement après l\'import.</span></div>' +
      '<div class="dialog-actions">' +
        '<button type="button" data-action="cancel">Annuler</button>' +
        '<button type="button" class="btn-primary" data-action="submit" disabled>' +
          icon('upload') + 'Importer</button>' +
      '</div>',
      { canClose: function () { return !busy; } }
    );

    var dialog = modal.dialog;
    var zone = dialog.querySelector('#upload-zone');
    var zoneContent = dialog.querySelector('#upload-zone-content');
    var errorBox = dialog.querySelector('#upload-error');
    var submitButton = dialog.querySelector('[data-action="submit"]');
    var titleInput = dialog.querySelector('#upload-title');

    function showError(message) {
      errorBox.innerHTML = message
        ? '<div class="inline-error">' + icon('alert') + '<span>' + esc(message) + '</span></div>'
        : '';
    }

    h.wireDropzone(zone, {
      accept: ACCEPT,
      maxBytes: App.config.MAX_UPLOAD_BYTES,
      onError: showError,
      onFile: function (selected) {
        file = selected;
        showError('');
        zoneContent.innerHTML =
          '<div class="dz-file">' + icon('file-text') + '<span>' + esc(file.name) + '</span></div>' +
          '<div class="dz-hint">' + esc(h.formatBytes(file.size)) + ' · cliquez pour changer de fichier</div>';
        submitButton.disabled = false;
        // Pré-remplit le titre avec le nom du fichier si l'admin ne l'a pas saisi.
        if (!titleInput.value.trim()) {
          titleInput.value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
        }
      }
    });

    function submit() {
      if (!file || busy) return;
      busy = true;
      submitButton.disabled = true;
      submitButton.innerHTML = 'Import en cours…';
      showError('');

      App.api.uploadDocument({
        file: file,
        titre: titleInput.value.trim(),
        url_source: dialog.querySelector('#upload-url').value.trim()
      }).then(function () {
        busy = false;
        modal.close();
        h.toast('Document importé. L\'extraction est en cours.', 'success');
        if (options.onDone) options.onDone();
        else App.screens.documents.refresh();
      }).catch(function (error) {
        busy = false;
        submitButton.disabled = false;
        submitButton.innerHTML = icon('upload') + 'Importer';
        showError(error.message);
      });
    }

    h.on(dialog, 'click', '[data-action]', function (event, target) {
      var action = target.getAttribute('data-action');
      if (action === 'cancel') modal.requestClose();
      else if (action === 'submit') submit();
    });
  }

  App.modals = App.modals || {};
  App.modals.uploadDocument = open;
})(window);
