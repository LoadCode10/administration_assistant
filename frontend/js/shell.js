/* Coque de l'application : en-tête (logo + bienvenue) et barre latérale.

   Rendue au démarrage, en dehors de #screen-root : le routeur vide ce
   conteneur à chaque navigation, la coque n'est donc pas reconstruite entre
   deux écrans. Seul l'état actif des liens est mis à jour.

   Toute la navigation dérive du rôle de la personne connectée — les entrées de
   menu, le sous-titre de l'en-tête, la cible du logo. Elle se reconstruit donc
   quand la session change : connexion, déconnexion, expiration.

   Les écrans de connexion et d'inscription se rendent sans elle : le routeur
   appelle setChrome(false) avant de les monter. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  /* Navigation par rôle. Chaque rôle a la même forme : une liste de groupes,
     chaque groupe une liste d'entrées. match(parts) décide si la route
     courante active l'entrée ; `parts` est le hash découpé, ex.
     ['extractions', 'e2']. */
  var NAV = {
    admin: [
      {
        group: 'Pilotage',
        items: [
          { hash: '#/dashboard', label: 'Tableau de bord', icon: 'grid',
            match: function (p) { return p[0] === 'dashboard'; } },
          // Le journal surveille, il ne gere pas : sa place est ici, a cote du
          // tableau de bord, et non dans le groupe « Gestion ».
          { hash: '#/logs', label: 'Journal', icon: 'clock',
            match: function (p) { return p[0] === 'logs'; } }
        ]
      },
      {
        group: 'Gestion',
        items: [
          { hash: '#/documents', label: 'Documents', icon: 'file-text',
            // L'éditeur reste rattaché aux documents : on ouvre un JSON issu d'un document.
            match: function (p) { return p[0] === 'documents' || p[0] === 'extractions'; } },
          { hash: '#/procedures', label: 'Procédures', icon: 'list',
            match: function (p) { return p[0] === 'procedures' && !p[1]; } },
          { hash: '#/procedures/pieces', label: 'Pièces requises', icon: 'layers', sub: true,
            match: function (p) { return p[0] === 'procedures' && p[1] === 'pieces'; } },
          { hash: '#/administrations', label: 'Administrations', icon: 'building',
            match: function (p) { return p[0] === 'administrations'; } },
          { hash: '#/users', label: 'Utilisateurs', icon: 'users',
            // La fiche d'un compte reste rattachee a la liste : #/users/:id.
            match: function (p) { return p[0] === 'users'; } }
        ]
      }
    ],

    citizen: [
      {
        group: 'Espace citoyen',
        items: [
          { hash: '#/chat', label: 'Assistant', icon: 'sparkles',
            match: function (p) { return p[0] === 'chat'; } },
          { hash: '#/suivi', label: 'Mes procédures', icon: 'check',
            match: function (p) { return p[0] === 'suivi'; } }
        ]
      }
    ]
  };

  var shell = {};

  /* État de la colonne. Le fil des discussions est rendu ici, mais il n'est pas
     chargé ici : c'est l'écran Assistant qui appelle le serveur et pousse sa
     liste par setConversations(). La coque ne fait jamais d'appel API — elle
     dessine, l'écran va chercher. */
  var state = {
    hash: '',                   // route courante : décide si le fil s'affiche
    conversations: [],
    // Distingue « pas encore chargé » de « aucune discussion » : annoncer un
    // historique vide pendant le chargement ferait croire qu'il est perdu.
    conversationsLoaded: false,
    activeConversationId: null,
    // Les pastilles survivent au redessin de la colonne, qui a lieu à chaque
    // navigation depuis que le fil en fait partie.
    badges: {},
    // { create: fn, select: fn, remove: fn } posés par l'écran Assistant,
    // retirés en partant : sans écran monté, un clic dans le fil n'a personne
    // à appeler.
    conversationHandlers: null
  };

  var CONVERSATION_TITLE_MAX = 60;

  function role() {
    return (App.auth && App.auth.getRole()) || 'admin';
  }

  function routeParts(hash) {
    return (hash || '').replace(/^#\/?/, '').split('/')
      .filter(function (part) { return part.length > 0; });
  }

  /* Le fil ne suit pas le rôle mais l'écran : sur « Mes procédures » la colonne
     n'affiche que les deux entrées de navigation. */
  function showsConversations() {
    return role() === 'citizen' && routeParts(state.hash)[0] === 'chat';
  }

  function currentNav() {
    return NAV[role()] || NAV.admin;
  }

  /* --- En-tête ------------------------------------------------------------ */

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); }).join('');
  }

  /* L'en-tete porte le nom reel et ses initiales. Sans session — juste avant
     une redirection vers la connexion — il ne porte rien : un « Bienvenue, »
     sans nom se remarquerait plus que le vide. */
  function renderUser(user) {
    var node = document.getElementById('topbar-user');
    if (!node) return;
    if (!user) {
      node.innerHTML = '';
      return;
    }
    node.innerHTML =
      '<span class="welcome">' +
        '<span class="welcome-hi">Bienvenue,</span> ' +
        '<span class="welcome-name" dir="auto">' + esc(user.name) + '</span>' +
      '</span>' +
      '<span class="avatar" title="' + esc(user.roleLabel || user.role || '') + '" aria-hidden="true">' +
        esc(initials(user.name)) + '</span>';
  }

  /* Le sous-titre du logo dit dans quelle application on se trouve, et le logo
     ramène à l'accueil du rôle : pour un citoyen, « Tableau de bord » n'existe
     pas. */
  function renderBrand() {
    if (!App.auth) return;
    var sub = document.querySelector('.brand-sub');
    var brand = document.querySelector('.brand');
    if (sub) sub.textContent = App.auth.subtitle();
    if (brand) brand.setAttribute('href', App.auth.defaultRoute());
  }

  /* --- Barre latérale ----------------------------------------------------- */

  /* Le fil des discussions, sous l'entrée « Assistant ». Il porte le même
     retrait que « Pièces requises » sous « Procédures » — posé sur le bloc,
     voir .nav-conv dans styles.css : ce sont des sous-entrées de l'écran
     au-dessus, pas une troisième destination. */
  function renderConversations() {
    return '<div class="nav-conv">' +
      '<button type="button" class="nav-conv-new" data-action="new-conversation">' +
        icon('plus', 'icon-sm') + '<span>Nouvelle discussion</span>' +
      '</button>' +
      (!state.conversationsLoaded
        ? '<p class="nav-conv-empty">Chargement…</p>'
        : state.conversations.length
        ? state.conversations.map(function (conversation) {
            var isActive = state.activeConversationId !== null &&
              String(conversation.id) === String(state.activeConversationId);
            var title = h.truncate(conversation.title, CONVERSATION_TITLE_MAX);
            /* La corbeille est un frere du bouton de la discussion, pas un
               enfant : un bouton dans un bouton n'est pas du HTML valide, et
               la delegation sur [data-conversation] attraperait le clic. */
            return '<div class="nav-conv-row' + (isActive ? ' is-active' : '') + '">' +
              '<button type="button" class="nav-conv-item' +
                (isActive ? ' is-active' : '') + '" ' +
                'data-conversation="' + esc(conversation.id) + '"' +
                (isActive ? ' aria-current="true"' : '') + '>' +
                '<span class="nav-conv-title" dir="auto">' +
                  esc(title) + '</span>' +
                '<span class="nav-conv-date">' +
                  esc(h.formatRelative(conversation.updatedAt)) + '</span>' +
              '</button>' +
              '<button type="button" class="nav-conv-delete" ' +
                'data-delete-conversation="' + esc(conversation.id) + '" ' +
                'title="Supprimer" aria-label="Supprimer la discussion ' +
                esc(title) + '">' + icon('trash', 'icon-sm') + '</button>' +
              '</div>';
          }).join('')
        : '<p class="nav-conv-empty">Aucune discussion pour le moment.</p>') +
      '</div>';
  }

  function renderSidebar() {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    var withConversations = showsConversations();

    sidebar.innerHTML = currentNav().map(function (section) {
      return '<div class="nav-group">' +
        '<div class="nav-group-title">' + esc(section.group) + '</div>' +
        section.items.map(function (item) {
          return '<a class="nav-item' + (item.sub ? ' is-sub' : '') + '" ' +
            'href="' + item.hash + '" data-nav="' + esc(item.hash) + '">' +
            icon(item.icon) + '<span>' + esc(item.label) + '</span>' +
            '<span class="nav-badge" data-badge="' + esc(item.hash) + '" hidden></span>' +
            '</a>' +
            // Les discussions s'intercalent : « Mes procédures » reste dessous.
            (withConversations && item.hash === '#/chat' ? renderConversations() : '');
        }).join('') +
        '</div>';
    }).join('') +
      '<div class="nav-foot">' +
        (App.config.USE_MOCK
          ? '<div class="nav-note">' + icon('info', 'icon-sm') +
            '<span>Mode démonstration — données factices</span></div>'
          : '') +
        // Derniere chose de la colonne, detachee de la navigation : on ne
        // change pas d'ecran, on quitte l'application.
        '<button type="button" class="nav-logout" data-action="logout">' +
          icon('log-out') + '<span>Se déconnecter</span>' +
        '</button>' +
      '</div>';

    // La colonne vient d'être reconstruite : on lui rend ce qu'elle portait.
    Object.keys(state.badges).forEach(function (hash) {
      paintBadge(hash, state.badges[hash]);
    });
    paintActive();
  }

  /* Met en avant l'entrée correspondant à la route courante. */
  function paintActive() {
    var parts = routeParts(state.hash);

    var links = document.querySelectorAll('.nav-item');
    for (var i = 0; i < links.length; i++) links[i].classList.remove('is-active');

    currentNav().forEach(function (section) {
      section.items.forEach(function (item) {
        if (!item.match(parts)) return;
        var link = document.querySelector('[data-nav="' + item.hash + '"]');
        if (link) link.classList.add('is-active');
      });
    });
  }

  function paintBadge(hash, count) {
    var badge = document.querySelector('[data-badge="' + hash + '"]');
    if (!badge) return;
    badge.hidden = !count;
    badge.textContent = count || '';
  }

  /* Appelé par le routeur après chaque résolution. La colonne est redessinée
     et non simplement re-soulignée : le fil des discussions n'appartient qu'à
     l'écran Assistant, il apparaît et disparaît avec la route. */
  shell.setActive = function (hash) {
    state.hash = hash || '';
    renderSidebar();
    closeSidebar();
  };

  /* Pastille de compteur sur une entrée (ex. documents à vérifier). */
  shell.setBadge = function (hash, count) {
    state.badges[hash] = count;
    paintBadge(hash, count);
  };

  /* --- Fil des discussions : ce que l'écran Assistant pousse --------------- */

  /* list : discussions déjà normalisées et triées par l'écran (plus récente en
     tête), ou null tant que rien n'est chargé — l'écran passe null en partant
     pour que le prochain montage reparte sur « Chargement… » et non sur un
     historique vide. activeId : celle qui est ouverte, null pour une
     discussion neuve pas encore créée côté serveur. */
  shell.setConversations = function (list, activeId) {
    state.conversations = list || [];
    state.conversationsLoaded = !!list;
    state.activeConversationId = activeId === undefined ? null : activeId;
    if (showsConversations()) renderSidebar();
  };

  /* handlers : { create: fn, select: fn(id), remove: fn(id) } — posés au
     montage de l'écran, remis à null à sa destruction. La coque n'efface
     rien elle-même : elle signale le clic sur la corbeille, l'écran confirme
     et appelle le serveur. */
  shell.setConversationHandlers = function (handlers) {
    state.conversationHandlers = handlers || null;
  };

  function callConversationHandler(name, argument) {
    var handlers = state.conversationHandlers;
    if (handlers && handlers[name]) handlers[name](argument);
  }

  /* --- Repli mobile ------------------------------------------------------- */

  function openSidebar() {
    document.getElementById('sidebar').classList.add('is-open');
    document.getElementById('sidebar-scrim').hidden = false;
    document.getElementById('menu-toggle').setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    sidebar.classList.remove('is-open');
    document.getElementById('sidebar-scrim').hidden = true;
    document.getElementById('menu-toggle').setAttribute('aria-expanded', 'false');
  }

  /* Redessine tout ce qui derive de la session. */
  function render() {
    renderBrand();
    renderSidebar();
    renderUser(App.auth ? App.auth.getUser() : null);
  }

  /* Affiche ou masque l'en-tete et la barre laterale. Appele par le routeur
     avant chaque montage : les ecrans de connexion et d'inscription occupent la
     page entiere, tous les autres gardent la coque. La classe est posee sur
     <body> parce que la mise en page de .layout change avec elle — une seule
     colonne, sans ligne d'en-tete. */
  shell.setChrome = function (visible) {
    document.body.classList.toggle('is-standalone', !visible);
    if (!visible) closeSidebar();
  };

  shell.init = function () {
    render();

    /* Etat de depart, avant meme la premiere resolution de route : sans
       session, la page part sur l'ecran de connexion, la coque n'a donc pas a
       apparaitre le temps d'une image. Le routeur retranchera ensuite a chaque
       navigation. */
    shell.setChrome(App.auth.isAuthenticated());

    /* La session a change : connexion, deconnexion, ou expiration reperee par
       request(). Toute la coque en depend — le menu du role, le sous-titre, le
       nom affiche — donc on la redessine en entier. La navigation qui suit est
       decidee par qui a provoque le changement, pas ici. */
    App.auth.onChange(render);

    // La barre latérale est reconstruite à chaque navigation : les
    // gestionnaires sont posés sur le conteneur, qui lui ne bouge pas.
    var sidebar = document.getElementById('sidebar');

    h.on(sidebar, 'click', '[data-action="logout"]', function () {
      App.modals.logout();
    });

    // Les actions du fil ne sont pas traitées ici : elles repartent vers
    // l'écran Assistant, seul détenteur de l'état de la conversation.
    h.on(sidebar, 'click', '[data-action="new-conversation"]', function () {
      callConversationHandler('create');
      closeSidebar();
    });

    h.on(sidebar, 'click', '[data-conversation]', function (event, target) {
      callConversationHandler('select', target.getAttribute('data-conversation'));
      closeSidebar();
    });

    /* stopPropagation : supprimer une discussion ne doit pas, au passage,
       l'ouvrir. La colonne reste ouverte — la confirmation s'affiche
       par-dessus, et on efface souvent plusieurs discussions de suite. */
    h.on(sidebar, 'click', '[data-delete-conversation]', function (event, target) {
      event.stopPropagation();
      callConversationHandler('remove', target.getAttribute('data-delete-conversation'));
    });

    var toggle = document.getElementById('menu-toggle');
    var scrim = document.getElementById('sidebar-scrim');
    toggle.addEventListener('click', function () {
      if (document.getElementById('sidebar').classList.contains('is-open')) closeSidebar();
      else openSidebar();
    });
    scrim.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeSidebar();
    });
  };

  App.shell = shell;
})(window);
