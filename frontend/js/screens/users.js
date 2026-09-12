/* Écran 6 — Utilisateurs (#/users) : les comptes inscrits et leur activité.

   Lecture seule, et réservé aux administrateurs : rien ne se crée, ne se
   modifie ni ne se supprime ici. L'écran répond à une seule question — qui
   utilise l'application, et depuis quand — d'où la carte plutôt que la ligne
   de tableau : le nom, l'identifiant et le courriel tiennent ensemble, et les
   deux compteurs disent d'un coup d'œil si le compte sert.

   Le serveur trie déjà, le plus récent inscrit en tête. La recherche filtre
   donc côté client, comme sur l'écran « Administrations » : il y a au plus
   quelques centaines de comptes, et un aller-retour par frappe n'apporterait
   rien. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  function normalize(value) {
    return String(value === null || value === undefined ? '' : value).toLowerCase();
  }

  /* Même forme d'avatar que dans l'en-tête : les deux initiales, en majuscules.
     Un compte sans prénom ni nom retombe sur son identifiant — la pastille ne
     doit jamais rester vide. */
  function initials(user) {
    var letters = String(user.firstName || '').charAt(0) +
      String(user.lastName || '').charAt(0);
    if (!letters) letters = String(user.username || user.email || '?').charAt(0);
    return letters.toUpperCase();
  }

  function fullName(user) {
    return (String(user.firstName || '') + ' ' + String(user.lastName || '')).trim() ||
      String(user.username || user.email || 'Compte sans nom');
  }

  function roleLabel(role) {
    return App.auth ? App.auth.roleLabel(role) : role;
  }

  /* « Inscrit il y a deux jours » tant que c'est récent, « Inscrit le 14
     juillet 2026 » au-delà d'une semaine : h.formatRelative bascule de
     lui-même sur la date écrite, et c'est elle seule qui demande l'article.
     On les compare plutôt que de refaire le calcul des sept jours ici. */
  function registeredLabel(createdAt) {
    if (!createdAt) return 'Date d\'inscription inconnue';
    var relative = h.formatRelative(createdAt);
    if (relative === h.formatDate(createdAt)) return 'Inscrit le ' + relative;
    return 'Inscrit ' + relative;
  }

  function mount(root) {
    var view = document.createElement('div');
    root.appendChild(view);

    var state = {
      users: [],
      query: '',
      loaded: false,
      // Page courante du découpage client (voir App.helpers.paginate).
      page: 1
    };

    var destroyed = false;

    view.innerHTML =
      '<div class="screen-header">' +
        '<div>' +
          '<h1>Utilisateurs</h1>' +
          '<p class="subtitle" id="users-subtitle">Chargement…</p>' +
        '</div>' +
      '</div>' +
      '<div class="toolbar">' +
        '<label class="search">' + icon('search', 'icon-sm') +
          '<input type="search" dir="auto" id="users-search" ' +
            'placeholder="Rechercher un nom, un identifiant, un courriel…" ' +
            'aria-label="Rechercher un compte">' +
        '</label>' +
      '</div>' +
      '<div id="users-body">' +
        '<div class="user-grid">' +
          '<div class="skeleton-card" style="height:132px"></div>' +
          '<div class="skeleton-card" style="height:132px"></div>' +
          '<div class="skeleton-card" style="height:132px"></div>' +
        '</div>' +
      '</div>';

    var bodyNode = view.querySelector('#users-body');
    var subtitle = view.querySelector('#users-subtitle');
    var searchInput = view.querySelector('#users-search');

    /* --- Calculs ------------------------------------------------------------ */

    // Le nom, l'identifiant et le courriel : les trois manières de chercher
    // quelqu'un dont on ne se rappelle qu'une seule.
    function matches(user, needle) {
      return normalize(fullName(user)).indexOf(needle) !== -1 ||
        normalize(user.username).indexOf(needle) !== -1 ||
        normalize(user.email).indexOf(needle) !== -1;
    }

    function filtered() {
      if (!state.query) return state.users;
      var needle = normalize(state.query);
      return state.users.filter(function (user) { return matches(user, needle); });
    }

    function adminCount() {
      return state.users.filter(function (user) {
        return user.role === 'admin';
      }).length;
    }

    /* --- Rendu -------------------------------------------------------------- */

    /* La carte entière est le lien : viser le nom seul demanderait de savoir
       où cliquer. Le rôle est une pastille et non du texte gris — c'est la
       seule information de la carte qui change ce qu'on peut faire. */
    function renderCard(user) {
      return '<a class="user-card" href="#/users/' + esc(encodeURIComponent(user.id)) + '">' +
          '<div class="user-head">' +
            '<span class="avatar avatar-lg" aria-hidden="true">' +
              esc(initials(user)) + '</span>' +
            '<span class="user-idents">' +
              '<span class="user-name" dir="auto">' + esc(fullName(user)) + '</span>' +
              '<span class="user-handle" dir="auto">' + esc(user.username) + '</span>' +
            '</span>' +
            '<span class="pill ' +
              (user.role === 'admin' ? 'pill-accent' : 'pill-neutral') + '">' +
              esc(roleLabel(user.role)) + '</span>' +
          '</div>' +
          '<div class="user-mail" dir="auto">' + esc(user.email) + '</div>' +
          '<div class="user-chips">' +
            '<span class="meta-chip">' + icon('list', 'icon-sm') +
              esc(h.plural(user.trackedCount, 'procédure suivie', 'procédures suivies')) +
              '</span>' +
            '<span class="meta-chip">' + icon('sparkles', 'icon-sm') +
              esc(h.plural(user.conversationsCount, 'discussion')) + '</span>' +
          '</div>' +
          '<div class="user-date">' + esc(registeredLabel(user.createdAt)) + '</div>' +
        '</a>';
    }

    function renderEmpty() {
      return '<div class="state-block">' +
        '<div class="state-title">Aucun compte</div>' +
        '<div>' + (state.query
          ? 'Aucun compte ne correspond à « ' + esc(state.query) + ' ».'
          : 'Les comptes apparaissent ici dès la première inscription.') + '</div>' +
        '</div>';
    }

    function render() {
      var list = filtered();
      var page = h.paginate(list, state.page);
      state.page = page.page;

      // Les boutons se posent sous la grille, jamais dedans : ce n'est pas une
      // carte de plus.
      bodyNode.innerHTML = list.length
        ? '<div class="user-grid">' + page.items.map(renderCard).join('') + '</div>' +
          page.controls
        : renderEmpty();

      if (state.query) {
        subtitle.textContent = h.plural(list.length, 'résultat') +
          ' sur ' + state.users.length;
        return;
      }

      var admins = adminCount();
      subtitle.textContent = state.users.length
        ? h.plural(state.users.length, 'utilisateur') + ' · ' +
          h.plural(admins, 'administrateur')
        : 'Aucun compte inscrit';
    }

    /* --- Interactions ------------------------------------------------------- */

    var searchTimer = null;
    searchInput.addEventListener('input', function () {
      // Anti-rebond, comme sur les écrans « Procédures » et « Administrations ».
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.query = searchInput.value.trim();
        // Le filtre s'applique avant le découpage : on repart de la première
        // page, sinon un filtre court laisserait une grille vide à l'écran.
        state.page = 1;
        if (state.loaded) render();
      }, 160);
    });

    h.on(view, 'click', '[data-action="retry"]', function () {
      load();
    });

    h.on(view, 'click', '[data-action="page-prev"], [data-action="page-next"]',
      function (event, target) {
        state.page += (target.getAttribute('data-action') === 'page-next' ? 1 : -1);
        render();
      });

    /* --- Chargement --------------------------------------------------------- */

    function load() {
      return App.api.listUsers().then(function (list) {
        if (destroyed) return;
        // Le backend trie du plus récent au plus ancien : on garde son ordre.
        state.users = list;
        state.loaded = true;
        render();
      }).catch(function (error) {
        if (destroyed) return;
        state.loaded = false;
        subtitle.textContent = 'Chargement impossible';
        bodyNode.innerHTML =
          '<div class="state-block error">' +
            '<div class="state-title">Impossible de charger les comptes</div>' +
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
        clearTimeout(searchTimer);
      }
    };
  }

  App.screens = App.screens || {};
  App.screens.users = { mount: mount };
})(window);
