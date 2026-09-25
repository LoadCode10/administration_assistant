/* Écran 4 — Éditeur JSON (vérification avant enregistrement). */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  /* « bilingual » distingue les listes de paires { fr, ar } — pieces, etapes —
     de celle des textes de loi, qui restent des chaines simples : un texte de
     loi est cite dans sa langue d'origine, il ne se traduit pas. */
  var LISTS = {
    pieces: { key: 'proc_pieces', label: 'Documents requis', add: 'Ajouter un document', numbered: false, bilingual: true },
    steps:  { key: 'proc_steps',  label: 'Étapes',           add: 'Ajouter une étape',   numbered: true,  bilingual: true },
    law:    { key: 'proc_law',    label: 'Textes de loi',    add: 'Ajouter un texte de loi', numbered: false, bilingual: false }
  };

  var LANGS = [
    { key: 'fr', label: 'Français', dir: 'auto' },
    { key: 'ar', label: 'Arabe',    dir: 'rtl'  }
  ];

  /* Le texte a afficher hors des champs de saisie — titre replie de la carte,
     confirmation de suppression : la langue de l'interface, l'autre en repli. */
  function display(pair) {
    return h.pick(pair);
  }

  function pairOf(value) {
    if (!value || typeof value !== 'object') return { fr: '', ar: '' };
    return value;
  }

  function isMissingAdministration(procedure) {
    var admin = pairOf((procedure.proc_administration || [])[0]);
    // Manquante veut dire « aucune des deux langues » : une administration
    // nommee seulement en arabe n'est pas absente, elle est incomplete, et
    // c'est le serveur qui le dira au moment d'enregistrer.
    return !String(admin.fr || '').trim() && !String(admin.ar || '').trim();
  }

  /* Une paire a moitie remplie part quand meme au serveur, qui la refuse en
     nommant le cote manquant. On le signale avant l'envoi : c'est le motif de
     422 le plus frequent sur un fichier extrait. */
  function incompleteCount(procedure) {
    var count = 0;
    function check(pair) {
      pair = pairOf(pair);
      var fr = String(pair.fr || '').trim();
      var ar = String(pair.ar || '').trim();
      if ((fr && !ar) || (ar && !fr)) count += 1;
    }
    check(procedure.proc_title);
    check(procedure.proc_description);
    check(procedure.fee);
    check(procedure.proc_delai);
    (procedure.proc_administration || []).forEach(check);
    (procedure.proc_pieces || []).forEach(check);
    (procedure.proc_steps || []).forEach(check);
    return count;
  }

  function summaryText(procedure) {
    if (isMissingAdministration(procedure)) return 'Administration manquante';
    var incomplete = incompleteCount(procedure);
    if (incomplete) {
      return h.plural(incomplete, 'traduction manquante', 'traductions manquantes');
    }
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
      saving: false,
      /* Champs refuses par le dernier 422, indexes par le chemin que le
         serveur donne (« payload.0.proc_steps.2.ar »). Les inputs portent le
         meme chemin en data-path : le surlignage se pose sans table de
         correspondance. */
      invalidFields: {},
      // Message du serveur, affiche tel quel : il nomme le champ fautif, ce
      // qu'un « enregistrement impossible » generique ne fait pas.
      saveError: ''
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

    /* --- Champs refuses par le serveur ------------------------------------- */

    function clearInvalid(path, node) {
      if (!path || !state.invalidFields[path]) return;
      delete state.invalidFields[path];
      if (node) node.classList.remove('is-invalid');
      // Plus aucun champ en defaut : le bandeau d'erreur n'a plus d'objet.
      if (!Object.keys(state.invalidFields).length && state.saveError) {
        state.saveError = '';
        updateSaveError();
      }
    }

    function resetInvalid() {
      state.invalidFields = {};
      state.saveError = '';
    }

    /* Pose le message du serveur et surligne les champs qu'il nomme. Renvoie
       l'index de la premiere procedure fautive, pour l'ouvrir : sur un fichier
       de trente procedures, un message sans deplacement ne sert a rien. */
    function applyServerError(error) {
      var paths = (error && error.fields) || [];
      state.saveError = (error && error.message) || 'Enregistrement impossible.';
      state.invalidFields = {};
      var firstIndex = -1;

      paths.forEach(function (path) {
        state.invalidFields[path] = true;
        // « payload.<index>.<champ>… » : le rang de la procedure est en 2e position.
        var parts = String(path).split('.');
        var index = Number(parts[1]);
        if (!isNaN(index) && (firstIndex === -1 || index < firstIndex)) firstIndex = index;
      });

      return firstIndex;
    }

    /* Ouvre la procedure fautive, la place a l'ecran et donne le focus au
       premier champ refuse. */
    function revealInvalid(index) {
      if (index < 0 || index >= state.procedures.length) {
        renderCardsOnly();
        return;
      }
      var size = App.config.EDITOR_PAGE_SIZE;
      if (pageCount() > 1) state.page = Math.floor(index / size);
      state.openIndex = index;
      renderCardsOnly();

      var field = shell.querySelector('.proc-body .is-invalid');
      if (field) {
        if (field.scrollIntoView) field.scrollIntoView({ block: 'center' });
        field.focus();
      }
    }

    function saveErrorMarkup() {
      if (!state.saveError) return '';
      return '<div class="inline-error" role="alert">' + icon('alert') +
        '<span dir="auto">' + esc(state.saveError) + '</span></div>';
    }

    function updateSaveError() {
      var box = shell.querySelector('#editor-error');
      if (box) box.innerHTML = saveErrorMarkup();
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

    /* Chemin du champ tel que le serveur le nomme dans un 422 :
       « payload.3.proc_steps.2.ar ». C'est la cle qui relie le message
       d'erreur a l'input, et elle est posee sur l'input lui-meme — pas de
       table de correspondance a tenir a jour a cote. */
    function fieldPath(index, field, lang, itemIndex) {
      var parts = ['payload', index, field];
      if (itemIndex !== undefined && itemIndex !== null) parts.push(itemIndex);
      if (lang) parts.push(lang);
      return parts.join('.');
    }

    function invalidAttr(path) {
      return state.invalidFields[path] ? ' is-invalid' : '';
    }

    /* Un champ bilingue : les deux langues cote a cote, l'arabe en dir="rtl".
       Le rtl est ecrit en dur et non laisse a « auto » : le champ est souvent
       vide au moment ou on vient le remplir, et « auto » n'a alors aucun
       caractere sur lequel trancher — le curseur partirait a gauche. */
    function renderPairField(options) {
      var pair = pairOf(options.value);
      return '<div class="field-group">' +
        '<label class="field-label">' + esc(options.label) + '</label>' +
        '<div class="two-col">' +
          LANGS.map(function (lang) {
            var path = fieldPath(options.index, options.field, lang.key, options.item);
            var id = options.field + '-' + lang.key + '-' + options.index;
            var value = pair[lang.key] === null || pair[lang.key] === undefined
              ? '' : pair[lang.key];
            var input = options.multiline
              ? '<textarea dir="' + lang.dir + '" lang="' + lang.key + '" id="' + esc(id) + '" ' +
                  'class="' + invalidAttr(path) + '" ' +
                  'data-field="' + esc(options.field) + '" data-lang="' + lang.key + '" ' +
                  'data-index="' + options.index + '" data-path="' + esc(path) + '" ' +
                  'placeholder="' + esc(options.placeholder || '') + '"' + lockedAttr() + '>' +
                  esc(value) + '</textarea>'
              : '<input type="text" dir="' + lang.dir + '" lang="' + lang.key + '" id="' + esc(id) + '" ' +
                  'class="' + invalidAttr(path) + '" ' +
                  'data-field="' + esc(options.field) + '" data-lang="' + lang.key + '" ' +
                  'data-index="' + options.index + '" data-path="' + esc(path) + '" ' +
                  'placeholder="' + esc(options.placeholder || '') + '" ' +
                  'value="' + esc(value) + '"' + lockedAttr() + '>';
            return '<div>' +
              '<label class="field-sublabel" for="' + esc(id) + '">' + lang.label + '</label>' +
              input +
              '</div>';
          }).join('') +
        '</div>' +
        (options.warning || '') +
        '</div>';
    }

    function renderListItems(procedure, index, kind) {
      var spec = LISTS[kind];
      var items = procedure[spec.key] || [];
      if (!items.length) {
        return '<div class="list-empty">Aucun élément.</div>';
      }

      return items.map(function (value, itemIndex) {
        var removeButton =
          '<button type="button" class="icon-btn" data-action="remove-item" data-kind="' + kind + '" ' +
            'data-index="' + index + '" data-item="' + itemIndex + '" ' +
            'aria-label="Supprimer cet élément"' + lockedAttr() + '>' +
            icon('trash', 'icon-sm') + '</button>';
        var number = spec.numbered
          ? '<span class="step-num">' + (itemIndex + 1) + '.</span>' : '';

        // Textes de loi : une seule valeur, dans sa langue d'origine.
        if (!spec.bilingual) {
          var path = fieldPath(index, spec.key, null, itemIndex);
          return '<div class="list-item">' + number +
            '<input type="text" dir="auto" value="' + esc(value) + '" ' +
              'class="' + invalidAttr(path) + '" ' +
              'data-field="list" data-kind="' + kind + '" data-index="' + index + '" ' +
              'data-item="' + itemIndex + '" data-path="' + esc(path) + '" ' +
              'aria-label="' + esc(spec.label) + ' ' + (itemIndex + 1) + '"' +
              lockedAttr() + '>' +
            removeButton +
            '</div>';
        }

        var pair = pairOf(value);
        return '<div class="list-item list-item-bilingual">' + number +
          '<div class="two-col list-item-langs">' +
            LANGS.map(function (lang) {
              var langPath = fieldPath(index, spec.key, lang.key, itemIndex);
              var text = pair[lang.key] === null || pair[lang.key] === undefined
                ? '' : pair[lang.key];
              return '<input type="text" dir="' + lang.dir + '" lang="' + lang.key + '" ' +
                'class="' + invalidAttr(langPath) + '" ' +
                'value="' + esc(text) + '" ' +
                'data-field="list" data-kind="' + kind + '" data-lang="' + lang.key + '" ' +
                'data-index="' + index + '" data-item="' + itemIndex + '" ' +
                'data-path="' + esc(langPath) + '" ' +
                'placeholder="' + esc(lang.label) + '" ' +
                'aria-label="' + esc(spec.label) + ' ' + (itemIndex + 1) + ' — ' +
                  esc(lang.label) + '"' + lockedAttr() + '>';
            }).join('') +
          '</div>' +
          removeButton +
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
        renderPairField({
          index: index, field: 'proc_title', label: 'Titre',
          value: procedure.proc_title
        }) +
        renderPairField({
          index: index, field: 'proc_description', label: 'Description',
          value: procedure.proc_description, multiline: true,
          placeholder: 'Résumé court de la procédure'
        }) +
        /* L'administration est une LISTE cote serveur, mais le modele n'en
           retient qu'une par procedure : on edite la premiere, comme avant. */
        renderPairField({
          index: index, field: 'proc_administration', item: 0,
          label: 'Administration', value: procedure.proc_administration[0],
          warning: '<div class="field-warning" data-admin-warning style="' +
            (missing ? '' : 'display:none') + '">Administration manquante</div>'
        }) +
        renderPairField({
          index: index, field: 'fee', label: 'Frais',
          value: procedure.fee, placeholder: 'Non spécifié'
        }) +
        renderPairField({
          index: index, field: 'proc_delai', label: 'Délai',
          value: procedure.proc_delai, placeholder: 'Non spécifié'
        }) +
        renderListBlock(procedure, index, 'pieces') +
        renderListBlock(procedure, index, 'steps') +
        renderListBlock(procedure, index, 'law') +
        '</div>';
    }

    function renderCard(procedure, index) {
      var open = state.openIndex === index;
      var missing = isMissingAdministration(procedure);
      var classes = 'proc-card' + (open ? ' is-open' : '') + (missing ? ' is-invalid' : '');
      var title = display(procedure.proc_title).trim() || 'Procédure sans titre';

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
      /* Une paire a moitie remplie serait refusee par un 422 : on le dit
         avant l'envoi plutot que de laisser partir un enregistrement dont on
         connait deja l'issue. */
      var incomplete = state.procedures.filter(function (procedure) {
        return incompleteCount(procedure) > 0;
      }).length;

      var countText = h.plural(state.procedures.length, 'procédure') +
        (state.procedures.length >= 2 ? ' seront enregistrées' : ' sera enregistrée');
      var text = countText;
      if (invalid) {
        text = h.plural(invalid, 'procédure') + ' à corriger avant l\'enregistrement';
      } else if (incomplete) {
        text = h.plural(incomplete, 'procédure') +
          ' avec une traduction manquante (français et arabe sont exigés)';
      }
      var blocked = invalid > 0 || incomplete > 0 || !state.procedures.length;

      return '<span class="footer-count ' + (blocked ? 'footer-blocked' : '') + '">' +
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
        '<div id="editor-error">' + saveErrorMarkup() + '</div>' +
        '<div id="proc-list">' + renderCards() + '</div>' +
        '<div class="editor-footer" id="editor-footer">' + footerMarkup() + '</div>';
    }

    function renderCardsOnly() {
      var list = shell.querySelector('#proc-list');
      if (list) list.innerHTML = renderCards();
      var raw = shell.querySelector('#raw-block');
      if (raw) raw.innerHTML = renderRaw();
      updateSaveError();
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
        display(procedure.proc_title).trim() || 'Procédure sans titre';
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

      var lang = target.getAttribute('data-lang');

      if (field === 'list') {
        var kind = target.getAttribute('data-kind');
        var itemIndex = Number(target.getAttribute('data-item'));
        var list = procedure[LISTS[kind].key];
        if (LISTS[kind].bilingual) {
          list[itemIndex] = pairOf(list[itemIndex]);
          list[itemIndex][lang] = target.value;
        } else {
          list[itemIndex] = target.value;
        }
      } else if (field === 'proc_administration') {
        procedure.proc_administration[0] = pairOf(procedure.proc_administration[0]);
        procedure.proc_administration[0][lang] = target.value;
      } else {
        procedure[field] = pairOf(procedure[field]);
        procedure[field][lang] = target.value;
      }

      // Le champ vient d'etre corrige : son surlignage n'a plus lieu d'etre,
      // meme si le serveur ne s'est pas encore reprononce.
      clearInvalid(target.getAttribute('data-path'), target);
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
        var title = display(state.procedures[index].proc_title).trim() || 'cette procédure';
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
        // Une ligne bilingue nait avec ses deux moities, vides : le serveur
        // exige les deux, autant que les deux champs existent tout de suite.
        list.push(LISTS[addKind].bilingual ? { fr: '', ar: '' } : '');
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
      resetInvalid();
      updateSaveError();
      updateFooter();
      return App.api.saveExtraction(extractionId, state.procedures).then(function () {
        state.saving = false;
        clearDirty();
        h.toast('Brouillon enregistré.', 'success');
        return true;
      }).catch(function (error) {
        state.saving = false;
        handleSaveError(error);
        return false;
      });
    }

    /* Un 422 nomme le champ refuse — « payload.0.proc_steps.2.ar » : on
       affiche ce message-la, on surligne le champ et on l'amene a l'ecran.
       Toute autre erreur reste un toast : il n'y a rien a montrer sur un
       champ en particulier. */
    function handleSaveError(error) {
      if (error && error.status === 422) {
        var index = applyServerError(error);
        revealInvalid(index);
        updateSaveError();
        updateFooter();
        return;
      }
      updateFooter();
      h.toast('Enregistrement impossible : ' + error.message, 'error');
    }

    function openApproveModal() {
      App.modals.approve({
        extractionId: extractionId,
        procedures: state.procedures,
        /* La modale affiche deja le message ; elle le repasse ici pour que
           l'editeur surligne le champ refuse derriere elle — sans quoi on
           fermerait la fenetre sans savoir ou corriger. */
        onError: function (error) {
          if (error && error.status === 422) {
            var index = applyServerError(error);
            revealInvalid(index);
            updateSaveError();
            updateFooter();
          }
        },
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
        resetInvalid();
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
