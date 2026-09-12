/* Écran 1 — Liste des documents et des imports. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  var STATUS = {
    published:  { label: 'Publié',      pill: 'pill-success' },
    review:     { label: 'À vérifier',  pill: 'pill-warning' },
    extracting: { label: 'Extraction…', pill: 'pill-neutral' },
    failed:     { label: 'Échec',       pill: 'pill-danger' }
  };

  function renderSkeleton() {
    var card =
      '<div class="skeleton-card">' +
      '<div class="skeleton-line" style="width:45%"></div>' +
      '<div class="skeleton-line" style="width:25%; margin-top:8px; height:8px"></div>' +
      '<div class="skeleton-line" style="width:100%; margin-top:14px; height:28px"></div>' +
      '</div>';
    return card + card + card;
  }

  function countLabel(count) {
    if (count === null || count === undefined || isNaN(count)) return '';
    return h.plural(count, 'procédure');
  }

  // Bouton de suppression : meme appel pour un document et pour un import
  // direct, tous deux exposes par /admin/documents.
  function deleteButton(doc) {
    var label = 'Supprimer ' + (doc.title || doc.filename);
    return '<button type="button" class="icon-btn doc-delete" data-action="delete-document" ' +
      'data-id="' + esc(doc.id) + '" ' +
      'title="Supprimer" aria-label="' + esc(label) + '">' + icon('trash') + '</button>';
  }

  function renderImportCard(doc) {
    var status = STATUS[doc.status] || STATUS.review;
    var extractionId = doc.extraction && doc.extraction.id ? doc.extraction.id : doc.id;
    var count = doc.extraction ? doc.extraction.count : null;
    var meta = 'Importé le ' + esc(h.formatDate(doc.uploadedAt));
    var countText = countLabel(count);
    if (countText) meta += ' · ' + esc(countText);

    return '' +
      '<div class="doc-card ' + (doc.status === 'review' ? 'is-review' : '') +
      (doc.status === 'failed' ? ' is-failed' : '') + '">' +
        '<div class="doc-row">' +
        '<button type="button" class="doc-head as-button" data-action="open-extraction" ' +
          'data-id="' + esc(extractionId) + '">' +
          icon('braces', 'icon-lg doc-icon') +
          '<span class="doc-meta">' +
            '<span class="doc-name mono">' +
              '<span dir="auto">' + esc(doc.filename) + '</span>' +
              '<span class="badge-direct">Import direct</span></span>' +
            '<span class="doc-date">' + meta + '</span>' +
          '</span>' +
          '<span class="pill ' + status.pill + '">' + status.label + '</span>' +
          icon('chevron-right', 'chevron') +
        '</button>' +
        deleteButton(doc) +
        '</div>' +
      '</div>';
  }

  function renderDocumentCard(doc) {
    var status = STATUS[doc.status] || STATUS.review;
    var cardClass = 'doc-card';
    if (doc.status === 'review') cardClass += ' is-review';
    if (doc.status === 'failed') cardClass += ' is-failed';

    var head = '' +
      '<div class="doc-head">' +
        icon('file-text', 'icon-lg doc-icon') +
        '<div class="doc-meta">' +
          // Le titre saisi par l'admin prime sur le nom de fichier : c'est la
          // ou une notation arabe est attendue, meme sur un fichier au nom latin.
          '<div class="doc-name" dir="auto">' + esc(doc.title || doc.filename) + '</div>' +
          '<div class="doc-date">' +
            (doc.title ? '<span class="doc-file" dir="auto">' + esc(doc.filename) + '</span> · ' : '') +
            'Importé le ' + esc(h.formatDate(doc.uploadedAt)) +
          '</div>' +
        '</div>' +
        '<span class="pill ' + status.pill + '">' + status.label + '</span>' +
        deleteButton(doc) +
      '</div>';

    var body;
    if (doc.status === 'extracting') {
      body =
        '<div class="progress-block">' +
          '<div class="progress-track"><div class="progress-bar"></div></div>' +
          '<div class="progress-label">Le LLM analyse le document…</div>' +
        '</div>';
    } else if (doc.status === 'failed') {
      body = '<div class="doc-error" dir="auto">' +
        esc(doc.error || 'L\'extraction a échoué. Réimportez le document pour réessayer.') +
        '</div>';
    } else if (doc.extraction && doc.extraction.id) {
      var countText = countLabel(doc.extraction.count);
      body =
        '<button type="button" class="json-row ' + (doc.status === 'review' ? 'is-review' : '') + '" ' +
          'data-action="open-extraction" data-id="' + esc(doc.extraction.id) + '">' +
          icon('code', 'json-icon') +
          '<span class="json-name" dir="auto">' + esc(doc.extraction.filename) + '</span>' +
          (countText ? '<span class="json-count">' + esc(countText) + '</span>' : '') +
          icon('chevron-right') +
        '</button>';
    } else {
      body = '<div class="doc-error" style="color:var(--text-muted)">' +
        'Aucun fichier JSON associé.</div>';
    }

    return '<div class="' + cardClass + '">' + head + body + '</div>';
  }

  function renderList(documents) {
    if (!documents.length) {
      return '<div class="state-block">' +
        '<div class="state-title">Aucun document pour le moment</div>' +
        '<div>Importez un document officiel ou un fichier JSON de procédures pour commencer.</div>' +
        '</div>';
    }
    return documents.map(function (doc) {
      return doc.kind === 'import' ? renderImportCard(doc) : renderDocumentCard(doc);
    }).join('');
  }

  function mount(root) {
    // On travaille dans un conteneur propre : les écouteurs délégués sont posés
    // dessus et disparaissent avec lui au changement d'écran.
    var view = document.createElement('div');
    root.appendChild(view);

    view.innerHTML = '' +
      '<div class="screen-header">' +
        '<div>' +
          '<h1>Documents et extractions</h1>' +
          '<p class="subtitle">Chaque document importé produit un fichier JSON à vérifier</p>' +
        '</div>' +
        '<div class="header-actions">' +
          '<button type="button" data-action="upload-document">' +
            icon('upload') + 'Importer un document</button>' +
          '<button type="button" class="btn-primary" data-action="import-json">' +
            icon('braces') + 'Importer un JSON</button>' +
        '</div>' +
      '</div>' +
      '<div id="documents-list">' + renderSkeleton() + '</div>';

    var listNode = view.querySelector('#documents-list');
    var pollTimer = null;
    var destroyed = false;
    var loadedOnce = false;
    // Dernière liste rendue : les modales ont besoin de l'objet complet, pas
    // seulement de l'identifiant porté par le bouton.
    var documents = [];

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function schedulePolling(documents) {
      var busy = documents.some(function (doc) { return doc.status === 'extracting'; });
      if (busy && !pollTimer) {
        pollTimer = setInterval(function () { load(true); }, App.config.POLL_INTERVAL_MS);
      } else if (!busy) {
        stopPolling();
      }
    }

    function renderError(message) {
      listNode.innerHTML =
        '<div class="state-block error">' +
          '<div class="state-title">Chargement impossible</div>' +
          '<div>' + esc(message) + '</div>' +
          '<div class="state-actions">' +
            '<button type="button" data-action="retry">' + icon('refresh') + 'Réessayer</button>' +
          '</div>' +
        '</div>';
    }

    function load(silent) {
      if (destroyed) return;
      if (!silent && loadedOnce) listNode.setAttribute('aria-busy', 'true');
      return App.api.listDocuments().then(function (list) {
        if (destroyed) return;
        documents = list;
        loadedOnce = true;
        listNode.removeAttribute('aria-busy');
        listNode.innerHTML = renderList(list);
        schedulePolling(list);
      }).catch(function (error) {
        if (destroyed) return;
        listNode.removeAttribute('aria-busy');
        stopPolling();
        if (silent) {
          // Échec pendant le sondage : on prévient sans effacer la liste affichée.
          h.toast('Actualisation impossible : ' + error.message, 'error');
        } else {
          renderError(error.message);
        }
      });
    }

    function removeDocument(target) {
      var id = target.getAttribute('data-id');
      var doc = documents.filter(function (item) {
        return String(item.id) === String(id);
      })[0];
      if (!doc) return;

      App.modals.deleteDocument({
        document: doc,
        onDeleted: function () {
          h.toast('« ' + h.isolate(doc.title || doc.filename) + ' » a été supprimé.');
          load(true);
        }
      });
    }

    h.on(view, 'click', '[data-action]', function (event, target) {
      var action = target.getAttribute('data-action');
      if (action === 'upload-document') {
        App.modals.uploadDocument({ onDone: function () { load(); } });
      } else if (action === 'import-json') {
        App.modals.importJson();
      } else if (action === 'open-extraction') {
        App.router.navigate('#/extractions/' + encodeURIComponent(target.getAttribute('data-id')));
      } else if (action === 'delete-document') {
        removeDocument(target);
      } else if (action === 'retry') {
        listNode.innerHTML = renderSkeleton();
        load();
      }
    });

    load();

    var screen = {
      refresh: function () { return load(); },
      destroy: function () {
        destroyed = true;
        stopPolling();
        App.screens.documents.current = null;
      }
    };
    App.screens.documents.current = screen;
    return screen;
  }

  App.screens = App.screens || {};
  App.screens.documents = {
    mount: mount,
    current: null,
    // Permet aux modales de rafraîchir la liste si elle est à l'écran.
    refresh: function () {
      if (App.screens.documents.current) App.screens.documents.current.refresh();
    }
  };
})(window);
