/* Écran 6 — Utilisateurs (#/users) : les comptes inscrits et leur activité.

   Lecture seule, et réservé aux administrateurs : rien ne se crée, ne se
   modifie ni ne se supprime ici. L'écran répond à une seule question — qui
   utilise l'application, et depuis quand — d'où la carte plutôt que la ligne
   de tableau : le nom, l'identifiant et le courriel tiennent ensemble, et les
   compteurs disent d'un coup d'œil si le compte sert.

   Le serveur trie déjà, le plus récent inscrit en tête. La recherche filtre
   donc côté client, comme sur l'écran « Administrations » : il y a au plus
   quelques centaines de comptes, et un aller-retour par frappe n'apporterait
   rien.

   Deux lectures de la consommation de jetons, et elles ne se recouvrent pas :
   le chiffre sur chaque carte dit combien un compte a consommé DEPUIS SON
   INSCRIPTION, le graphique dit QUAND les dix plus gros ont consommé. Le
   premier suit la recherche et la pagination, le second jamais — il porte
   toujours sur les dix premiers de toute la base. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;
  var charts = App.charts;

  // Périodes du graphique. 30 jours par défaut : assez long pour montrer une
  // habitude, assez court pour que chaque journée reste distincte.
  var PERIODS = [7, 30, 90];
  var DEFAULT_PERIOD = 30;

  // Le serveur ne renvoie jamais plus de séries que cela, et la palette du
  // graphique n'a pas davantage de teintes lisibles.
  var TOP = 10;

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

  /* « AAAA-MM-JJ » lu comme une date LOCALE. new Date('2026-08-15') tombe à
     minuit UTC : à l'ouest de Greenwich l'étiquette reculerait d'un jour, et
     le graphique serait décalé par rapport aux cartes. */
  function parseDay(value) {
    var parts = String(value).split('-');
    if (parts.length !== 3) return null;
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return isNaN(date.getTime()) ? null : date;
  }

  // Étiquette d'axe : « 15/08 ». La date entière est au survol, elle n'a pas
  // besoin de tenir sous chaque graduation.
  function shortDay(value) {
    var parts = String(value).split('-');
    return parts.length === 3 ? parts[2] + '/' + parts[1] : String(value);
  }

  // « 45 200 tokens », séparateur de milliers compris — c'est le formateur des
  // graphiques, le même que celui des tuiles du tableau de bord.
  function tokenLabel(total) {
    return charts.fmt(total) + (Math.abs(total) >= 2 ? ' tokens' : ' token');
  }

  function mount(root) {
    var view = document.createElement('div');
    root.appendChild(view);

    var state = {
      users: [],
      query: '',
      // « recent » = l'ordre du serveur, inchangé ; « tokens » = du plus gros
      // consommateur au plus petit.
      sort: 'recent',
      loaded: false,
      // Page courante du découpage client (voir App.helpers.paginate).
      page: 1,
      // Le graphique a son propre cycle de chargement : il se recharge seul
      // quand on change de période, et son échec ne touche pas la liste.
      tokens: {
        status: 'loading',   // loading | ready | error
        days: DEFAULT_PERIOD,
        series: [],
        error: ''
      }
    };

    var destroyed = false;

    view.innerHTML =
      '<div class="screen-header">' +
        '<div>' +
          '<h1>Utilisateurs</h1>' +
          '<p class="subtitle" id="users-subtitle">Chargement…</p>' +
        '</div>' +
      '</div>' +
      '<section class="card chart-card tokens-card" id="tokens-card"></section>' +
      '<div class="toolbar">' +
        '<label class="select-field">' +
          '<span class="select-label">Trier</span>' +
          '<select id="users-sort" aria-label="Trier les comptes">' +
            '<option value="recent">Inscription la plus récente</option>' +
            '<option value="tokens">Consommation de tokens</option>' +
          '</select>' +
        '</label>' +
        '<label class="search">' + icon('search', 'icon-sm') +
          '<input type="search" dir="auto" id="users-search" ' +
            'placeholder="Rechercher un nom, un identifiant, un courriel…" ' +
            'aria-label="Rechercher un compte">' +
        '</label>' +
      '</div>' +
      '<div id="users-body">' +
        '<div class="user-grid">' +
          '<div class="skeleton-card" style="height:156px"></div>' +
          '<div class="skeleton-card" style="height:156px"></div>' +
          '<div class="skeleton-card" style="height:156px"></div>' +
        '</div>' +
      '</div>';

    var bodyNode = view.querySelector('#users-body');
    var subtitle = view.querySelector('#users-subtitle');
    var searchInput = view.querySelector('#users-search');
    var sortSelect = view.querySelector('#users-sort');
    var tokensCard = view.querySelector('#tokens-card');

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

    /* Le tri par consommation travaille sur une COPIE : l'ordre du serveur
       reste la référence, et c'est lui qu'on retrouve intact en revenant au
       tri par défaut. */
    function ordered(list) {
      if (state.sort !== 'tokens') return list;
      return list.slice().sort(function (a, b) {
        return (b.totalTokens || 0) - (a.totalTokens || 0);
      });
    }

    function adminCount() {
      return state.users.filter(function (user) {
        return user.role === 'admin';
      }).length;
    }

    /* --- Rendu de la liste --------------------------------------------------- */

    /* Un compte à zéro garde sa pastille, en gris : la masquer laisserait
       croire que l'information manque, alors qu'un compte inactif est
       justement ce qu'un administrateur cherche à repérer. */
    function tokenChip(user) {
      var total = user.totalTokens || 0;
      return '<span class="meta-chip' + (total ? '' : ' is-quiet') + '">' +
        icon('layers', 'icon-sm') + esc(tokenLabel(total)) + '</span>';
    }

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
            tokenChip(user) +
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
      var list = ordered(filtered());
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

    /* --- Rendu du graphique -------------------------------------------------- */

    /* Les séries telles que les attend App.charts.linesMulti. L'ordre reçu est
       conservé tel quel : c'est lui qui fixe la couleur de chaque ligne et
       l'ordre de la légende, du plus gros consommateur au plus petit. */
    function chartSeries() {
      return state.tokens.series.map(function (serie) {
        return {
          label: serie.username || serie.id || 'Compte',
          total: serie.total,
          points: serie.points.map(function (point) {
            var date = parseDay(point.date);
            return {
              label: shortDay(point.date),
              full: date ? h.formatDate(date) : point.date,
              value: point.total
            };
          })
        };
      });
    }

    function periodTabs() {
      return '<div class="tabs" role="group" aria-label="Période du graphique">' +
        PERIODS.map(function (days) {
          var active = days === state.tokens.days;
          return '<button type="button" class="tab' + (active ? ' is-active' : '') +
            '" data-action="tokens-period" data-days="' + days + '" ' +
            'aria-pressed="' + (active ? 'true' : 'false') + '">' +
            days + ' jours</button>';
        }).join('') +
        '</div>';
    }

    function tokensSubtitle(series) {
      if (state.tokens.status === 'loading') return 'Chargement…';
      if (state.tokens.status === 'error') return 'Graphique indisponible';
      if (!series.length) return h.plural(state.tokens.days, 'dernier jour', 'derniers jours');

      var total = series.reduce(function (sum, serie) { return sum + serie.total; }, 0);
      return h.plural(state.tokens.days, 'dernier jour', 'derniers jours') + ' · ' +
        charts.fmt(total) + ' tokens · ' + h.plural(series.length, 'compte');
    }

    function tokensBody(series) {
      if (state.tokens.status === 'loading') {
        return '<div class="skeleton-card" style="height:240px;margin:0"></div>';
      }

      if (state.tokens.status === 'error') {
        /* La liste des comptes, elle, est déjà à l'écran : on ne remplace que
           le contenu de cette carte. */
        return '<div class="state-block error" style="margin:0">' +
          '<div class="state-title">Consommation indisponible</div>' +
          '<div>' + esc(state.tokens.error) + '</div>' +
          '<div class="state-actions">' +
            '<button type="button" data-action="tokens-retry">' +
              icon('refresh') + 'Réessayer</button>' +
          '</div>' +
          '</div>';
      }

      // Aucune série, ou dix séries entièrement à zéro : dans les deux cas il
      // n'y a rien à tracer, et une grille vide ne le dirait pas.
      var consumed = series.some(function (serie) { return serie.total > 0; });
      if (!series.length || !consumed) {
        return '<div class="chart-empty">Aucune consommation sur la période.</div>';
      }

      return '<div id="chart-tokens"></div>';
    }

    function renderTokens() {
      var series = chartSeries();

      // Le ResizeObserver du tracé précédent ne doit pas survivre au remplacement.
      charts.destroyAll(tokensCard);

      tokensCard.innerHTML =
        '<div class="chart-head">' +
          '<div>' +
            '<h2>Consommation de tokens — ' + TOP + ' plus gros consommateurs</h2>' +
            '<p class="chart-sub">' + esc(tokensSubtitle(series)) + '</p>' +
          '</div>' +
          periodTabs() +
        '</div>' +
        tokensBody(series);

      var canvas = tokensCard.querySelector('#chart-tokens');
      if (!canvas) return;

      charts.linesMulti(canvas, {
        series: series,
        unit: 'tokens',
        height: 240,
        ariaLabel: 'Jetons consommés par jour et par compte, sur ' +
          state.tokens.days + ' jours'
      });
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

    sortSelect.addEventListener('change', function () {
      state.sort = sortSelect.value === 'tokens' ? 'tokens' : 'recent';
      // Changer de tri rebat toute la liste : la page courante ne désigne plus
      // les mêmes comptes, on revient au début.
      state.page = 1;
      if (state.loaded) render();
    });

    h.on(view, 'click', '[data-action="retry"]', function () {
      load();
    });

    /* Le graphique se recharge seul : la liste des comptes n'a pas changé, et
       la relire remettrait la recherche et la pagination à zéro pour rien. */
    h.on(view, 'click', '[data-action="tokens-period"]', function (event, target) {
      var days = Number(target.getAttribute('data-days')) || DEFAULT_PERIOD;
      if (days === state.tokens.days) return;
      loadTokens(days);
    });

    h.on(view, 'click', '[data-action="tokens-retry"]', function () {
      loadTokens(state.tokens.days);
    });

    h.on(view, 'click', '[data-action="page-prev"], [data-action="page-next"]',
      function (event, target) {
        state.page += (target.getAttribute('data-action') === 'page-next' ? 1 : -1);
        render();
      });

    /* --- Chargement --------------------------------------------------------- */

    function loadUsers() {
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

    function loadTokens(days) {
      state.tokens.days = days;
      state.tokens.status = 'loading';
      state.tokens.error = '';
      renderTokens();

      return App.api.getTokensDaily(days, TOP).then(function (payload) {
        // Réponse d'une période qu'on a quittée entre-temps : on la laisse
        // tomber, sinon le graphique afficherait 90 jours sous l'onglet 7.
        if (destroyed || state.tokens.days !== days) return;
        state.tokens.status = 'ready';
        state.tokens.series = payload.series;
        renderTokens();
      }).catch(function (error) {
        if (destroyed || state.tokens.days !== days) return;
        state.tokens.status = 'error';
        state.tokens.series = [];
        state.tokens.error = error.message;
        renderTokens();
      });
    }

    /* Les deux appels partent ensemble : la liste n'attend pas le graphique et
       le graphique n'attend pas la liste. Chacun rattrape sa propre erreur —
       Promise.all ne doit jamais voir passer d'échec ici, sinon un graphique
       en panne emporterait la liste des comptes avec lui. */
    function load() {
      return Promise.all([loadUsers(), loadTokens(state.tokens.days)]);
    }

    load();

    return {
      destroy: function () {
        destroyed = true;
        clearTimeout(searchTimer);
        // Sans cela les ResizeObserver survivent au changement d'écran.
        charts.destroyAll(view);
      }
    };
  }

  App.screens = App.screens || {};
  App.screens.users = { mount: mount };
})(window);
