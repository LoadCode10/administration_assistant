/* Écran citoyen 2 — Mes procédures (#/suivi).

   Une carte par procédure suivie. Repliée, elle ne dit qu'une chose : où en
   est le dossier — la barre d'avancement compte les pièces cochées. Dépliée,
   elle donne la liste des pièces à réunir, avec une note libre par pièce (le
   numéro de récépissé, le guichet où on l'a retirée), puis les étapes, en
   lecture seule : ce sont celles de la procédure, pas une liste de tâches.

   Cocher une case écrit sur le serveur. L'affichage bouge d'abord — attendre
   la réponse ferait clignoter la case — mais si l'enregistrement échoue, la
   case revient en arrière et l'échec est dit. Une barre d'avancement qui ne
   correspond pas à ce qui est enregistré serait pire que pas de barre. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  function mount(root) {
    var view = document.createElement('div');
    root.appendChild(view);

    var state = {
      items: [],
      error: '',
      open: {},      // identifiants des cartes dépliées
      pending: {}    // « suiviId:pieceId » -> true tant que l'appel est en vol
    };

    var destroyed = false;

    view.innerHTML =
      '<div class="screen-header">' +
        '<div>' +
          '<h1>Mes procédures</h1>' +
          '<p class="subtitle" id="track-subtitle">Chargement…</p>' +
        '</div>' +
      '</div>' +
      '<div id="track-body">' +
        '<div class="skeleton-card" style="height:88px"></div>' +
        '<div class="skeleton-card" style="height:88px"></div>' +
      '</div>';

    var bodyNode = view.querySelector('#track-body');
    var subtitle = view.querySelector('#track-subtitle');

    /* --- Calculs ------------------------------------------------------------ */

    function progressOf(item) {
      var total = item.pieces.length;
      var done = item.pieces.filter(function (piece) { return piece.checked; }).length;
      return {
        done: done,
        total: total,
        // Une procédure sans pièce listée n'est pas « terminée » : il n'y a
        // rien à réunir, donc rien à mesurer. On ne montre alors ni barre ni
        // pastille — 0 / 0 à 100 % annoncerait un dossier bouclé qui ne l'est
        // pas.
        percent: total ? Math.round((done / total) * 100) : 0,
        complete: total > 0 && done === total
      };
    }

    function find(id) {
      return state.items.filter(function (item) { return String(item.id) === String(id); })[0] || null;
    }

    /* --- Rendu -------------------------------------------------------------- */

    function renderProgress(item) {
      var progress = progressOf(item);
      // Rien à réunir : pas de barre. Voir progressOf().
      if (!progress.total) return '';
      return '<div class="track-progress">' +
        '<div class="track-track">' +
          '<span class="track-bar' + (progress.complete ? ' is-complete' : '') + '" ' +
            'style="width:' + progress.percent + '%"></span>' +
        '</div>' +
        '<div class="track-progress-label">' +
          esc(progress.done + ' / ' + progress.total + ' ' +
            (progress.total >= 2 ? 'pièces réunies' : 'pièce réunie')) +
          ' · ' + progress.percent + ' %' +
        '</div>' +
      '</div>';
    }

    function renderPiece(item, piece) {
      var key = item.id + ':' + piece.id;
      return '<div class="piece-row' + (piece.checked ? ' is-checked' : '') + '" ' +
          'data-piece-row="' + esc(key) + '">' +
        '<label class="piece-check">' +
          '<input type="checkbox" data-piece="' + esc(key) + '"' +
            (piece.checked ? ' checked' : '') + '>' +
          '<span dir="auto">' + esc(piece.label) + '</span>' +
        '</label>' +
        '<input type="text" class="piece-note" dir="auto" data-note="' + esc(key) + '" ' +
          'value="' + esc(piece.note) + '" ' +
          'placeholder="Note (facultatif)" ' +
          'aria-label="Note pour ' + esc(piece.label) + '">' +
      '</div>';
    }

    function renderBody(item) {
      return '<div class="track-body">' +
        '<div class="detail-block">' +
          '<div class="detail-title">Pièces requises' +
            '<span class="detail-count">' + item.pieces.length + '</span></div>' +
          (item.pieces.length
            ? item.pieces.map(function (piece) { return renderPiece(item, piece); }).join('')
            : '<div class="list-empty">Aucune pièce à réunir pour cette procédure.</div>') +
        '</div>' +
        '<div class="detail-block">' +
          '<div class="detail-title">Étapes' +
            '<span class="detail-count">' + item.steps.length + '</span></div>' +
          (item.steps.length
            ? '<ol class="detail-list">' + item.steps.map(function (step) {
                return '<li dir="auto">' + esc(step.label) + '</li>';
              }).join('') + '</ol>'
            : '<div class="list-empty">Aucune étape listée pour cette procédure.</div>') +
        '</div>' +
      '</div>';
    }

    function renderCard(item) {
      var progress = progressOf(item);
      var isOpen = state.open[item.id] === true;

      return '<div class="card track-card' + (isOpen ? ' is-open' : '') + '" ' +
          'data-card="' + esc(item.id) + '">' +
        '<div class="track-head">' +
          '<button type="button" class="track-toggle" data-toggle="' + esc(item.id) + '" ' +
              'aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
            icon(isOpen ? 'chevron-down' : 'chevron-right') +
            '<span class="track-titles">' +
              '<span class="track-title" dir="auto">' + esc(item.title) + '</span>' +
              (item.administration
                ? '<span class="track-admin" dir="auto">' + esc(item.administration) + '</span>'
                : '<span class="track-admin is-empty">Administration non renseignée</span>') +
            '</span>' +
          '</button>' +
          '<span class="pill pill-success track-done"' + (progress.complete ? '' : ' hidden') + '>' +
            'Terminé</span>' +
          '<button type="button" class="icon-btn" data-remove="' + esc(item.id) + '" ' +
            'aria-label="Ne plus suivre cette procédure">' + icon('trash') + '</button>' +
        '</div>' +
        renderProgress(item) +
        (isOpen ? renderBody(item) : '') +
      '</div>';
    }

    function renderEmpty() {
      return '<div class="state-block">' +
        '<div class="state-title">Aucune procédure suivie</div>' +
        '<p>Posez une question à l\'assistant : les procédures citées en réponse ' +
          'peuvent être suivies d\'un clic, et apparaîtront ici.</p>' +
        '<div class="state-actions">' +
          '<a class="btn-anchor" href="#/chat">' + icon('sparkles', 'icon-sm') +
            'Aller à l\'assistant</a>' +
        '</div>' +
      '</div>';
    }

    function render() {
      if (state.error) {
        subtitle.textContent = 'Chargement impossible';
        bodyNode.innerHTML = '<div class="state-block error">' +
          '<div class="state-title">Impossible de charger vos procédures</div>' +
          '<p>' + esc(state.error) + '</p>' +
          '<div class="state-actions">' +
            '<button type="button" data-action="retry">' + icon('refresh') + 'Réessayer</button>' +
          '</div>' +
        '</div>';
        return;
      }

      var complete = state.items.filter(function (item) {
        return progressOf(item).complete;
      }).length;

      subtitle.textContent = state.items.length
        ? h.plural(state.items.length, 'procédure suivie', 'procédures suivies') +
          (complete ? ' · ' + complete + ' terminée' + (complete >= 2 ? 's' : '') : '')
        : 'Rien à suivre pour le moment';

      bodyNode.innerHTML = state.items.length
        ? state.items.map(renderCard).join('')
        : renderEmpty();
    }

    /* Rafraîchit une carte sans la reconstruire : la barre, le pourcentage et
       la pastille « Terminé ». Reconstruire l'HTML ferait perdre le curseur
       dans la note en cours de saisie. */
    function refreshCard(item) {
      var card = bodyNode.querySelector('[data-card="' + item.id + '"]');
      if (!card) return;
      var progress = progressOf(item);

      var bar = card.querySelector('.track-bar');
      if (bar) {
        bar.style.width = progress.percent + '%';
        bar.classList.toggle('is-complete', progress.complete);
      }
      var label = card.querySelector('.track-progress-label');
      if (label) {
        label.textContent = progress.done + ' / ' + progress.total + ' ' +
          (progress.total >= 2 ? 'pièces réunies' : 'pièce réunie') +
          ' · ' + progress.percent + ' %';
      }
      var done = card.querySelector('.track-done');
      if (done) done.hidden = !progress.complete;

      // Carte repliée : ces lignes n'existent pas, la boucle ne trouve rien.
      item.pieces.forEach(function (piece) {
        var pieceRow = card.querySelector('[data-piece-row="' + item.id + ':' + piece.id + '"]');
        if (pieceRow) pieceRow.classList.toggle('is-checked', piece.checked);
      });

      // Le sous-titre compte les procédures terminées : il bouge avec la carte.
      var complete = state.items.filter(function (entry) {
        return progressOf(entry).complete;
      }).length;
      subtitle.textContent = h.plural(state.items.length, 'procédure suivie', 'procédures suivies') +
        (complete ? ' · ' + complete + ' terminée' + (complete >= 2 ? 's' : '') : '');
    }

    /* --- Chargement --------------------------------------------------------- */

    function load() {
      App.api.listTracked().then(function (list) {
        if (destroyed) return;
        state.items = list;
        state.error = '';
        render();
      }, function (error) {
        if (destroyed) return;
        state.error = error.message;
        render();
      });
    }

    /* --- Cocher une pièce ---------------------------------------------------- */

    /* La clé d'une pièce est « identifiant du suivi : identifiant de la pièce ».
       On coupe au premier deux-points : c'est le seul que l'on a posé, ceux
       que porte éventuellement un identifiant serveur appartiennent à la
       pièce. */
    function locate(key) {
      var cut = key.indexOf(':');
      var item = find(key.slice(0, cut));
      if (!item) return null;
      var pieceId = key.slice(cut + 1);
      var piece = item.pieces.filter(function (p) { return String(p.id) === pieceId; })[0];
      return piece ? { item: item, piece: piece } : null;
    }

    function setChecked(key, checked, checkbox) {
      var found = locate(key);
      if (!found) return;
      var item = found.item;
      var piece = found.piece;

      // Une seule requête en vol par pièce : deux clics rapides se
      // répondraient dans le désordre et la dernière réponse gagnerait.
      if (state.pending[key]) return;
      state.pending[key] = true;
      checkbox.disabled = true;

      var previous = piece.checked;
      piece.checked = checked;
      refreshCard(item);

      App.api.updateTrackedPiece(item.id, piece.id, { checked: checked })
        .then(function (fresh) {
          if (destroyed) return;
          delete state.pending[key];
          checkbox.disabled = false;
          // Le serveur fait foi : on réaligne la case sur le document qu'il
          // vient de renvoyer.
          if (fresh) piece.checked = fresh.checked;
          refreshCard(item);
        }, function (error) {
          if (destroyed) return;
          delete state.pending[key];
          checkbox.disabled = false;
          // Rien n'est enregistré : la case doit revenir là où elle était,
          // sinon l'écran affirme un avancement que le serveur ignore.
          piece.checked = previous;
          checkbox.checked = previous;
          refreshCard(item);
          h.toast('Pièce non enregistrée : ' + error.message, 'error');
        });
    }

    function saveNote(key, value, input) {
      var found = locate(key);
      if (!found) return;
      var item = found.item;
      var piece = found.piece;
      if (piece.note === value) return;

      var previous = piece.note;
      piece.note = value;

      App.api.updateTrackedPiece(item.id, piece.id, { note: value })
        .then(null, function (error) {
          if (destroyed) return;
          piece.note = previous;
          // Le champ peut avoir été réécrit depuis : on ne remet l'ancienne
          // valeur que s'il affiche encore celle qui a échoué.
          if (input.value === value) input.value = previous;
          h.toast('Note non enregistrée : ' + error.message, 'error');
        });
    }

    /* --- Retrait du suivi ---------------------------------------------------- */

    function remove(id) {
      var item = find(id);
      if (!item) return;
      var progress = progressOf(item);

      App.modals.confirmDelete({
        title: 'Ne plus suivre cette procédure',
        target: item.title,
        consequences: [
          'Elle disparaîtra de « Mes procédures ».',
          progress.done
            ? 'Les ' + progress.done + ' pièce' + (progress.done >= 2 ? 's cochées' : ' cochée') +
              ' et les notes associées seront perdues.'
            : 'Les notes associées seront perdues.',
          'La procédure elle-même n\'est pas supprimée : vous pourrez la suivre à nouveau.'
        ],
        run: function () { return App.api.untrackProcedure(item.id); },
        onDeleted: function () {
          if (destroyed) return;
          state.items = state.items.filter(function (entry) {
            return String(entry.id) !== String(item.id);
          });
          delete state.open[item.id];
          render();
          h.toast('Procédure retirée du suivi.', 'success');
        }
      });
    }

    /* --- Évènements ---------------------------------------------------------- */

    h.on(view, 'click', '[data-toggle]', function (event, target) {
      var id = target.getAttribute('data-toggle');
      state.open[id] = !state.open[id];
      render();
    });

    h.on(view, 'click', '[data-remove]', function (event, target) {
      remove(target.getAttribute('data-remove'));
    });

    h.on(view, 'click', '[data-action="retry"]', function () {
      state.error = '';
      bodyNode.innerHTML = '<div class="skeleton-card" style="height:88px"></div>';
      subtitle.textContent = 'Chargement…';
      load();
    });

    // « change » et non « click » : la case peut être basculée au clavier.
    view.addEventListener('change', function (event) {
      var checkbox = event.target.closest('[data-piece]');
      if (!checkbox) return;
      setChecked(checkbox.getAttribute('data-piece'), checkbox.checked, checkbox);
    });

    // La note part à la sortie du champ : une requête par frappe serait du
    // bruit, et il n'y a rien à valider avant.
    view.addEventListener('focusout', function (event) {
      var input = event.target.closest('[data-note]');
      if (!input) return;
      saveNote(input.getAttribute('data-note'), input.value, input);
    });

    load();

    return {
      destroy: function () { destroyed = true; }
    };
  }

  App.screens = App.screens || {};
  App.screens.suivi = { mount: mount };
})(window);
