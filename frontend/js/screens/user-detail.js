/* Écran 6 bis — Fiche d'un compte (#/users/:id).

   Lecture seule, comme la liste dont elle vient : la console ne modifie pas
   les comptes, elle les consulte. Rien à enregistrer, donc pas de garde de
   navigation ni d'action destructrice — le seul chemin de sortie est le
   retour à la liste.

   La fiche ne rejoue pas ce que la liste affichait : le serveur ne renvoie ici
   ni le nombre de discussions ni le téléphone, et on n'invente pas ces champs
   pour combler la mise en page. Ce qu'elle apporte, c'est le détail des
   procédures suivies et celui de la consommation de jetons — le compteur
   d'appels et la ventilation par fonctionnalité, que la liste n'a pas. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;
  var charts = App.charts;

  var LIST_ROUTE = '#/users';

  /* Les fonctionnalites qui appellent le modele. La cle vient du serveur
     (colonne « feature » de token_usage), le libelle est pour l'ecran : un
     administrateur n'a pas a savoir que la recherche de bureaux s'appelle
     « agent » dans la base.

     Les teintes sont prises dans la palette categorielle validee de
     js/charts.js. Elles ne portent jamais seules le sens — chaque ligne
     affiche son libelle, son total et son nombre d'appels — elles ne font
     que relier la barre a sa ligne. */
  var FEATURES = {
    chat: { label: 'Assistant', color: '#2a78d6' },
    extraction: { label: 'Extraction de documents', color: '#7a4fd0' },
    agent: { label: 'Recherche de bureaux', color: '#0b8f9e' }
  };

  // Une cle inconnue garde sa valeur brute plutot que de disparaitre : une
  // fonctionnalite ajoutee cote serveur doit rester visible ici sans livraison.
  function featureView(key) {
    return FEATURES[key] || { label: key || 'Fonctionnalité inconnue', color: '#5f6b76' };
  }

  /* Les deux statuts du suivi, côté serveur : « en_cours » et « termine ».
     Un statut inconnu garde sa valeur brute dans une pastille neutre plutôt
     que de disparaître — un suivi sans état visible se lirait comme un oubli
     d'affichage. */
  var STATUSES = {
    en_cours: { label: 'En cours', tone: 'pill-accent' },
    termine: { label: 'Terminé', tone: 'pill-success' }
  };

  function statusOf(raw) {
    var key = String(raw === null || raw === undefined ? '' : raw).toLowerCase().trim();
    return STATUSES[key] ||
      { label: key ? raw : 'Statut inconnu', tone: 'pill-neutral' };
  }

  // Mêmes règles que sur la liste : voir js/screens/users.js.
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

  function mount(root, params) {
    var userId = params.id;

    var view = document.createElement('div');
    root.appendChild(view);

    var destroyed = false;

    function backLink() {
      return '<button type="button" class="back-link" data-action="back">' +
        icon('arrow-left') + '<span>Utilisateurs</span></button>';
    }

    /* --- Rendu -------------------------------------------------------------- */

    function renderProfile(user) {
      return '<div class="card user-profile">' +
          '<span class="avatar avatar-xl" aria-hidden="true">' +
            esc(initials(user)) + '</span>' +
          '<div class="user-profile-main">' +
            '<div class="user-profile-name">' +
              '<h1 dir="auto">' + esc(fullName(user)) + '</h1>' +
              '<span class="pill ' +
                (user.role === 'admin' ? 'pill-accent' : 'pill-neutral') + '">' +
                esc(roleLabel(user.role)) + '</span>' +
            '</div>' +
            '<div class="user-handle" dir="auto">' + esc(user.username) + '</div>' +
            '<div class="user-profile-bits">' +
              '<span class="user-mail" dir="auto">' + esc(user.email) + '</span>' +
              '<span class="user-date">' + icon('calendar', 'icon-sm') +
                '<span>' + (user.createdAt
                  ? 'Inscrit le ' + esc(h.formatDate(user.createdAt))
                  : 'Date d\'inscription inconnue') + '</span>' +
              '</span>' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    /* --- Consommation de jetons ------------------------------------------

       Trois choses, dans cet ordre : le total, ce qui le compose, et depuis
       quand on mesure. La ventilation est le cœur du bloc — 200 000 jetons
       venus de quatre extractions de documents et 200 000 jetons venus de
       conversations ne racontent pas la même chose, et seul le détail par
       fonctionnalité fait la différence. */

    function tokenTotals(user) {
      return '<div class="token-totals">' +
          '<div class="token-figure">' +
            '<div class="token-value">' + esc(charts.fmt(user.totalTokens)) + '</div>' +
            '<div class="token-unit">' +
              esc(Math.abs(user.totalTokens) >= 2 ? 'tokens' : 'token') + '</div>' +
          '</div>' +
          '<div class="user-chips">' +
            '<span class="meta-chip">' + icon('upload', 'icon-sm') +
              esc(charts.fmt(user.promptTokens) + ' en entrée') + '</span>' +
            '<span class="meta-chip">' + icon('send', 'icon-sm') +
              esc(charts.fmt(user.outputTokens) + ' en sortie') + '</span>' +
            // « appels au modele » et non « reponses » : le compteur couvre
            // desormais l'extraction et la recherche de bureaux, pas seulement
            // les reponses de l'assistant.
            '<span class="meta-chip">' + icon('sparkles', 'icon-sm') +
              esc(h.plural(user.tokenCalls, 'appel au modèle', 'appels au modèle')) +
              '</span>' +
          '</div>' +
        '</div>';
    }

    /* Une ligne par fonctionnalité, dans la disposition des statuts du tableau
       de bord : le libellé, le total, la part, puis la barre sur toute la
       largeur. La part se calcule sur la somme des lignes et non sur le total
       du compte — les deux coïncident côté serveur, mais si jamais ils
       divergeaient, des pourcentages qui ne font pas 100 se verraient plus
       qu'un total en trop. */
    function featureRow(line, sum) {
      var view = featureView(line.feature);
      var ratio = sum ? line.total / sum : 0;

      return '<div class="status-row">' +
          '<span class="status-key">' +
            '<span class="status-dot" style="background:' + view.color + '"></span>' +
            '<span dir="auto">' + esc(view.label) + '</span>' +
          '</span>' +
          '<span class="status-count">' + esc(charts.fmt(line.total)) + '</span>' +
          '<span class="status-pct">' + Math.round(ratio * 100) + ' %</span>' +
          '<span class="feature-calls">' +
            esc(h.plural(line.calls, 'appel', 'appels')) + '</span>' +
          charts.meter(ratio, view.color) +
        '</div>';
    }

    function renderTokensBlock(user) {
      var lines = user.tokensByFeature;
      var sum = lines.reduce(function (total, line) {
        return total + line.total;
      }, 0);

      var breakdown = lines.length
        ? '<div class="status-list">' +
            lines.map(function (line) { return featureRow(line, sum); }).join('') +
          '</div>'
        : '<div class="token-empty">Aucune consommation enregistrée.</div>';

      return '<div class="card user-tokens">' +
          '<div class="detail-title">Consommation de tokens</div>' +
          tokenTotals(user) +
          '<div class="detail-title token-breakdown-title">' +
            'Répartition par fonctionnalité</div>' +
          breakdown +
          /* Le compteur est parti de zero le jour ou la table « token_usage »
             est apparue : un compte actif de longue date affiche donc moins
             que ce qu'il a reellement consomme. Le dire evite de lire le
             chiffre comme un historique complet. */
          '<p class="token-note">La mesure de consommation a été mise en place ' +
            'récemment : les appels antérieurs ne sont pas comptabilisés.</p>' +
        '</div>';
    }

    /* Le titre, l'administration en dessous, le statut à droite : la même
       disposition que les cartes de suivi de l'espace citoyen, pour que la
       même information se lise au même endroit des deux côtés. */
    function renderTracked(item) {
      var status = statusOf(item.status);
      return '<div class="user-proc-row">' +
          '<div class="user-proc-main">' +
            '<div class="user-proc-title" dir="auto">' +
              esc(item.procedureTitle) + '</div>' +
            (item.administration
              ? '<div class="user-proc-admin" dir="auto">' +
                  esc(item.administration) + '</div>'
              : '<div class="user-proc-admin is-empty">Administration non renseignée</div>') +
          '</div>' +
          '<span class="pill ' + status.tone + '">' + esc(status.label) + '</span>' +
        '</div>';
    }

    function renderTrackedBlock(user) {
      if (!user.tracked.length) {
        return '<div class="state-block">' +
          '<div class="state-title">Aucune procédure suivie</div>' +
          '<div>Ce compte n\'a encore mis aucune procédure en suivi.</div>' +
        '</div>';
      }
      return '<div class="card user-procs">' +
          '<div class="detail-title">Procédures suivies' +
            '<span class="detail-count">' + user.tracked.length + '</span></div>' +
          user.tracked.map(renderTracked).join('') +
        '</div>';
    }

    function render(user) {
      view.innerHTML = backLink() +
        renderProfile(user) +
        renderTokensBlock(user) +
        renderTrackedBlock(user);
    }

    function renderLoading() {
      view.innerHTML = backLink() +
        '<div class="skeleton-card" style="height:96px"></div>' +
        '<div class="skeleton-card" style="height:188px"></div>' +
        '<div class="skeleton-card" style="height:132px"></div>';
    }

    function renderError(message) {
      view.innerHTML = backLink() +
        '<div class="state-block error">' +
          '<div class="state-title">Impossible d\'ouvrir cette fiche</div>' +
          '<div>' + esc(message) + '</div>' +
          '<div class="state-actions">' +
            '<button type="button" data-action="retry">' +
              icon('refresh') + 'Réessayer</button>' +
          '</div>' +
        '</div>';
    }

    /* --- Interactions ------------------------------------------------------- */

    h.on(view, 'click', '[data-action]', function (event, target) {
      var action = target.getAttribute('data-action');
      if (action === 'back') App.router.navigate(LIST_ROUTE);
      else if (action === 'retry') load();
    });

    /* --- Chargement --------------------------------------------------------- */

    function load() {
      renderLoading();
      return App.api.getUser(userId).then(function (user) {
        if (destroyed) return;
        render(user);
      }).catch(function (error) {
        if (destroyed) return;
        renderError(error.message);
      });
    }

    load();

    return {
      destroy: function () {
        destroyed = true;
      }
    };
  }

  App.screens = App.screens || {};
  App.screens.userDetail = { mount: mount };
})(window);
