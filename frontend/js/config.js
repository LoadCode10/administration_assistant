/* Configuration globale.
   Un seul endroit à changer pour pointer vers un autre backend. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});

  App.config = {
    // URL de base du backend FastAPI (sans barre oblique finale).
    // API_BASE_URL: 'http://127.0.0.1:8000',
    API_BASE_URL: '/api',
    // API_BASE_URL: 'http://0.0.0.0:8000',

    // Passe à true pour faire tourner l'interface sans backend
    // (données factices en mémoire, utile pour ouvrir index.html directement).
    // L'authentification est simulée : voir le bloc « session » de js/mock.js.
    USE_MOCK: false,

    // Intervalle de rafraîchissement de la liste tant qu'une extraction est en cours.
    POLL_INTERVAL_MS: 3000,

    // Taille maximale d'un document source importé.
    MAX_UPLOAD_BYTES: 10 * 1024 * 1024,

    // Au-delà de ce nombre de procédures, l'accordéon est paginé.
    EDITOR_PAGE_SIZE: 20,

    // Bornes du mot de passe, en octets. Le backend hache avec bcrypt, qui
    // ignore tout ce qui dépasse 72 octets : accepter plus long ferait croire
    // à une force qui n'existe pas.
    PASSWORD_MIN_BYTES: 8,
    PASSWORD_MAX_BYTES: 72
  };
})(window);
