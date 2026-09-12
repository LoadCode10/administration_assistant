/* Écran 4 — Éditeur JSON (vérification avant enregistrement). */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  var LISTS = {
    pieces: { key: 'proc_pieces', label: 'Documents requis', add: 'Ajouter un document', numbered: false },
    steps:  { key: 'proc_steps',  label: 'Étapes',           add: 'Ajouter une étape',   numbered: true },
    law:    { key: 'proc_law',    label: 'Textes de loi',    add: 'Ajouter un texte de loi', numbered: false }
  };

  function isMissingAdministration(procedure) {
    var admin = procedure.proc_administration && procedure.proc_administration[0];
    return !String(admin || '').trim();
  }

  function summaryText(procedure) {
    if (isMissingAdministration(procedure)) return 'Administration manquante';
    return h.plural((procedure.proc_pieces || []).length, 'document');
  }

  function mount(root, params) {
    var extractionId = params.id;

    var state = {
      filename: '',
      status: 'review',
      error: null,
      procedures: [],
      openIndex: -1,
      page: 0,
      dirty: false,
      showRaw: false,
      saving: false
    };

    root.innerHTML = '<div id="editor-shell">' + renderLoading() + '</div>';
    var shell = root.querySelector('#editor-shell');

    function renderLoading() {
      return '<div class="state-block"><div class="state-title">Chargement du fichier…</div>' +
        '<div>Récupération des procédures extraites.</div></div>';
    }

    /* --- Modifications ---------------------------------------------------- */

    function markDirty() {
      // Rien n'est enregistrable ici : on n'arme pas la garde de navigation.
      if (isLocked()) return;
      state.dirty = true;
      App.state.hasUnsavedChanges = true;
      updateFooter();
    }

    function clearDirty() {
      state.dirty = false;
      App.state.hasUnsavedChanges = false;
      updateFooter();
    }

    /* Une extraction deja approuvee ou en echec est consultable mais figee :
       ni edition, ni suivi des modifications, ni boutons d'enregistrement. */
    function isLocked() {
      return state.status !== 'review';
    }

    function lockedAttr() {
      return isLocked() ? ' disabled' : '';
    }

    /* --- Rendu ------------------------------------------------------------- */

    function pageCount() {
      var size = App.config.EDITOR_PAGE_SIZE;
      if (state.procedures.length <= size) return 1;
      return Math.ceil(state.procedures.length / size);
    }

    function pageBounds() {
      if (pageCount() === 1) return { start: 0, end: state.procedures.length };
      var size = App.config.EDITOR_PAGE_SIZE;
      var start = state.page * size;
      return { start: start, end: Math.min(start + size, state.procedures.length) };
    }

    function invalidCount() {
      return state.procedures.filter(isMissingAdministration).length;
    }

    function renderListItems(procedure, index, kind) {
      var spec = LISTS[kind];
      var items = procedure[spec.key] || [];
      if (!items.length) {
        return '<div class="list-empty">Aucun élément.</div>';
      }
      return items.map(function (value, itemIndex) {
        return '<div class="list-item">' +
          (spec.numbered ? '<span class="step-num">' + (itemIndex + 1) + '.</span>' : '') +
          '<input type="text" dir="auto" value="' + esc(value) + '" ' +
            'data-field="list" data-kind="' + kind + '" data-index="' + index + '" ' +
            'data-item="' + itemIndex + '" aria-label="' + esc(spec.label) + ' ' + (itemIndex + 1) + '"' +
            lockedAttr() + '>' +
          '<button type="button" class="icon-btn" data-action="remove-item" data-kind="' + kind + '" ' +
            'data-index="' + index + '" data-item="' + itemIndex + '" ' +
            'aria-label="Supprimer cet élément"' + lockedAttr() + '>' + icon('trash', 'icon-sm') + '</button>' +
          '</div>';
      }).join('');
    }

    function renderListBlock(procedure, index, kind) {
      var spec = LISTS[kind];
      return '<div class="field-group">' +
        '<label class="field-label">' + spec.label + '</label>' +
        '<div data-list-body="' + kind + '">' + renderListItems(procedure, index, kind) + '</div>' +
        '<button type="button" class="link-action" data-action="add-item" data-kind="' + kind + '" ' +
          'data-index="' + index + '"' + lockedAttr() + '>' + icon('plus', 'icon-sm') + spec.add + '</button>' +
        '</div>';
    }

    function renderBody(procedure, index) {
      var missing = isMissingAdministration(procedure);
      return '<div class="proc-body">' +
        '<div class="field-group">' +
          '<label class="field-label" for="title-' + index + '">Titre</label>' +
          '<input type="text" dir="auto" id="title-' + index + '" data-field="proc_title" data-index="' + index + '" ' +
            'value="' + esc(procedure.proc_title) + '"' + lockedAttr() + '>' +
        '</div>' +
        '<div class="field-group">' +
          '<label class="field-label" for="desc-' + index + '">Description</label>' +
          '<textarea dir="auto" id="desc-' + index + '" data-field="proc_description" data-index="' + index + '" ' +
            'placeholder="Résumé court de la procédure"' + lockedAttr() + '>' +
            esc(procedure.proc_description) + '</textarea>' +
        '</div>' +
        '<div class="field-group three-col">' +
          '<div>' +
            '<label class="field-label" for="admin-' + index + '">Administration</label>' +
            '<input type="text" dir="auto" id="admin-' + index + '" data-field="proc_administration" data-index="' + index + '" ' +
              'class="' + (missing ? 'is-invalid' : '') + '" ' +
              'value="' + esc(procedure.proc_administration[0] || '') + '"' + lockedAttr() + '>' +
            '<div class="field-warning" data-admin-warning style="' + (missing ? '' : 'display:none') + '">' +
              'Administration manquante</div>' +
          '</div>' +
          '<div>' +
            '<label class="field-label" for="fee-' + index + '">Frais</label>' +
            '<input type="text" dir="auto" id="fee-' + index + '" data-field="fee" data-index="' + index + '" ' +
              'placeholder="Non spécifié" value="' + esc(procedure.fee) + '"' + lockedAttr() + '>' +
          '</div>' +
          '<div>' +
            '<label class="field-label" for="delai-' + index + '">Délai</label>' +
            '<input type="text" dir="auto" id="delai-' + index + '" data-field="proc_delai" data-index="' + index + '" ' +
              'placeholder="Non spécifié" value="' + esc(procedure.proc_delai) + '"' + lockedAttr() + '>' +
          '</div>' +
        '</div>' +
        renderListBlock(procedure, index, 'pieces') +
        renderListBlock(procedure, index, 'steps') +
        renderListBlock(procedure, index, 'law') +
        '</div>';
    }

    function renderCard(procedure, index) {
      var open = state.openIndex === index;
      var missing = isMissingAdministration(procedure);
      var classes = 'proc-card' + (open ? ' is-open' : '') + (missing ? ' is-invalid' : '');
      var title = procedure.proc_title.trim() || 'Procédure sans titre';

      return '<div class="' + classes + '" data-card="' + index + '">' +
        '<div class="proc-row">' +
          '<button type="button" class="proc-toggle" data-action="toggle" data-index="' + index + '" ' +
            'aria-expanded="' + open + '">' +
            icon(open ? 'chevron-down' : 'chevron-right') +
            '<span class="proc-title-text" dir="auto">' + esc(title) + '</span>' +
          '</button>' +
          '<span class="proc-summary">' + esc(summaryText(procedure)) + '</span>' +
          (isLocked() ? '' :
            '<button type="button" class="icon-btn" data-action="delete-proc" data-index="' + index + '" ' +
              'aria-label="Supprimer la procédure">' + icon('trash') + '</button>') +
        '</div>' +
        (open ? renderBody(procedure, index) : '') +
        '</div>';
    }

    function renderPager() {
      var total = pageCount();
      if (total === 1) return '';
      var bounds = pageBounds();
      return '<div class="pager">' +
        '<button type="button" data-action="prev-page"' + (state.page === 0 ? ' disabled' : '') + '>Précédent</button>' +
        '<span>Procédures ' + (bounds.start + 1) + '–' + bounds.end + ' sur ' + state.procedures.length +
          ' · page ' + (state.page + 1) + ' / ' + total + '</span>' +
        '<button type="button" data-action="next-page"' + (state.page >= total - 1 ? ' disabled' : '') + '>Suivant</button>' +
        '</div>';
    }

    function renderCards() {
      if (!state.procedures.length) {
        return '<div class="state-block">' +
          '<div class="state-title">Ce fichier ne contient aucune procédure</div>' +
          '<div>Toutes les procédures ont été supprimées. Rien ne sera enregistré.</div>' +
          '</div>';
      }
      var bounds = pageBounds();
      var out = '';
      for (var i = bounds.start; i < bounds.end; i++) {
        out += renderCard(state.procedures[i], i);
      }
      return renderPager() + out + renderPager();
    }

    function footerMarkup() {
      // Extraction deja approuvee : plus rien a enregistrer.
      if (state.status === 'published') {
        return '<span class="footer-count">' +
          'Cette extraction a déjà été approuvée. Les procédures sont enregistrées.' +
          '</span>';
      }
      // Extraction en echec : on affiche la raison, sans action possible.
      if (state.status === 'failed') {
        return '<span class="footer-count footer-blocked">' +
          esc(state.error || 'L\'extraction a échoué.') + '</span>';
      }

      var invalid = invalidCount();
      var countText = h.plural(state.procedures.length, 'procédure') +
        (state.procedures.length >= 2 ? ' seront enregistrées' : ' sera enregistrée');
      var text = invalid
        ? h.plural(invalid, 'procédure') + ' à corriger avant l\'enregistrement'
        : countText;
      var blocked = invalid > 0 || !state.procedures.length;

      return '<span class="footer-count ' + (invalid ? 'footer-blocked' : '') + '">' +
          esc(text) + (state.dirty ? ' · modifications non enregistrées' : '') + '</span>' +
        '<button type="button" data-action="save-draft"' + (state.saving ? ' disabled' : '') + '>' +
          'Enregistrer le brouillon</button>' +
        '<button type="button" class="btn-primary" data-action="approve"' +
          (blocked || state.saving ? ' disabled' : '') + '>' +
          icon('check') + 'Approuver et enregistrer</button>';
    }

    function updateFooter() {
      var footer = shell.querySelector('#editor-footer');
      if (footer) footer.innerHTML = footerMarkup();
    }

    function renderRaw() {
      if (!state.showRaw) return '';
      var payload = state.procedures.map(App.api.serializeProcedure);
      // dir="ltr" explicite : les accolades et virgules doivent rester a leur
      // place meme quand toutes les valeurs sont arabes.
      return '<pre class="raw-json" dir="ltr" tabindex="0">' +
        esc(JSON.stringify(payload, null, 2)) + '</pre>';
    }

    function renderAll() {
      shell.innerHTML = '' +
        '<button type="button" class="back-link" data-action="back">' +
          icon('arrow-left') + '<span dir="auto">' + esc(state.filename) + '</span></button>' +
        '<div class="screen-header" style="margin-bottom:14px">' +
          '<h1>Vérifier avant enregistrement</h1>' +
          '<button type="button" class="btn-quiet" data-action="toggle-raw">' +
            icon('code') + (state.showRaw ? 'Masquer le JSON brut' : 'Voir le JSON brut') + '</button>' +
        '</div>' +
        '<div id="raw-block">' + renderRaw() + '</div>' +
        '<div id="proc-list">' + renderCards() + '</div>' +
        '<div class="editor-footer" id="editor-footer">' + footerMarkup() + '</div>';
    }

    function renderCardsOnly() {
      var list = shell.querySelector('#proc-list');
      if (list) list.innerHTML = renderCards();
      var raw = shell.querySelector('#raw-block');
      if (raw) raw.innerHTML = renderRaw();
      updateFooter();
    }

    /* --- Interactions ------------------------------------------------------ */

    function currentCard(index) {
      return shell.querySelector('[data-card="' + index + '"]');
    }

    function refreshRowState(index) {
      var card = currentCard(index);
      if (!card) return;
      var procedure = state.procedures[index];
      var missing = isMissingAdministration(procedure);
      card.classList.toggle('is-invalid', missing);
      card.querySelector('.proc-title-text').textContent =
        procedure.proc_title.trim() || 'Procédure sans titre';
      card.querySelector('.proc-summary').textContent = summaryText(procedure);
      var adminInput = card.querySelector('[data-field="proc_administration"]');
      if (adminInput) adminInput.classList.toggle('is-invalid', missing);
      var warning = card.querySelector('[data-admin-warning]');
      if (warning) warning.style.display = missing ? '' : 'none';
      var raw = shell.querySelector('#raw-block');
      if (raw && state.showRaw) raw.innerHTML = renderRaw();
      updateFooter();
    }

    function redrawList(index, kind, focusItem) {
      var procedure = state.procedures[index];
      var card = currentCard(index);
      if (!card) return renderCardsOnly();
      var body = card.querySelector('[data-list-body="' + kind + '"]');
      if (!body) return renderCardsOnly();
      body.innerHTML = renderListItems(procedure, index, kind);
      refreshRowState(index);
      if (focusItem !== undefined) {
        var input = body.querySelector('[data-item="' + focusItem + '"]');
        if (input) input.focus();
      }
    }

    shell.addEventListener('input', function (event) {
      var target = event.target;
      var field = target.getAttribute && target.getAttribute('data-field');
      if (!field) return;
      var index = Number(target.getAttribute('data-index'));
      var procedure = state.procedures[index];
      if (!procedure) return;

      if (field === 'list') {
        var kind = target.getAttribute('data-kind');
        var itemIndex = Number(target.getAttribute('data-item'));
        procedure[LISTS[kind].key][itemIndex] = target.value;
      } else if (field === 'proc_administration') {
        procedure.proc_administration[0] = target.value;
      } else {
        procedure[field] = target.value;
      }
      markDirty();
      refreshRowState(index);
    });

    h.on(shell, 'click', '[data-action]', function (event, target) {
      var action = target.getAttribute('data-action');
      var index = Number(target.getAttribute('data-index'));

      if (action === 'back') {
        App.router.navigate('#/documents');

      } else if (action === 'toggle-raw') {
        state.showRaw = !state.showRaw;
        renderAll();

      } else if (action === 'toggle') {
        state.openIndex = state.openIndex === index ? -1 : index;
        renderCardsOnly();
        var opened = currentCard(state.openIndex);
        if (opened) {
          var first = opened.querySelector('.proc-body input');
          if (first) first.focus();
        }

      } else if (action === 'delete-proc') {
        var title = state.procedures[index].proc_title.trim() || 'cette procédure';
        if (!global.confirm('Supprimer « ' + h.isolate(title) + ' » du fichier ?\n\n' +
          'La suppression ne sera définitive qu\'après enregistrement.')) return;
        state.procedures.splice(index, 1);
        if (state.openIndex === index) state.openIndex = -1;
        else if (state.openIndex > index) state.openIndex -= 1;
        if (state.page >= pageCount()) state.page = Math.max(0, pageCount() - 1);
        markDirty();
        renderCardsOnly();

      } else if (action === 'add-item') {
        var addKind = target.getAttribute('data-kind');
        var list = state.procedures[index][LISTS[addKind].key];
        list.push('');
        markDirty();
        redrawList(index, addKind, list.length - 1);

      } else if (action === 'remove-item') {
        var removeKind = target.getAttribute('data-kind');
        var itemIndex = Number(target.getAttribute('data-item'));
        state.procedures[index][LISTS[removeKind].key].splice(itemIndex, 1);
        markDirty();
        redrawList(index, removeKind);

      } else if (action === 'prev-page' || action === 'next-page') {
        state.page += (action === 'next-page' ? 1 : -1);
        state.page = Math.max(0, Math.min(state.page, pageCount() - 1));
        state.openIndex = -1;
        renderCardsOnly();
        global.scrollTo(0, 0);

      } else if (action === 'save-draft') {
        saveDraft();

      } else if (action === 'approve') {
        openApproveModal();

      } else if (action === 'retry-load') {
        load();
      }
    });

    /* --- Requêtes ---------------------------------------------------------- */

    function saveDraft() {
      if (state.saving) return Promise.resolve(false);
      state.saving = true;
      updateFooter();
      return App.api.saveExtraction(extractionId, state.procedures).then(function () {
        state.saving = false;
        clearDirty();
        h.toast('Brouillon enregistré.', 'success');
        return true;
      }).catch(function (error) {
        state.saving = false;
        updateFooter();
        h.toast('Enregistrement impossible : ' + error.message, 'error');
        return false;
      });
    }

    function openApproveModal() {
      App.modals.approve({
        extractionId: extractionId,
        procedures: state.procedures,
        onApproved: function () {
          clearDirty();
          h.toast('Procédures enregistrées et mises en file d\'indexation.', 'success');
          App.router.navigate('#/documents');
        }
      });
    }

    function load() {
      shell.innerHTML = renderLoading();
      App.api.getExtraction(extractionId).then(function (extraction) {
        state.filename = extraction.filename;
        state.status = extraction.status;
        state.error = extraction.error;
        state.procedures = extraction.procedures;
        state.openIndex = -1;
        state.page = 0;
        clearDirty();
        renderAll();
      }).catch(function (error) {
        shell.innerHTML =
          '<button type="button" class="back-link" data-action="back">' +
            icon('arrow-left') + 'Retour aux documents</button>' +
          '<div class="state-block error">' +
            '<div class="state-title">Impossible d\'ouvrir ce fichier</div>' +
            '<div>' + esc(error.message) + '</div>' +
            '<div class="state-actions">' +
              '<button type="button" data-action="retry-load">' + icon('refresh') + 'Réessayer</button>' +
            '</div>' +
          '</div>';
      });
    }

    // Garde de navigation : on prévient avant de quitter avec des modifications.
    App.router.setGuard(function () {
      if (!state.dirty) return true;
      return global.confirm(
        'Des modifications ne sont pas enregistrées.\n\nQuitter cette page et les perdre ?'
      );
    });

    load();

    return {
      destroy: function () {
        App.state.hasUnsavedChanges = false;
      }
    };
  }

  App.screens = App.screens || {};
  App.screens.editor = { mount: mount };
})(window);
