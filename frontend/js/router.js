/* Routeur minimal basé sur le hash.

   Chaque route déclare le ou les rôles qui peuvent l'atteindre (add() prend un
   troisième argument { roles: ['admin'] }). Une route sans rôle est ouverte à
   tous les rôles. Viser une route interdite — ou inconnue — renvoie sur la
   route d'accueil du rôle courant plutôt que de monter un écran à moitié cassé.

   Deux routes sont marquées { guest: true } : la connexion et l'inscription.
   Elles sont les seules atteignables sans session, les seules interdites AVEC
   une session, et les seules rendues sans la coque (ni en-tête ni barre
   latérale) — voir App.shell.setChrome().

   Un écran peut poser un garde (setGuard) pour bloquer la navigation quand
   des modifications ne sont pas enregistrées. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});

  var routes = [];
  var currentScreen = null;   // { destroy? }
  var guard = null;           // function -> true si on peut quitter
  var lastHash = null;
  var suppressNextHashChange = false;

  function parse(hash) {
    var clean = (hash || '').replace(/^#\/?/, '');
    return clean.split('/').filter(function (part) { return part.length > 0; });
  }

  function sameHash(a, b) {
    return ('#' + String(a).replace(/^#/, '')) === ('#' + String(b).replace(/^#/, ''));
  }

  /* Le rôle vient de la session. Tant qu'elle n'est pas chargée — ou le jour où
     l'on n'aurait plus de rôles du tout — la restriction par rôle ne s'applique
     pas : le routeur ne doit pas devenir le point de panne de la page. La
     restriction par session, elle, s'applique toujours. */
  function currentRole() {
    return (App.auth && App.auth.getRole()) || null;
  }

  function isAuthenticated() {
    return !!(App.auth && App.auth.isAuthenticated());
  }

  function loginRoute() {
    return (App.auth && App.auth.LOGIN_ROUTE) || '#/login';
  }

  /* Où renvoyer une route inconnue ou interdite : l'accueil du rôle connecté,
     l'écran de connexion sinon. */
  function homeRoute() {
    return (App.auth && App.auth.defaultRoute()) || '#/dashboard';
  }

  function allows(route) {
    if (!route.roles) return true;
    var role = currentRole();
    if (!role) return true;
    return route.roles.indexOf(role) !== -1;
  }

  var router = {
    /* options : { roles: ['admin'] } — omis, la route est ouverte à tous les
       rôles (mais jamais à un visiteur sans session).
       options : { guest: true } — connexion / inscription : réservée aux
       visiteurs sans session, et rendue sans la coque. */
    add: function (pattern, handler, options) {
      var roles = options && options.roles ? options.roles.slice() : null;
      routes.push({
        parts: parse(pattern),
        handler: handler,
        roles: roles,
        guest: !!(options && options.guest)
      });
    },

    // Le garde est réinstallé par chaque écran et effacé au changement d'écran.
    setGuard: function (fn) { guard = fn; },

    /* Interroge le garde sans naviguer. Sert aux sorties qui ne passent pas par
       un clic dans le menu — la déconnexion, par exemple. */
    canLeave: function () {
      return !guard || guard() !== false;
    },

    navigate: function (hash) {
      if (('#' + hash.replace(/^#/, '')) === global.location.hash) {
        router.resolve();
        return;
      }
      global.location.hash = hash;
    },

    resolve: function () {
      var home = homeRoute();
      var hash = global.location.hash || home;
      var parts = parse(hash);

      if (currentScreen && currentScreen.destroy) currentScreen.destroy();
      currentScreen = null;
      guard = null;

      var root = document.getElementById('screen-root');
      App.helpers.clear(root);

      var found = null;
      var params = {};

      for (var i = 0; i < routes.length && !found; i++) {
        var route = routes[i];
        if (route.parts.length !== parts.length) continue;
        var candidate = {};
        var matched = true;
        for (var j = 0; j < route.parts.length; j++) {
          var segment = route.parts[j];
          if (segment.charAt(0) === ':') {
            candidate[segment.slice(1)] = decodeURIComponent(parts[j]);
          } else if (segment !== parts[j]) {
            matched = false;
            break;
          }
        }
        if (matched) {
          found = route;
          params = candidate;
        }
      }

      /* Trois refus, dans cet ordre : pas de session, session mais mauvaise
         porte, route inconnue ou réservée à l'autre rôle. Rien n'est monté
         entre-temps — mieux vaut un écran de plus qu'un écran à moitié
         construit. */

      // Sans session, seules la connexion et l'inscription se montent.
      if (!isAuthenticated() && !(found && found.guest)) {
        if (sameHash(loginRoute(), hash)) {
          console.error('[router] Route de connexion introuvable : ' + loginRoute());
          return;
        }
        global.location.hash = loginRoute();
        return;
      }

      // Déjà connecté : se reconnecter n'a pas de sens, on renvoie à l'accueil.
      if (isAuthenticated() && found && found.guest) {
        global.location.hash = home;
        return;
      }

      // Route inconnue, ou reservee a l'autre role : on renvoie sur l'accueil
      // du role courant.
      if (!found || !allows(found)) {
        if (sameHash(home, hash)) {
          // L'accueil lui-meme est introuvable : la configuration des routes
          // est en cause, on ne boucle pas dessus.
          console.error('[router] Route d\'accueil introuvable : ' + home);
          return;
        }
        global.location.hash = home;
        return;
      }

      /* La coque n'entoure pas les écrans de connexion. On la masque avant le
         montage : laisser apparaître une barre latérale vide, même le temps
         d'une image, se voit. */
      if (App.shell) App.shell.setChrome(!found.guest);

      lastHash = hash;
      currentScreen = found.handler(root, params) || null;
      // La coque met en avant l'entree de menu correspondante.
      if (App.shell && !found.guest) App.shell.setActive(hash);
      global.scrollTo(0, 0);
    },

    start: function () {
      global.addEventListener('hashchange', function () {
        if (suppressNextHashChange) {
          suppressNextHashChange = false;
          return;
        }
        if (guard && guard() === false) {
          // On restaure l'ancien hash sans relancer la résolution.
          suppressNextHashChange = true;
          global.location.hash = lastHash;
          return;
        }
        router.resolve();
      });

      global.addEventListener('beforeunload', function (event) {
        if (App.state && App.state.hasUnsavedChanges) {
          event.preventDefault();
          event.returnValue = '';
          return '';
        }
      });

      if (!global.location.hash) global.location.hash = homeRoute();
      else router.resolve();
    }
  };

  // Petit état global partagé (uniquement pour l'avertissement de sortie).
  App.state = { hasUnsavedChanges: false };
  App.router = router;
})(window);
