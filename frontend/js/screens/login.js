/* Écran de connexion (#/login).

   Rendu sans la coque : le routeur appelle App.shell.setChrome(false) avant de
   monter cet écran, la page se réduit donc à la carte centrée et au logo.

   Le mot de passe ne vit que dans son champ, le temps de la requête. Il n'est
   ni conservé, ni journalisé, ni envoyé ailleurs que dans le corps de
   POST /auth/login. La réponse ne contient pas de jeton : le serveur le pose
   dans un cookie HttpOnly que le frontend ne voit jamais. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  function mount(root) {
    var view = document.createElement('div');
    view.className = 'auth-page';
    root.appendChild(view);

    view.innerHTML =
      App.authUI.brand() +
      '<div class="card auth-card">' +
        '<h1 class="auth-title">Connexion</h1>' +
        '<p class="auth-sub">Identifiez-vous pour accéder à votre espace.</p>' +
        '<div id="login-error"></div>' +
        '<form id="login-form" novalidate>' +
          '<div class="field-group">' +
            '<label class="field-label" for="login-username">Nom d\'utilisateur</label>' +
            // Le backend authentifie par « userName », pas par courriel :
            // le champ, son type et son autocomplete disent la même chose.
            '<input type="text" id="login-username" name="userName" ' +
              'autocomplete="username" autocapitalize="none" spellcheck="false">' +
          '</div>' +
          h.passwordField({
            id: 'login-password',
            label: 'Mot de passe',
            autocomplete: 'current-password'
          }) +
          '<button type="submit" class="btn-primary auth-submit" ' +
            'id="login-submit">Se connecter</button>' +
        '</form>' +
        '<p class="auth-alt">Pas encore de compte ? ' +
          '<a href="#/register">Créer un compte</a></p>' +
      '</div>';

    h.wirePasswordToggles(view);

    var form = view.querySelector('#login-form');
    var errorBox = view.querySelector('#login-error');
    var usernameInput = view.querySelector('#login-username');
    var passwordInput = view.querySelector('#login-password');
    var submitButton = view.querySelector('#login-submit');
    var busy = false;

    usernameInput.focus();

    function showError(message) {
      errorBox.innerHTML = message
        ? '<div class="inline-error">' + icon('alert') +
          '<span>' + esc(message) + '</span></div>'
        : '';
    }

    function setBusy(value) {
      busy = value;
      submitButton.disabled = value;
      submitButton.textContent = value ? 'Connexion…' : 'Se connecter';
      usernameInput.disabled = value;
      passwordInput.disabled = value;
    }

    /* Un échec laisse le nom d'utilisateur en place — le plus souvent c'est le
       mot de passe qui a été mal tapé, et le retaper entier est une punition
       inutile — mais vide le mot de passe : le champ est masqué, on ne corrige
       pas à l'aveugle une chaîne qu'on ne relit pas. */
    function fail(message) {
      setBusy(false);
      showError(message);
      passwordInput.value = '';
      passwordInput.focus();
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (busy) return;

      var userName = usernameInput.value.trim();
      var password = passwordInput.value;

      // Vérification minimale : inutile d'aller demander au serveur si un
      // champ est vide. Le reste — identifiants justes ou non — n'appartient
      // qu'à lui.
      if (!userName || !password) {
        showError('Renseignez votre nom d\'utilisateur et votre mot de passe.');
        (userName ? passwordInput : usernameInput).focus();
        return;
      }

      setBusy(true);
      showError('');

      App.api.login({ userName: userName, password: password }).then(function (user) {
        // Le cookie est posé, la session commence : on retient l'identité et on
        // part sur l'accueil du rôle renvoyé par le serveur — jamais sur une
        // route choisie ici.
        App.auth.setUser(user);
        App.router.navigate(App.auth.defaultRoute());
      }, function (error) {
        fail(error.message);
      });
    });

    return {
      destroy: function () {
        // Rien à défaire : pas de sondage, pas d'écouteur hors de cette vue.
        // Le champ mot de passe part avec le DOM.
      }
    };
  }

  App.screens = App.screens || {};
  App.screens.login = { mount: mount };
})(window);
