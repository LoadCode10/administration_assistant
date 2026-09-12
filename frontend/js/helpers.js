/* Utilitaires partagés : échappement, icônes, dates, toasts, modales, drop-zone. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = {};

  /* --- Texte -------------------------------------------------------------- */

  h.esc = function (value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /* Encadre une valeur de sens inconnu par FSI…PDI (U+2068 / U+2069).
     A utiliser quand du texte arabe est concatene dans une phrase francaise
     sans element HTML autour — typiquement window.confirm(), ou les guillemets
     partiraient a la mauvaise extremite. Ces caracteres ne sont pas affiches.
     Dans le DOM, prefer dir="auto" sur l'element. */
  h.isolate = function (value) {
    return '⁨' + String(value === null || value === undefined ? '' : value) + '⁩';
  };

  // Accord simple : 1 procédure / 2 procédures.
  h.plural = function (count, singular, plural) {
    return count + ' ' + (Math.abs(count) >= 2 ? (plural || singular + 's') : singular);
  };

  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  h.formatDate = function (value) {
    if (!value) return 'Date inconnue';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  };

  /* Date relative courte, pour les listes ou la date exacte n'apporte rien
     (l'historique des discussions). Au-dela d'une semaine on repasse a la date
     ecrite : « il y a 34 jours » ne se lit plus. */
  h.formatRelative = function (value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);

    var seconds = Math.round((Date.now() - date.getTime()) / 1000);
    if (seconds < 0) seconds = 0;
    if (seconds < 60) return 'à l\'instant';

    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return 'il y a ' + h.plural(minutes, 'minute');

    var hours = Math.floor(minutes / 60);
    if (hours < 24) return 'il y a ' + h.plural(hours, 'heure');

    var days = Math.floor(hours / 24);
    if (days === 1) return 'hier';
    if (days < 7) return 'il y a ' + h.plural(days, 'jour');
    return h.formatDate(date);
  };

  /* Coupe sur un mot entier quand c'est possible : un titre de discussion
     derive d'une question, une coupe au milieu d'un mot se remarque. */
  h.truncate = function (value, max) {
    var text = String(value === null || value === undefined ? '' : value).trim();
    if (text.length <= max) return text;
    var cut = text.slice(0, max);
    var space = cut.lastIndexOf(' ');
    if (space > max * 0.6) cut = cut.slice(0, space);
    return cut.replace(/[\s,.;:!?]+$/, '') + '…';
  };

  h.formatBytes = function (bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' o';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' Ko';
    return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' Mo';
  };

  /* --- DOM ---------------------------------------------------------------- */

  h.icon = function (name, extraClass) {
    return '<svg class="icon ' + (extraClass || '') + '" aria-hidden="true">' +
      '<use href="#i-' + name + '"></use></svg>';
  };

  // Construit un fragment DOM à partir d'une chaîne HTML.
  h.fromHTML = function (markup) {
    var tpl = document.createElement('template');
    tpl.innerHTML = markup.trim();
    return tpl.content.firstElementChild;
  };

  h.clear = function (node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  };

  // Délégation d'évènements : on(root, 'click', '[data-action="x"]', handler)
  h.on = function (root, type, selector, handler) {
    root.addEventListener(type, function (event) {
      var target = event.target.closest(selector);
      if (target && root.contains(target)) handler(event, target);
    });
  };

  /* --- Champ mot de passe -------------------------------------------------- */

  /* Le champ reste un input[type=password] : le bouton bascule vers « text » le
     temps de la relecture, puis revient. La valeur ne quitte jamais l'input —
     elle n'est ni copiee ailleurs, ni journalisee.

     options : { id, label, autocomplete, hint }. Renvoie le balisage du groupe
     complet (libelle, champ, bouton, emplacement du message d'erreur) ;
     wirePasswordToggles() cable les boutons apres insertion dans le DOM. */
  h.passwordField = function (options) {
    return '<div class="field-group">' +
      '<label class="field-label" for="' + h.esc(options.id) + '">' +
        h.esc(options.label) + '</label>' +
      '<div class="password-field">' +
        '<input type="password" id="' + h.esc(options.id) + '" ' +
          'name="' + h.esc(options.id) + '" ' +
          'autocomplete="' + h.esc(options.autocomplete || 'current-password') + '">' +
        '<button type="button" class="password-toggle" data-toggle-password="' +
          h.esc(options.id) + '" aria-label="Afficher le mot de passe" ' +
          'aria-pressed="false" title="Afficher le mot de passe">' +
          h.icon('eye', 'icon-sm') +
        '</button>' +
      '</div>' +
      (options.hint ? '<p class="field-hint">' + h.esc(options.hint) + '</p>' : '') +
      '<p class="field-error" data-error-for="' + h.esc(options.id) + '" hidden></p>' +
      '</div>';
  };

  h.wirePasswordToggles = function (root) {
    var buttons = root.querySelectorAll('[data-toggle-password]');
    for (var i = 0; i < buttons.length; i++) {
      (function (button) {
        var input = root.querySelector('#' + button.getAttribute('data-toggle-password'));
        if (!input) return;
        button.addEventListener('click', function () {
          var shown = input.type === 'text';
          input.type = shown ? 'password' : 'text';
          var label = shown ? 'Afficher le mot de passe' : 'Masquer le mot de passe';
          button.setAttribute('aria-pressed', shown ? 'false' : 'true');
          button.setAttribute('aria-label', label);
          button.setAttribute('title', label);
          button.innerHTML = h.icon(shown ? 'eye' : 'eye-off', 'icon-sm');
          // Le curseur revient dans le champ : la bascule sert a relire ce
          // qu'on est en train de taper, pas a quitter la saisie.
          input.focus();
        });
      }(buttons[i]));
    }
  };

  /* Longueur en octets UTF-8. bcrypt compte des octets, pas des caracteres :
     un mot de passe accentue atteint la limite de 72 avant 72 caracteres, et
     tout ce qui depasse serait silencieusement ignore au hachage. */
  h.byteLength = function (value) {
    var text = String(value === null || value === undefined ? '' : value);
    if (global.TextEncoder) return new global.TextEncoder().encode(text).length;
    return encodeURIComponent(text).replace(/%[0-9A-F]{2}/gi, 'x').length;
  };

  /* --- Toasts ------------------------------------------------------------- */

  h.toast = function (message, type) {
    var root = document.getElementById('toast-root');
    var node = h.fromHTML(
      '<div class="toast ' + (type ? 'toast-' + type : '') + '" role="status">' +
      h.icon(type === 'error' ? 'alert' : 'info') +
      '<span>' + h.esc(message) + '</span></div>'
    );
    root.appendChild(node);
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, type === 'error' ? 7000 : 4000);
  };

  /* --- Modales ------------------------------------------------------------ */

  var openModals = [];

  // markup = contenu du <div class="dialog">. Renvoie { root, dialog, close }.
  h.openModal = function (markup, options) {
    options = options || {};
    var previousFocus = document.activeElement;

    var overlay = h.fromHTML(
      '<div class="overlay" role="dialog" aria-modal="true">' +
      '<div class="dialog ' + (options.wide ? 'dialog-wide' : '') + '">' + markup + '</div>' +
      '</div>'
    );

    function close() {
      if (!overlay.parentNode) return;
      document.removeEventListener('keydown', onKeydown);
      overlay.parentNode.removeChild(overlay);
      openModals.splice(openModals.indexOf(handle), 1);
      if (!openModals.length) document.body.style.overflow = '';
      if (previousFocus && previousFocus.focus) previousFocus.focus();
      if (options.onClose) options.onClose();
    }

    function requestClose() {
      if (options.canClose && options.canClose() === false) return;
      close();
    }

    function onKeydown(event) {
      if (event.key === 'Escape' && openModals[openModals.length - 1] === handle) {
        event.stopPropagation();
        requestClose();
      }
    }

    overlay.addEventListener('mousedown', function (event) {
      if (event.target === overlay) requestClose();
    });
    document.addEventListener('keydown', onKeydown);

    document.getElementById('modal-root').appendChild(overlay);
    document.body.style.overflow = 'hidden';

    var handle = {
      root: overlay,
      dialog: overlay.querySelector('.dialog'),
      close: close,
      requestClose: requestClose
    };
    openModals.push(handle);

    var firstField = handle.dialog.querySelector('input, textarea, button');
    if (firstField) firstField.focus();

    return handle;
  };

  /* --- Zone de dépôt de fichier ------------------------------------------ */

  /* Câble une zone cliquable + glisser-déposer.
     options : { accept: ['.pdf','.txt'], maxBytes, onFile(file), onError(msg) } */
  h.wireDropzone = function (zone, options) {
    var input = document.createElement('input');
    input.type = 'file';
    if (options.accept) input.accept = options.accept.join(',');
    input.style.display = 'none';
    zone.appendChild(input);

    function extensionOf(name) {
      var dot = name.lastIndexOf('.');
      return dot === -1 ? '' : name.slice(dot).toLowerCase();
    }

    function accept(file) {
      if (!file) return;
      if (options.accept && options.accept.indexOf(extensionOf(file.name)) === -1) {
        options.onError('Format non accepté. Formats attendus : ' + options.accept.join(', ') + '.');
        return;
      }
      if (options.maxBytes && file.size > options.maxBytes) {
        options.onError('Fichier trop volumineux (' + h.formatBytes(file.size) +
          '). Maximum : ' + h.formatBytes(options.maxBytes) + '.');
        return;
      }
      options.onFile(file);
    }

    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        input.click();
      }
    });
    input.addEventListener('change', function () {
      accept(input.files[0]);
      input.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (type) {
      zone.addEventListener(type, function (event) {
        event.preventDefault();
        zone.classList.add('is-dragging');
      });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      zone.addEventListener(type, function (event) {
        event.preventDefault();
        zone.classList.remove('is-dragging');
      });
    });
    zone.addEventListener('drop', function (event) {
      if (event.dataTransfer && event.dataTransfer.files.length) {
        accept(event.dataTransfer.files[0]);
      }
    });
  };

  /* --- Pagination --------------------------------------------------------- */

  /* Les listes d'administration sont chargées en entier : la pagination est
     donc un simple découpage côté client, partagé par les quatre écrans qui
     en ont besoin (procédures, pièces, administrations, utilisateurs).

     h.paginate(liste, page) prend la liste *déjà filtrée et triée* — la
     recherche s'applique avant le découpage, jamais après — et renvoie :
       page     la page réellement affichée, ramenée dans les bornes ;
       pages    le nombre total de pages ;
       items    la tranche à dessiner ;
       controls le balisage des boutons, vide s'il n'y a qu'une page.

     L'appelant garde sa page courante dans son propre état et la réécrit
     depuis « page » : c'est ce qui fait reculer d'une page toute seule quand
     une suppression vide la dernière. Il lui revient aussi de revenir à 1
     quand la recherche change. Les boutons portent data-action="page-prev" /
     "page-next", à câbler dans la délégation de clic déjà en place. */

  h.PAGE_SIZE = 10;

  /* Même barre que celle de l'éditeur — .pager, deux boutons encadrant le rang
     de la page : les écrans paginés ne doivent pas se paginer chacun à sa
     façon. */
  function pagerControls(page, pages) {
    return '<nav class="pager" aria-label="Pagination">' +
      '<button type="button" data-action="page-prev"' +
        (page <= 1 ? ' disabled' : '') + '>Précédent</button>' +
      '<span class="pager-status">Page ' + page + ' sur ' + pages + '</span>' +
      '<button type="button" data-action="page-next"' +
        (page >= pages ? ' disabled' : '') + '>Suivant</button>' +
      '</nav>';
  }

  h.paginate = function (list, page, size) {
    var perPage = size || h.PAGE_SIZE;
    var pages = Math.max(1, Math.ceil(list.length / perPage));
    var current = Math.min(Math.max(parseInt(page, 10) || 1, 1), pages);
    var start = (current - 1) * perPage;
    return {
      page: current,
      pages: pages,
      items: list.slice(start, start + perPage),
      controls: pages > 1 ? pagerControls(current, pages) : ''
    };
  };

  /* --- Divers ------------------------------------------------------------- */

  h.readFileAsText = function (file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('Lecture du fichier impossible.')); };
      reader.readAsText(file);
    });
  };

  // Normalise une valeur qui peut être null / chaîne / tableau en tableau de chaînes.
  h.toStringArray = function (value) {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) {
      return value.filter(function (item) { return item !== null && item !== undefined; })
        .map(function (item) { return String(item); });
    }
    return [String(value)];
  };

  App.helpers = h;
})(window);
