/* Session courante — seule source de vérité du frontend sur « qui est là ».

   Le jeton de session vit dans un cookie HttpOnly posé par le serveur : le
   frontend ne le lit pas, ne le stocke pas et ne l'attache pas. Il ne connaît
   que la réponse de GET /citizen/me, gardée en mémoire. Rien n'est écrit dans
   localStorage ni sessionStorage : à chaque chargement de page, on redemande.

   L'objet est renseigné une fois au démarrage (load(), appelé par js/app.js
   avant la première résolution de route), puis à la connexion (setUser) et à la
   déconnexion (clear). Le routeur et la coque ne consultent que ce module. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});

  /* Tout ce qui distingue un rôle est ici : le libellé affiché, le sous-titre
     de l'en-tête et la route d'accueil. Le routeur et la coque lisent cette
     table plutôt que de tester le rôle à la main. */
  var ROLES = {
    admin: {
      label: 'Administrateur',
      subtitle: 'Console d\'administration',
      home: '#/dashboard'
    },
    citizen: {
      label: 'Citoyen',
      subtitle: 'Espace citoyen',
      home: '#/chat'
    }
  };

  // Routes accessibles sans session ; c'est aussi là qu'on renvoie tout le reste.
  var LOGIN_ROUTE = '#/login';

  var user = null;          // { id, name, firstName, lastName, email, role, roleLabel }
  var loaded = false;       // load() a-t-il déjà tranché ?
  var listeners = [];
  // Évite d'empiler les redirections « session expirée » quand plusieurs
  // requêtes parallèles reçoivent un 401 en même temps.
  var expiring = false;

  function isRole(value) {
    return Object.prototype.hasOwnProperty.call(ROLES, String(value));
  }

  function notify() {
    listeners.slice().forEach(function (listener) { listener(user); });
  }

  var auth = {
    ROLES: ROLES,
    LOGIN_ROUTE: LOGIN_ROUTE,

    /* Interroge le serveur une fois, au démarrage. Un 401 n'est pas une panne :
       c'est la réponse « personne n'est connecté », et elle se résout en
       laissant l'utilisateur à null. Une vraie panne réseau donne le même
       résultat visible — la page de connexion — car sans /citizen/me on ne peut
       rien affirmer sur la session. */
    load: function () {
      return App.api.getMe().then(function (payload) {
        user = payload;
        loaded = true;
        return user;
      }, function () {
        user = null;
        loaded = true;
        return null;
      });
    },

    isLoaded: function () { return loaded; },
    isAuthenticated: function () { return !!user; },
    getUser: function () { return user; },
    getRole: function () { return user ? user.role : null; },

    /* Route d'accueil du rôle — celle vers laquelle on redirige une route
       interdite ou inconnue. Sans session, c'est l'écran de connexion. */
    defaultRoute: function (which) {
      var key = which || (user && user.role);
      if (!isRole(key)) return LOGIN_ROUTE;
      return ROLES[key].home;
    },

    subtitle: function (which) {
      var key = which || (user && user.role);
      return isRole(key) ? ROLES[key].subtitle : 'Console d\'administration';
    },

    roleLabel: function (which) {
      var key = which || (user && user.role);
      return isRole(key) ? ROLES[key].label : '';
    },

    // Renvoie une fonction de désabonnement, par symétrie ; la coque vit
    // aussi longtemps que la page et ne s'en sert pas.
    onChange: function (listener) {
      listeners.push(listener);
      return function () {
        var index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      };
    },

    /* Appelé après une connexion réussie : le cookie est déjà posé par le
       serveur, il ne reste qu'à retenir l'identité renvoyée. */
    setUser: function (next) {
      user = next || null;
      loaded = true;
      expiring = false;
      notify();
      return user;
    },

    // Oublie la session en mémoire. Le cookie, lui, ne peut être effacé que par
    // le serveur (POST /auth/logout) : voir App.api.logout().
    clear: function () {
      user = null;
      loaded = true;
      notify();
    },

    /* Un 401 est arrivé sur une requête ordinaire : la session a expiré ou le
       cookie a été révoqué. Appelé depuis request() dans js/api.js, jamais par
       un écran — c'est la même conclusion quelle que soit la requête fautive. */
    handleExpired: function () {
      if (expiring) return;
      expiring = true;

      var wasAuthenticated = !!user;
      user = null;
      loaded = true;
      notify();

      /* Le garde « modifications non enregistrées » de l'éditeur poserait sa
         question par-dessus une session déjà perdue : enregistrer est de toute
         façon impossible. On le lève avant de rediriger. */
      if (App.state) App.state.hasUnsavedChanges = false;
      if (App.router && App.router.setGuard) App.router.setGuard(null);

      if (wasAuthenticated) {
        App.helpers.toast('Votre session a expiré. Veuillez vous reconnecter.', 'error');
      }
      if (App.router) App.router.navigate(LOGIN_ROUTE);

      // La redirection est faite : le prochain 401 (nouvelle session, nouvelle
      // expiration) doit de nouveau parler.
      global.setTimeout(function () { expiring = false; }, 0);
    }
  };

  App.auth = auth;
})(window);
