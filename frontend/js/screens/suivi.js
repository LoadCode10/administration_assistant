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
      pending: {},   // « suiviId:pieceId » -> true tant que l'appel est en vol
      /* Recherche des bureaux à proximité, par carte dépliée :
           suiviId -> { phase, message, result }
         phase : 'locating' | 'searching' | 'fallback' | 'result' | 'error'.
         Pas d'entrée = pas de recherche en cours, le bouton est affiché.

         Rien n'est conservé : replier la carte efface l'entrée. Une adresse
         d'agence trouvée il y a dix minutes depuis un autre endroit n'est pas
         une réponse à « où est le bureau le plus proche », et la remontrer
         telle quelle laisserait croire qu'elle a été revérifiée. */
      nearby: {},
      // suiviId -> numéro de la dernière demande lancée. Une réponse qui
      // revient après une fermeture ou une relance porte un numéro périmé et
      // n'écrit plus rien.
      nearbyToken: {}
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

    /* --- Bureaux à proximité ------------------------------------------------

       Le déclencheur est dans la carte dépliée, pas dans la ligne repliée : la
       ligne est dense, et cette action met cinq à quinze secondes — elle ne
       doit pas être à un clic d'égarement.

       Les villes de repli servent quand la géolocalisation est refusée,
       indisponible ou trop lente. Ce n'est pas un ornement : les navigateurs
       bloquent la géolocalisation en HTTP simple ailleurs que sur localhost,
       et sur ces installations c'est le seul chemin qui fonctionne. */
    var FALLBACK_CITIES = [
      { name: 'Rabat', lat: 34.0209, lon: -6.8416 },
      { name: 'Casablanca', lat: 33.5731, lon: -7.5898 },
      { name: 'Fès', lat: 34.0331, lon: -5.0003 },
      { name: 'Marrakech', lat: 31.6295, lon: -7.9811 },
      { name: 'Tanger', lat: 35.7595, lon: -5.8340 },
      { name: 'Meknès', lat: 33.8935, lon: -5.5473 },
      { name: 'Agadir', lat: 30.4278, lon: -9.5981 },
      { name: 'Oujda', lat: 34.6867, lon: -1.9114 }
    ];

    function renderNearbyButton(item, message) {
      return (message
        ? '<div class="inline-error nearby-error" role="alert">' +
            icon('alert', 'icon-sm') + '<span>' + esc(message) + '</span></div>'
        : '') +
        '<button type="button" class="btn-tiny nearby-trigger" ' +
          'data-nearby-find="' + esc(item.id) + '">' +
          icon('map-pin', 'icon-sm') + 'Trouver le bureau le plus proche' +
        '</button>';
    }

    /* L'attente est bien plus longue que tout le reste de l'application : elle
       s'explique au lieu de tourner en silence. */
    function renderNearbyLoading(message) {
      return '<div class="nearby-loading" role="status">' +
        '<span class="nearby-spinner" aria-hidden="true"></span>' +
        '<span>' + esc(message) + '</span>' +
      '</div>';
    }

    function renderNearbyFallback(item, message) {
      return '<div class="nearby-fallback">' +
        '<p class="nearby-fallback-text">' + esc(message) + '</p>' +
        '<div class="nearby-fallback-row">' +
          '<label class="sr-only" for="nearby-city-' + esc(item.id) + '">' +
            'Ville de recherche</label>' +
          '<select id="nearby-city-' + esc(item.id) + '" ' +
              'data-nearby-city="' + esc(item.id) + '">' +
            FALLBACK_CITIES.map(function (city) {
              return '<option value="' + esc(city.name) + '">' + esc(city.name) + '</option>';
            }).join('') +
          '</select>' +
          '<button type="button" data-nearby-city-go="' + esc(item.id) + '">' +
            icon('search', 'icon-sm') + 'Chercher' +
          '</button>' +
        '</div>' +
        '<button type="button" class="btn-tiny nearby-dismiss" ' +
          'data-nearby-close="' + esc(item.id) + '">Fermer</button>' +
      '</div>';
    }

    function renderNearbySources(sources) {
      if (!sources.length) return '';
      return '<div class="nearby-sources">' +
        '<div class="nearby-sources-title">' +
          h.plural(sources.length, 'Source', 'Sources') + '</div>' +
        sources.map(function (source) {
          var badge = '<span class="nearby-source-badge' +
            (source.official ? ' is-official' : '') + '">' +
            (source.official ? 'Officielle' : 'Non officielle') + '</span>';
          /* Une source sans URL exploitable reste citée, mais pas en lien : un
             lien mort ferait croire qu'il y a quelque chose à ouvrir.

             Le protocole est revérifié ici alors que le normaliseur l'a déjà
             fait. C'est voulu : cette URL vient d'une recherche menée par un
             modèle, et c'est cette ligne qui écrit l'attribut href. La garde
             appartient au dernier endroit qui touche le DOM, pas seulement au
             premier qui touche la donnée. */
          if (!/^https?:\/\//i.test(source.uri)) {
            return '<span class="nearby-source is-dead">' +
              '<span class="nearby-source-title">' + esc(source.title) + '</span>' +
              badge + '</span>';
          }
          return '<a class="nearby-source' + (source.official ? ' is-official' : '') + '" ' +
              'href="' + esc(source.uri) + '" target="_blank" rel="noopener noreferrer">' +
            '<span class="nearby-source-title">' + esc(source.title) + '</span>' +
            badge + icon('link', 'icon-sm') +
          '</a>';
        }).join('') +
      '</div>';
    }

    /* « texte » est de la prose écrite par un modèle de langue. Elle passe par
       h.markdownToHtml — le même chemin que les réponses de l'assistant, lavage
       DOMPurify compris — et jamais par innerHTML directement. Si la conversion
       n'est pas possible (bibliothèque absente), on affiche le texte échappé :
       moins lisible, mais sûr. */
    function renderNearbyText(text) {
      var html = h.markdownToHtml(text);
      return html === null
        ? '<div class="nearby-text is-plain" dir="auto">' + esc(text) + '</div>'
        : '<div class="nearby-text is-markdown" dir="auto">' + html + '</div>';
    }

    /* L'avertissement est au-dessus du résultat, et non en note de bas de
       panneau : quand aucune source officielle n'a été trouvée, l'adresse
       affichée peut être fausse, et quelqu'un qui se déplace pour rien est
       précisément ce que cet écran doit éviter. */
    function renderNearbyWarning() {
      return '<div class="nearby-warning" role="alert">' +
        icon('alert') +
        '<div>' +
          '<div class="nearby-warning-title">Informations non vérifiées</div>' +
          '<p>Ces informations proviennent de sources non officielles et ' +
            'n\'ont pas été vérifiées. Confirmez-les auprès de l\'administration ' +
            'avant de vous déplacer.</p>' +
        '</div>' +
      '</div>';
    }

    function renderNearbyResult(item, result) {
      return '<div class="nearby-panel' + (result.verified ? '' : ' is-unverified') + '">' +
        '<div class="nearby-panel-head">' +
          '<div class="nearby-city" dir="auto">' +
            (result.city
              ? 'Résultats pour ' + esc(result.city)
              : 'Résultats') + '</div>' +
          '<button type="button" class="icon-btn" data-nearby-close="' + esc(item.id) + '" ' +
            'aria-label="Fermer les résultats">' + icon('x') + '</button>' +
        '</div>' +
        (result.verified ? '' : renderNearbyWarning()) +
        renderNearbyText(result.text) +
        renderNearbySources(result.sources) +
        '<div class="nearby-panel-foot">' +
          '<button type="button" class="btn-tiny" data-nearby-close="' + esc(item.id) + '">' +
            'Fermer</button>' +
        '</div>' +
      '</div>';
    }

    function renderNearby(item) {
      // Sans identifiant d'administration il n'y a rien à interroger : plutôt
      // qu'un bouton qui échouerait à coup sûr, on n'en met pas.
      if (item.administrationId === null || item.administrationId === undefined ||
          item.administrationId === '') return '';

      var current = state.nearby[item.id];
      var inner;
      if (!current) inner = renderNearbyButton(item, '');
      else if (current.phase === 'locating') {
        inner = renderNearbyLoading('Recherche de votre position…');
      } else if (current.phase === 'searching') {
        inner = renderNearbyLoading(
          'Recherche des bureaux à proximité… cela peut prendre quelques secondes');
      } else if (current.phase === 'fallback') {
        inner = renderNearbyFallback(item, current.message);
      } else if (current.phase === 'error') {
        inner = renderNearbyButton(item, current.message);
      } else {
        inner = renderNearbyResult(item, current.result);
      }

      return '<div class="track-nearby" data-nearby="' + esc(item.id) + '">' + inner + '</div>';
    }

    function renderBody(item) {
      return '<div class="track-body">' +
        renderNearby(item) +
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
          nextToken(item.id);
          delete state.nearby[item.id];
          render();
          h.toast('Procédure retirée du suivi.', 'success');
        }
      });
    }

    /* --- Bureaux à proximité : comportement ---------------------------------- */

    /* Repeint la seule zone concernée. Reconstruire la carte ferait perdre le
       curseur dans une note en cours de saisie, et la recherche est justement
       assez longue pour qu'on écrive pendant qu'elle tourne. */
    function paintNearby(item) {
      var zone = bodyNode.querySelector('[data-nearby="' + item.id + '"]');
      if (!zone) return;
      var fresh = h.fromHTML(renderNearby(item));
      if (fresh) zone.parentNode.replaceChild(fresh, zone);
    }

    function setNearby(id, value) {
      if (value) state.nearby[id] = value;
      else delete state.nearby[id];
      var item = find(id);
      if (item) paintNearby(item);
    }

    // Toute réponse arrivée après une fermeture ou une relance porte un numéro
    // périmé : elle est ignorée plutôt que peinte sur un panneau qui n'est
    // plus le sien.
    function nextToken(id) {
      var token = (state.nearbyToken[id] || 0) + 1;
      state.nearbyToken[id] = token;
      return token;
    }

    function isStale(id, token) {
      return destroyed || state.nearbyToken[id] !== token;
    }

    function closeNearby(id) {
      nextToken(id);
      setNearby(id, null);
    }

    function searchNearby(id, lat, lon) {
      var item = find(id);
      if (!item) return;
      var token = nextToken(id);
      setNearby(id, { phase: 'searching' });

      App.api.findNearbyOffices(item.administrationId, lat, lon).then(function (result) {
        if (isStale(id, token)) return;
        setNearby(id, { phase: 'result', result: result });
      }, function (error) {
        if (isStale(id, token)) return;
        // Le message du serveur est plus précis que ce qu'on inventerait :
        // « Localisation non reconnue » ne se confond pas avec une panne. Le
        // bouton revient avec lui, la recherche reste relançable.
        setNearby(id, { phase: 'error', message: error.message });
      });
    }

    /* Refus, indisponibilité, délai dépassé : dans les trois cas on explique
       pourquoi la position était demandée et on propose la liste des villes.
       Échouer en silence laisserait un bouton qui ne fait rien. */
    function offerCities(id, reason) {
      setNearby(id, {
        phase: 'fallback',
        message: reason + ' Votre position sert à classer les bureaux du plus ' +
          'proche au plus loin. Choisissez plutôt une ville :'
      });
    }

    function geolocationReason(error) {
      var code = error && error.code;
      if (code === 1) return 'Accès à votre position refusé.';
      if (code === 3) return 'Votre position met trop de temps à être déterminée.';
      return 'Votre position n\'a pas pu être déterminée.';
    }

    function locateThenSearch(id) {
      var item = find(id);
      if (!item || !item.administrationId) return;
      // Une recherche déjà en vol : on ne la double pas.
      var current = state.nearby[id];
      if (current && (current.phase === 'locating' || current.phase === 'searching')) return;

      if (!navigator.geolocation) {
        offerCities(id, 'Ce navigateur ne sait pas donner votre position.');
        return;
      }

      var token = nextToken(id);
      setNearby(id, { phase: 'locating' });

      navigator.geolocation.getCurrentPosition(
        function (position) {
          if (isStale(id, token)) return;
          searchNearby(id, position.coords.latitude, position.coords.longitude);
        },
        function (error) {
          if (isStale(id, token)) return;
          offerCities(id, geolocationReason(error));
        },
        // Sans délai maximum, le navigateur peut attendre indéfiniment une
        // position qui ne viendra pas : le bouton resterait en attente sans
        // rien dire. Dix secondes, puis on passe aux villes.
        { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false }
      );
    }

    function searchFromCity(id) {
      var select = bodyNode.querySelector('[data-nearby-city="' + id + '"]');
      if (!select) return;
      var chosen = FALLBACK_CITIES.filter(function (city) {
        return city.name === select.value;
      })[0];
      if (!chosen) return;
      searchNearby(id, chosen.lat, chosen.lon);
    }

    /* --- Évènements ---------------------------------------------------------- */

    h.on(view, 'click', '[data-nearby-find]', function (event, target) {
      locateThenSearch(target.getAttribute('data-nearby-find'));
    });

    h.on(view, 'click', '[data-nearby-city-go]', function (event, target) {
      searchFromCity(target.getAttribute('data-nearby-city-go'));
    });

    h.on(view, 'click', '[data-nearby-close]', function (event, target) {
      closeNearby(target.getAttribute('data-nearby-close'));
    });

    h.on(view, 'click', '[data-toggle]', function (event, target) {
      var id = target.getAttribute('data-toggle');
      state.open[id] = !state.open[id];
      // Rien n'est gardé d'une ouverture à l'autre : rouvrir la carte remontre
      // le bouton, jamais le résultat précédent. Le jeton avance pour qu'une
      // recherche encore en vol ne vienne pas repeindre la carte rouverte.
      nextToken(id);
      delete state.nearby[id];
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
