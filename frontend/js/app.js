/* Point d'entrée : déclaration des routes et démarrage.

   Une seule application, deux tableaux de bord. Chaque route dit quel rôle
   peut l'atteindre ; le routeur renvoie sur l'accueil du rôle courant quand la
   route visée ne lui appartient pas, et sur #/login quand il n'y a pas de
   session. La liste ci-dessous est donc la référence de « qui voit quoi ».

   Le démarrage est en deux temps. On ne peut rien résoudre avant de savoir qui
   est là : GET /citizen/me est la seule source de vérité sur la session, et
   elle est distante. Les routes sont donc déclarées tout de suite, mais le
   routeur n'est lancé qu'une fois la réponse arrivée. Entre les deux, la page
   n'affiche qu'un état d'attente — monter l'écran de connexion « en attendant »
   le ferait clignoter chez toutes les personnes déjà connectées. */
(function (global) {
  'use strict';

  var App = global.App;

  var ADMIN = { roles: ['admin'] };
  var CITIZEN = { roles: ['citizen'] };
  // Réservé aux visiteurs sans session, et rendu sans la coque.
  var GUEST = { guest: true };

  if (App.config.USE_MOCK) {
    App.mock.init();
    console.info('[admin] Mode démonstration : données factices en mémoire (App.config.USE_MOCK).');
  }

  /* --- Authentification ---------------------------------------------------- */

  App.router.add('/login', function (root) {
    return App.screens.login.mount(root);
  }, GUEST);

  App.router.add('/register', function (root) {
    return App.screens.register.mount(root);
  }, GUEST);

  /* --- Console d'administration ------------------------------------------ */

  App.router.add('/dashboard', function (root) {
    return App.screens.dashboard.mount(root);
  }, ADMIN);

  App.router.add('/documents', function (root) {
    return App.screens.documents.mount(root);
  }, ADMIN);

  App.router.add('/procedures', function (root) {
    return App.screens.procedures.mount(root, {});
  }, ADMIN);

  // Vue « Pieces requises » : meme ecran, autre agregation. Une vue inconnue
  // retombe sur la liste des procedures.
  App.router.add('/procedures/:vue', function (root, params) {
    return App.screens.procedures.mount(root, params);
  }, ADMIN);

  App.router.add('/administrations', function (root) {
    return App.screens.administrations.mount(root);
  }, ADMIN);

  App.router.add('/users', function (root) {
    return App.screens.users.mount(root);
  }, ADMIN);

  // Fiche d'un compte, en lecture seule. Meme restriction que la liste.
  App.router.add('/users/:id', function (root, params) {
    return App.screens.userDetail.mount(root, params);
  }, ADMIN);

  // Journal d'activite : lecture seule, et strictement reserve aux
  // administrateurs — c'est la trace de ce que tout le monde a fait.
  App.router.add('/logs', function (root) {
    return App.screens.logs.mount(root);
  }, ADMIN);

  App.router.add('/extractions/:id', function (root, params) {
    return App.screens.editor.mount(root, params);
  }, ADMIN);

  /* --- Espace citoyen ----------------------------------------------------- */

  App.router.add('/chat', function (root) {
    return App.screens.chat.mount(root);
  }, CITIZEN);

  App.router.add('/suivi', function (root) {
    return App.screens.suivi.mount(root);
  }, CITIZEN);

  /* --- Démarrage ----------------------------------------------------------- */

  /* load() ne rejette pas : un 401, comme une panne réseau, se traduit par
     « pas de session » et donc par l'écran de connexion. Il n'y a rien de
     mieux à faire — sans /citizen/me, on ne peut rien affirmer sur la session,
     et deviner ferait apparaître une console d'administration à qui n'y a pas
     droit. */
  App.auth.load().then(function () {
    // La coque (en-tete + barre laterale) vit en dehors de #screen-root : elle
    // est construite une seule fois, apres que la session est connue — c'est
    // elle qui dit quel menu dessiner et quel nom afficher.
    App.shell.init();
    document.body.classList.remove('is-booting');
    App.router.start();
  });
})(window);
