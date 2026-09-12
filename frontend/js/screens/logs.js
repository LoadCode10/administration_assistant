/* Écran 7 — Journal d'activité (#/logs) : la trace des actions effectuées.

   Lecture seule, et réservé aux administrateurs : un journal qu'on peut
   modifier ne prouve plus rien. Rien ne s'y crée, ne s'y édite ni ne s'y
   supprime — c'est aussi pourquoi l'écran n'a ni bouton d'action ni garde de
   navigation.

   La ligne répond à « qui a fait quoi, quand » ; le reste — adresse IP, méthode,
   chemin, navigateur — sert à instruire un incident et pas à parcourir la
   liste. D'où la ligne dépliable : la trace technique existe, elle n'encombre
   pas la lecture.

   Deux filtres, et ils ne travaillent pas au même endroit. L'action est un
   paramètre du backend (égalité stricte) : la changer relance l'appel. Le nom
   d'utilisateur est comparé ici, sur la page déjà chargée — le contrat n'offre
   qu'un filtre par identifiant, et personne ne connaît l'identifiant technique
   de quelqu'un. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  var PAGE_SIZE = 20;

  /* Les actions connues du backend, dans l'ordre où elles sont proposées :
     l'authentification, puis ce qui touche au contenu. « tone » donne la
     teinte de la pastille — le rouge pour ce qui détruit ou retire, l'ambre
     pour une tentative repoussée, le neutre pour le cours normal des choses.
     Une action inconnue garde sa clé brute dans une pastille neutre plutôt que
     de disparaître : un journal ne doit jamais taire une ligne. */
  var ACTIONS = [
    { key: 'login', label: 'Connexion', tone: 'pill-neutral' },
    { key: 'login_failed', label: 'Échec de connexion', tone: 'pill-warning' },
    { key: 'register', label: 'Inscription', tone: 'pill-neutral' },
    { key: 'register_failed', label: 'Échec d\'inscription', tone: 'pill-warning' },
    { key: 'delete_procedure', label: 'Suppression d\'une procédure', tone: 'pill-danger' },
    { key: 'mark_obsolete', label: 'Procédure marquée obsolète', tone: 'pill-danger' },
    { key: 'delete_document', label: 'Suppression d\'un document', tone: 'pill-danger' },
    { key: 'delete_import_extraction', label: 'Suppression d\'un import', tone: 'pill-danger' },
    { key: 'approve_extraction', label: 'Approbation d\'une extraction', tone: 'pill-neutral' },
    { key: 'update_administration', label: 'Modification d\'une administration', tone: 'pill-neutral' }
  ];

  function actionOf(raw) {
    var key = String(raw === null || raw === undefined ? '' : raw).trim();
    var found = ACTIONS.filter(function (item) { return item.key === key; })[0];
    return found || { key: key, label: key || 'Action inconnue', tone: 'pill-neutral' };
  }

  function normalize(value) {
    return String(value === null || value === undefined ? '' : value).toLowerCase();
  }

  function roleLabel(role) {
    return (App.auth && App.auth.roleLabel(role)) || role || '';
  }

  /* --- Agent utilisateur ---------------------------------------------------

     On ne cherche pas à identifier finement un navigateur — la chaîne est
     déclarative, tout le monde s'y fait passer pour tout le monde. Le but est
     qu'une ligne se lise : « Chrome sur Windows » vaut mieux que 120
     caractères. Faute de reconnaître les deux moitiés, on rend la chaîne
     brute, tronquée, la valeur complète restant en infobulle.

     L'ordre des tests compte : Edge et Opera se déclarent aussi « Chrome »,
     Chrome se déclare aussi « Safari ». Le plus spécifique passe en premier. */
  var BROWSERS = [
    { re: /Edg[eA]?\//, name: 'Edge' },
    { re: /OPR\/|Opera/, name: 'Opera' },
    { re: /Firefox\//, name: 'Firefox' },
    { re: /Chrome\//, name: 'Chrome' },
    { re: /Safari\//, name: 'Safari' },
    { re: /curl\//, name: 'curl' },
    { re: /Postman/, name: 'Postman' }
  ];

  var SYSTEMS = [
    { re: /Windows NT/, name: 'Windows' },
    { re: /iPhone|iPad|iPod/, name: 'iOS' },
    { re: /Android/, name: 'Android' },
    { re: /Mac OS X/, name: 'macOS' },
    { re: /Linux/, name: 'Linux' }
  ];

  function firstMatch(list, value) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].re.test(value)) return list[i].name;
    }
    return '';
  }

  function readableAgent(userAgent) {
    var value = String(userAgent || '').trim();
    if (!value) return 'Agent inconnu';
    var browser = firstMatch(BROWSERS, value);
    var system = firstMatch(SYSTEMS, value);
    if (browser && system) return browser + ' sur ' + system;
    if (browser) return browser;
    return h.truncate(value, 60);
  }

  /* --- Date ----------------------------------------------------------------

     La ligne porte le relatif — c'est ce qu'on lit dans un journal — et
     l'infobulle la date exacte, heure comprise : « il y a 2 heures » ne se
     recoupe pas avec une trace serveur. */
  function exactDate(value) {
    if (!value) return 'Date inconnue';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    function pad(number) { return (number < 10 ? '0' : '') + number; }
    return h.formatDate(date) + ' à ' + pad(date.getHours()) + ':' +
      pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  }

  function mount(root) {
    var view = document.createElement('div');
    root.appendChild(view);

    var state = {
      logs: [],
      // Filtre envoyé au serveur ('' = toutes les actions).
      action: '',
      // Filtre appliqué ici, sur l'identifiant de l'acteur.
      actor: '',
      openId: null,
      page: 1,
      loaded: false
    };

    var destroyed = false;

    view.innerHTML =
      '<div class="screen-header">' +
        '<div>' +
          '<h1>Journal d\'activité</h1>' +
          '<p class="subtitle" id="logs-subtitle">Chargement…</p>' +
        '</div>' +
      '</div>' +
      '<div class="toolbar">' +
        '<label class="select-field">' +
          '<span class="select-label">Action</span>' +
          '<select id="logs-action" aria-label="Filtrer par action">' +
            '<option value="">Toutes les actions</option>' +
            ACTIONS.map(function (item) {
              return '<option value="' + esc(item.key) + '">' +
                esc(item.label) + '</option>';
            }).join('') +
          '</select>' +
        '</label>' +
        '<label class="search">' + icon('search', 'icon-sm') +
          '<input type="search" dir="auto" id="logs-actor" ' +
            'placeholder="Filtrer par identifiant…" ' +
            'aria-label="Filtrer par identifiant">' +
        '</label>' +
      '</div>' +
      '<div id="logs-body">' +
        '<div class="skeleton-card" style="height:56px"></div>' +
        '<div class="skeleton-card" style="height:56px"></div>' +
        '<div class="skeleton-card" style="height:56px"></div>' +
      '</div>';

    var bodyNode = view.querySelector('#logs-body');
    var subtitle = view.querySelector('#logs-subtitle');
    var actionSelect = view.querySelector('#logs-action');
    var actorInput = view.querySelector('#logs-actor');

    /* --- Filtrage ----------------------------------------------------------- */

    /* Le filtre par acteur porte sur l'identifiant de connexion, seul nom que
       le journal affiche. Une entrée sans acteur ne peut correspondre à aucune
       recherche de nom : elle sort dès qu'un nom est demandé. */
    function filtered() {
      if (!state.actor) return state.logs;
      var needle = normalize(state.actor);
      return state.logs.filter(function (log) {
        return log.actor && normalize(log.actor.username).indexOf(needle) !== -1;
      });
    }

    /* --- Rendu -------------------------------------------------------------- */

    function renderActor(log) {
      if (!log.actor) {
        // Échec de connexion ou d'inscription : personne n'était authentifié.
        return '<span class="log-actor is-anonymous">' + icon('alert', 'icon-sm') +
          'Non authentifié</span>';
      }
      var role = log.actorRole || log.actor.role;
      return '<span class="log-actor">' +
        '<span class="log-user" dir="auto">' + esc(log.actor.username) + '</span>' +
        '<span class="pill pill-xs ' +
          (role === 'admin' ? 'pill-accent' : 'pill-neutral') + '" ' +
          'title="Rôle au moment de l\'action">' + esc(roleLabel(role)) + '</span>' +
        '</span>';
    }

    /* Une définition par donnée technique : l'étiquette dit ce qu'on lit, la
       valeur reste en chasse fixe — ce sont des identifiants, on les compare
       caractère à caractère. */
    function metaRow(label, value, title) {
      if (!value) return '';
      return '<div class="log-meta-item">' +
        '<span class="log-meta-label">' + esc(label) + '</span>' +
        '<span class="log-meta-value mono"' +
          (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(value) + '</span>' +
        '</div>';
    }

    function renderMeta(log) {
      var route = (log.method ? log.method + ' ' : '') + (log.path || '');
      var rows =
        metaRow('Adresse IP', log.ipAddress) +
        metaRow('Requête', route) +
        metaRow('Navigateur', readableAgent(log.userAgent), log.userAgent) +
        metaRow('Objet', log.entityType && log.entityId
          ? log.entityType + ' · ' + log.entityId
          : (log.entityType || log.entityId));
      return '<div class="log-meta">' +
        (rows || '<div class="list-empty">Aucune donnée technique enregistrée.</div>') +
        '</div>';
    }

    function renderRow(log) {
      var action = actionOf(log.action);
      var open = state.openId === log.id;
      return '<div class="log-card' + (open ? ' is-open' : '') + '">' +
          '<button type="button" class="log-row" data-action="toggle" ' +
            'data-id="' + esc(log.id) + '" aria-expanded="' + open + '">' +
            icon(open ? 'chevron-down' : 'chevron-right', 'icon-sm') +
            '<span class="pill ' + action.tone + ' log-badge">' +
              esc(action.label) + '</span>' +
            renderActor(log) +
            '<span class="log-detail" dir="auto">' + esc(log.detail) + '</span>' +
            '<span class="log-date" title="' + esc(exactDate(log.date)) + '">' +
              esc(h.formatRelative(log.date) || 'Date inconnue') + '</span>' +
          '</button>' +
          (open ? renderMeta(log) : '') +
        '</div>';
    }

    function renderEmpty() {
      var filtering = state.action || state.actor;
      return '<div class="state-block">' +
        '<div class="state-title">' +
          (filtering ? 'Aucune entrée' : 'Journal vide') + '</div>' +
        '<div>' + (filtering
          ? 'Aucune entrée ne correspond à ces filtres.'
          : 'Les actions effectuées dans la console apparaîtront ici.') + '</div>' +
        '</div>';
    }

    function render() {
      var list = filtered();
      var page = h.paginate(list, state.page, PAGE_SIZE);
      state.page = page.page;

      bodyNode.innerHTML = list.length
        ? page.items.map(renderRow).join('') + page.controls
        : renderEmpty();

      subtitle.textContent = subtitleText(list);
    }

    /* Le compte porte sur ce qui est montré, pas sur la page. Quand un filtre
       est posé, on rappelle sur quel ensemble il mord : sans cela, « 4 entrées »
       ne dit pas si le journal en contient quatre ou quatre cents. */
    function subtitleText(list) {
      if (state.actor) {
        return h.plural(list.length, 'entrée') + ' sur ' + state.logs.length;
      }
      if (state.action) {
        return h.plural(list.length, 'entrée') + ' · ' + actionOf(state.action).label;
      }
      return h.plural(list.length, 'entrée') + ', de la plus récente à la plus ancienne';
    }

    /* --- Interactions ------------------------------------------------------- */

    /* Changer de filtre change le jeu paginé : on revient page 1 et on referme
       la ligne dépliée, qui peut ne plus être là. */
    function resetView() {
      state.page = 1;
      state.openId = null;
    }

    actionSelect.addEventListener('change', function () {
      state.action = actionSelect.value;
      resetView();
      // L'action est un paramètre du serveur : il faut redemander la liste.
      load();
    });

    var actorTimer = null;
    actorInput.addEventListener('input', function () {
      // Anti-rebond, comme sur les autres écrans : on ne redessine pas à
      // chaque frappe.
      clearTimeout(actorTimer);
      actorTimer = setTimeout(function () {
        state.actor = actorInput.value.trim();
        resetView();
        if (state.loaded) render();
      }, 160);
    });

    h.on(view, 'click', '[data-action]', function (event, target) {
      var action = target.getAttribute('data-action');
      if (action === 'toggle') {
        var id = target.getAttribute('data-id');
        state.openId = state.openId === id ? null : id;
        render();
      } else if (action === 'page-prev' || action === 'page-next') {
        state.page += (action === 'page-next' ? 1 : -1);
        // La ligne dépliée appartient à la page qu'on quitte.
        state.openId = null;
        render();
      } else if (action === 'retry') {
        load();
      }
    });

    /* --- Chargement --------------------------------------------------------- */

    function load() {
      state.loaded = false;
      bodyNode.innerHTML =
        '<div class="skeleton-card" style="height:56px"></div>' +
        '<div class="skeleton-card" style="height:56px"></div>' +
        '<div class="skeleton-card" style="height:56px"></div>';
      subtitle.textContent = 'Chargement…';

      // Le serveur trie déjà du plus récent au plus ancien : on garde son ordre.
      return App.api.listLogs({ action: state.action }).then(function (list) {
        if (destroyed) return;
        state.logs = list;
        state.loaded = true;
        render();
      }).catch(function (error) {
        if (destroyed) return;
        state.loaded = false;
        subtitle.textContent = 'Chargement impossible';
        bodyNode.innerHTML =
          '<div class="state-block error">' +
            '<div class="state-title">Impossible de charger le journal</div>' +
            '<div>' + esc(error.message) + '</div>' +
            '<div class="state-actions">' +
              '<button type="button" data-action="retry">' +
                icon('refresh') + 'Réessayer</button>' +
            '</div>' +
          '</div>';
      });
    }

    load();

    return {
      destroy: function () {
        destroyed = true;
        clearTimeout(actorTimer);
      }
    };
  }

  App.screens = App.screens || {};
  App.screens.logs = { mount: mount };
})(window);
