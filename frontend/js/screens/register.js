/* Écran d'inscription (#/register).

   Ne crée que des citoyens : il n'y a pas de choix de rôle, et le backend n'en
   accepte pas — un compte administrateur se crée hors de l'application.

   La saisie est vérifiée ici avant l'envoi, non pour se substituer au serveur
   mais pour éviter un aller-retour sur ce qui se voit tout de suite : un champ
   vide, un courriel mal formé, deux mots de passe différents. Les messages se
   posent sous le champ fautif — un bandeau unique laisserait chercher lequel
   des sept est en cause. Ce que le serveur seul sait — un identifiant déjà
   pris — revient en 409 et se pose au même endroit. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  // Volontairement large : refuser un courriel valide est plus grave que
  // laisser passer une faute de frappe, que le serveur verra de toute façon.
  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  var FIELDS = ['prenom', 'nom', 'username', 'email', 'phone', 'password', 'confirm'];

  function textField(options) {
    var type = options.type || 'text';
    return '<div class="field-group">' +
      '<label class="field-label" for="' + esc(options.id) + '">' +
        esc(options.label) +
        (options.optional ? ' <span class="field-optional">(facultatif)</span>' : '') +
      '</label>' +
      '<input type="' + esc(type) + '" id="' + esc(options.id) + '" ' +
        'name="' + esc(options.id) + '" dir="auto" ' +
        'autocomplete="' + esc(options.autocomplete || 'off') + '"' +
        // Ni majuscule automatique ni correcteur sur un identifiant ou une
        // adresse : le téléphone corrigerait « ahmed » en « Ahmed ».
        (type === 'text' && options.autocomplete !== 'username'
          ? '' : ' autocapitalize="none" spellcheck="false"') + '>' +
      '<p class="field-error" data-error-for="' + esc(options.id) + '" hidden></p>' +
      '</div>';
  }

  function mount(root) {
    var view = document.createElement('div');
    view.className = 'auth-page';
    root.appendChild(view);

    var minBytes = App.config.PASSWORD_MIN_BYTES;
    var maxBytes = App.config.PASSWORD_MAX_BYTES;

    view.innerHTML =
      App.authUI.brand() +
      '<div class="card auth-card auth-card-wide">' +
        '<h1 class="auth-title">Créer un compte</h1>' +
        '<p class="auth-sub">Suivez vos démarches et interrogez l\'assistant.</p>' +
        '<div id="register-error"></div>' +
        '<form id="register-form" novalidate>' +
          '<div class="auth-row">' +
            textField({ id: 'register-prenom', label: 'Prénom', autocomplete: 'given-name' }) +
            textField({ id: 'register-nom', label: 'Nom', autocomplete: 'family-name' }) +
          '</div>' +
          textField({
            id: 'register-username', label: 'Nom d\'utilisateur',
            autocomplete: 'username'
          }) +
          textField({
            id: 'register-email', label: 'Adresse électronique',
            type: 'email', autocomplete: 'email'
          }) +
          textField({
            id: 'register-phone', label: 'Téléphone',
            type: 'tel', autocomplete: 'tel', optional: true
          }) +
          h.passwordField({
            id: 'register-password',
            label: 'Mot de passe',
            autocomplete: 'new-password',
            hint: 'Entre ' + minBytes + ' et ' + maxBytes + ' caractères.'
          }) +
          h.passwordField({
            id: 'register-confirm',
            label: 'Confirmation du mot de passe',
            autocomplete: 'new-password'
          }) +
          '<button type="submit" class="btn-primary auth-submit" ' +
            'id="register-submit">Créer mon compte</button>' +
        '</form>' +
        '<p class="auth-alt">Vous avez déjà un compte ? ' +
          '<a href="#/login">Se connecter</a></p>' +
      '</div>';

    h.wirePasswordToggles(view);

    var form = view.querySelector('#register-form');
    var errorBox = view.querySelector('#register-error');
    var submitButton = view.querySelector('#register-submit');
    var busy = false;

    function field(name) { return view.querySelector('#register-' + name); }

    field('prenom').focus();

    /* Un message sous un champ, et le champ marqué. Une chaîne vide efface les
       deux. */
    function setFieldError(name, message) {
      var input = field(name);
      var slot = view.querySelector('[data-error-for="register-' + name + '"]');
      if (!input || !slot) return;
      input.classList.toggle('is-invalid', !!message);
      slot.textContent = message || '';
      slot.hidden = !message;
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }

    function clearErrors() {
      FIELDS.forEach(function (name) { setFieldError(name, ''); });
      errorBox.innerHTML = '';
    }

    /* Message global : réservé aux échecs qui n'appartiennent à aucun champ —
       serveur injoignable, erreur 500. */
    function showGlobalError(message) {
      errorBox.innerHTML = message
        ? '<div class="inline-error">' + icon('alert') +
          '<span>' + esc(message) + '</span></div>'
        : '';
    }

    function setBusy(value) {
      busy = value;
      submitButton.disabled = value;
      submitButton.textContent = value ? 'Création…' : 'Créer mon compte';
    }

    /* Renvoie [{ name, message }] dans l'ordre des champs : le premier de la
       liste est celui qui reçoit le focus. */
    function validate(values) {
      var problems = [];

      function required(name, message) {
        if (!values[name]) problems.push({ name: name, message: message });
      }

      required('prenom', 'Indiquez votre prénom.');
      required('nom', 'Indiquez votre nom.');
      required('username', 'Choisissez un nom d\'utilisateur.');

      if (!values.email) {
        problems.push({ name: 'email', message: 'Indiquez votre adresse électronique.' });
      } else if (!EMAIL_PATTERN.test(values.email)) {
        problems.push({
          name: 'email',
          message: 'Cette adresse ne ressemble pas à une adresse électronique.'
        });
      }

      var length = h.byteLength(values.password);
      if (!values.password) {
        problems.push({ name: 'password', message: 'Choisissez un mot de passe.' });
      } else if (length < minBytes) {
        problems.push({
          name: 'password',
          message: 'Le mot de passe doit faire au moins ' + minBytes + ' caractères.'
        });
      } else if (length > maxBytes) {
        // Au-delà, bcrypt ignore la fin : le mot de passe enregistré ne serait
        // pas celui qu'on croit avoir choisi.
        problems.push({
          name: 'password',
          message: 'Le mot de passe ne doit pas dépasser ' + maxBytes + ' caractères.'
        });
      }

      if (!values.confirm) {
        problems.push({
          name: 'confirm',
          message: 'Saisissez le mot de passe une seconde fois.'
        });
      } else if (values.confirm !== values.password) {
        problems.push({
          name: 'confirm',
          message: 'Les deux mots de passe ne correspondent pas.'
        });
      }

      return problems;
    }

    /* Un 409 dit « déjà pris » sans toujours dire de quoi. Le message du
       serveur tranche quand il le peut ; à défaut on le pose sur les deux
       champs possibles plutôt que de désigner le mauvais. */
    function showConflict(message) {
      var mentionsEmail = /courriel|e-?mail|adresse/i.test(message);
      var mentionsUser = /utilisateur|username|identifiant|user\s*name/i.test(message);

      if (mentionsEmail && !mentionsUser) {
        setFieldError('email', message);
        field('email').focus();
        return;
      }
      setFieldError('username', message);
      if (!mentionsUser) setFieldError('email', message);
      field('username').focus();
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (busy) return;

      var values = {
        prenom: field('prenom').value.trim(),
        nom: field('nom').value.trim(),
        username: field('username').value.trim(),
        email: field('email').value.trim(),
        phone: field('phone').value.trim(),
        // Les mots de passe ne sont pas rognés : une espace en bout est un
        // caractère comme un autre pour bcrypt.
        password: field('password').value,
        confirm: field('confirm').value
      };

      clearErrors();

      var problems = validate(values);
      if (problems.length) {
        problems.forEach(function (problem) {
          setFieldError(problem.name, problem.message);
        });
        field(problems[0].name).focus();
        return;
      }

      setBusy(true);

      App.api.register({
        prenom_user: values.prenom,
        nom_user: values.nom,
        userName: values.username,
        email_user: values.email,
        phone_user: values.phone,
        password: values.password
      }).then(function () {
        /* Le compte existe, mais aucune session n'est ouverte : le serveur ne
           pose le cookie qu'à la connexion. On renvoie donc vers #/login. */
        h.toast('Votre compte a été créé. Vous pouvez maintenant vous connecter.', 'success');
        App.router.navigate('#/login');
      }, function (error) {
        setBusy(false);
        if (error.status === 409) showConflict(error.message);
        else showGlobalError(error.message);
      });
    });

    return {
      destroy: function () {
        // Les mots de passe saisis partent avec le DOM : rien n'en a été copié.
      }
    };
  }

  App.screens = App.screens || {};
  App.screens.register = { mount: mount };
})(window);
