/* Le peu que partagent les deux écrans d'authentification : l'en-tête de marque
   posé au-dessus de la carte.

   L'en-tête de l'application est masqué sur ces écrans (voir setChrome dans
   js/shell.js) ; le logo est donc redessiné ici, en plus grand, au-dessus du
   formulaire. C'est le même dessin que dans .brand — s'il change, les deux
   changent ensemble. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});

  App.authUI = {
    brand: function () {
      return '<div class="auth-brand">' +
        '<svg class="auth-mark" viewBox="0 0 32 32" aria-hidden="true">' +
          '<rect width="32" height="32" rx="8" fill="var(--fill-brand)"/>' +
          '<path d="M9 11.5h14M9 16h14M9 20.5h9" stroke="var(--on-brand)" ' +
            'stroke-width="2.2" stroke-linecap="round"/>' +
        '</svg>' +
        '<div class="auth-brand-text">' +
          '<div class="auth-brand-name">Procédures</div>' +
          '<div class="auth-brand-sub">Procédures administratives en ligne</div>' +
        '</div>' +
      '</div>';
    }
  };
})(window);
