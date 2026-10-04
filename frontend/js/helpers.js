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

  /* --- Textes bilingues ---------------------------------------------------

     Depuis le passage du backend aux colonnes bilingues, chaque texte arrive
     en deux exemplaires : « titre_proc_fr » et « titre_proc_ar », ou bien une
     paire { fr, ar } dans le contenu d'une extraction. L'interface n'en
     affiche qu'un — celui de la langue courante — et c'est h.pick qui tranche,
     partout, plutot que chaque ecran a sa facon. */

  /* La langue de l'interface se lit sur <html lang>. Elle vaut « fr » par
     defaut : c'est la langue de la console, et une valeur inconnue ne doit pas
     faire basculer l'affichage en arabe. */
  h.lang = function () {
    var declared = String(
      (global.document && document.documentElement &&
        document.documentElement.getAttribute('lang')) || ''
    ).toLowerCase();
    return declared.indexOf('ar') === 0 ? 'ar' : 'fr';
  };

  /* Renvoie le texte de la langue courante, en chaine prete a afficher.

       h.pick(procedure, 'titre_proc')  -> titre_proc_fr  ou titre_proc_ar
       h.pick(paire)                    -> paire.fr       ou paire.ar

     Le repli sur l'autre langue n'est pas un detail : l'extraction laisse
     souvent une des deux moitiees vide, et un titre en arabe dans une console
     francaise reste infiniment plus utile qu'une ligne vide. Une chaine recue
     telle quelle est rendue telle quelle — le mode demonstration et les
     anciennes reponses passent donc sans cas particulier.

     « lang » force une langue autre que celle de l'interface : les sources
     d'une reponse de l'assistant suivent la langue de la question. Une valeur
     absente ou inconnue retombe sur h.lang(). */
  h.pick = function (value, base, lang) {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'object') return String(value);

    var prefix = base ? base + '_' : '';
    if (lang !== 'fr' && lang !== 'ar') lang = h.lang();
    var mine = value[prefix + lang];
    var other = value[prefix + (lang === 'ar' ? 'fr' : 'ar')];
    var chosen = (mine === null || mine === undefined || mine === '') ? other : mine;
    return chosen === null || chosen === undefined ? '' : String(chosen);
  };

  /* --- Contenus dans leur propre langue ------------------------------------

     Le chrome de l'interface reste dans la langue de l'interface. Deux
     contenus portent la leur : une reponse de l'assistant (et ses sources),
     dans la langue de la question, et une procedure suivie, dans la langue
     ou elle a ete suivie. Pour eux : la langue (h.contentLang), le sens
     (h.langDir) et les libelles fixes (h.labelsFor), tous ici pour que
     l'assistant et « Mes procedures » disent les memes choses. */

  // « fr » ou « ar » ; toute autre valeur (absente, ancienne donnee)
  // retombe sur la langue de l'interface.
  h.contentLang = function (lang) {
    return (lang === 'fr' || lang === 'ar') ? lang : h.lang();
  };

  h.langDir = function (lang) {
    return h.contentLang(lang) === 'ar' ? 'rtl' : 'ltr';
  };

  var CONTENT_LABELS = {
    fr: {
      // Communs
      untitled: 'Procédure sans titre',
      noAdministration: 'Administration non renseignée',

      // Sources sous une réponse de l'assistant
      sourcesCount: function (n) { return h.plural(n, 'source utilisée', 'sources utilisées'); },
      track: 'Suivre cette procédure',
      tracked: 'Déjà suivie',
      adding: 'Ajout…',
      trackedToast: 'Procédure suivie — retrouvez-la dans « Mes procédures ».',

      // Carte d'une procédure suivie
      done: 'Terminé',
      untrack: 'Ne plus suivre cette procédure',
      progress: function (done, total, percent) {
        return done + ' / ' + total + ' ' + (total >= 2 ? 'pièces réunies' : 'pièce réunie') +
          ' · ' + percent + ' %';
      },
      piecesTitle: 'Pièces requises',
      noPieces: 'Aucune pièce à réunir pour cette procédure.',
      stepsTitle: 'Étapes',
      noSteps: 'Aucune étape listée pour cette procédure.',
      notePlaceholder: 'Note (facultatif)',
      noteAria: function (label) { return 'Note pour ' + label; },
      pieceFailed: 'Pièce non enregistrée : ',
      noteFailed: 'Note non enregistrée : ',

      // Bureaux à proximité, dans la carte
      nearbyFind: 'Trouver le bureau le plus proche',
      nearbyLocating: 'Recherche de votre position…',
      nearbySearching: 'Recherche des bureaux à proximité… cela peut prendre quelques secondes',
      nearbyNoGeolocation: 'Ce navigateur ne sait pas donner votre position.',
      nearbyDenied: 'Accès à votre position refusé.',
      nearbyTimeout: 'Votre position met trop de temps à être déterminée.',
      nearbyUnavailable: 'Votre position n\'a pas pu être déterminée.',
      nearbyFallback: 'Votre position sert à classer les bureaux du plus proche au ' +
        'plus loin. Choisissez plutôt une ville :',
      nearbyCity: 'Ville de recherche',
      nearbySearch: 'Chercher',
      close: 'Fermer',
      closeResults: 'Fermer les résultats',
      results: 'Résultats',
      resultsFor: function (city) { return 'Résultats pour ' + city; },
      nearbySources: function (n) { return h.plural(n, 'Source', 'Sources'); },
      official: 'Officielle',
      unofficial: 'Non officielle',
      unverifiedTitle: 'Informations non vérifiées',
      unverifiedText: 'Ces informations proviennent de sources non officielles et ' +
        'n\'ont pas été vérifiées. Confirmez-les auprès de l\'administration ' +
        'avant de vous déplacer.'
    },
    ar: {
      untitled: 'مسطرة بدون عنوان',
      noAdministration: 'الإدارة غير محددة',

      sourcesCount: function (n) {
        return (n === 1 ? 'المصدر المستعمل' : 'المصادر المستعملة') + ' (' + n + ')';
      },
      track: 'تتبع هذه المسطرة',
      tracked: 'قيد التتبع',
      adding: 'جارٍ الإضافة…',
      trackedToast: 'تمت إضافة المسطرة إلى التتبع — تجدونها في « Mes procédures ».',

      done: 'مكتملة',
      untrack: 'إلغاء تتبع هذه المسطرة',
      // Les chiffres sont isolés : « 3 / 5 » dans une phrase arabe
      // s'afficherait sinon « 5 / 3 ».
      progress: function (done, total, percent) {
        return 'الوثائق المجمعة: ' + h.isolate(done + ' / ' + total) +
          ' · ' + h.isolate(percent + ' %');
      },
      piecesTitle: 'الوثائق المطلوبة',
      noPieces: 'لا توجد وثائق مطلوبة لهذه المسطرة.',
      stepsTitle: 'المراحل',
      noSteps: 'لا توجد مراحل مذكورة لهذه المسطرة.',
      notePlaceholder: 'ملاحظة (اختياري)',
      noteAria: function (label) { return 'ملاحظة حول ' + label; },
      pieceFailed: 'لم يتم حفظ الوثيقة: ',
      noteFailed: 'لم يتم حفظ الملاحظة: ',

      nearbyFind: 'البحث عن أقرب مكتب',
      nearbyLocating: 'جارٍ تحديد موقعك…',
      nearbySearching: 'جارٍ البحث عن المكاتب القريبة… قد يستغرق ذلك بضع ثوانٍ',
      nearbyNoGeolocation: 'هذا المتصفح لا يستطيع تحديد موقعك.',
      nearbyDenied: 'تم رفض الوصول إلى موقعك.',
      nearbyTimeout: 'تحديد موقعك يستغرق وقتا طويلا.',
      nearbyUnavailable: 'تعذر تحديد موقعك.',
      nearbyFallback: 'يُستعمل موقعك لترتيب المكاتب من الأقرب إلى الأبعد. ' +
        'اختر مدينة بدلا من ذلك:',
      nearbyCity: 'مدينة البحث',
      nearbySearch: 'بحث',
      close: 'إغلاق',
      closeResults: 'إغلاق النتائج',
      results: 'النتائج',
      resultsFor: function (city) { return 'النتائج في ' + city; },
      nearbySources: function (n) { return (n === 1 ? 'المصدر' : 'المصادر') + ' (' + n + ')'; },
      official: 'رسمي',
      unofficial: 'غير رسمي',
      unverifiedTitle: 'معلومات غير مؤكدة',
      unverifiedText: 'هذه المعلومات مصدرها مواقع غير رسمية ولم يتم التحقق منها. ' +
        'تأكد منها لدى الإدارة قبل التنقل.'
    }
  };

  // Les libellés fixes d'un contenu, dans sa langue.
  h.labelsFor = function (lang) {
    return CONTENT_LABELS[h.contentLang(lang)];
  };

  var ARABIC = /[؀-ۿݐ-ݿ]/;

  /* Valeur de l'attribut dir pour un texte dont on ne connait pas la langue.
     « auto » suffit dans la plupart des cas — le navigateur tranche sur le
     premier caractere fort — mais un champ de saisie vide n'a pas de premier
     caractere : la ou la langue est connue d'avance (le champ « arabe » d'un
     formulaire bilingue), on ecrit dir="rtl" en dur. */
  h.dirOf = function (value) {
    return ARABIC.test(String(value === null || value === undefined ? '' : value))
      ? 'rtl' : 'auto';
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

  /* --- Markdown ------------------------------------------------------------

     Les textes produits par le modèle arrivent en Markdown : gras, titres,
     listes, filets. Sans conversion l'utilisateur lit la syntaxe au lieu de la
     mise en forme, et ces textes sont longs et structurés (adresses, horaires,
     pièces).

     Deux garde-fous, et ils ne sont pas facultatifs : seuls les textes venant
     du modèle passent par ici — jamais une saisie d'utilisateur, qui reste
     échappée — et le HTML produit est lavé par DOMPurify avant d'entrer dans
     la page. Si l'une des deux bibliothèques manque (CDN injoignable), la
     fonction renvoie null : l'appelant retombe alors sur le texte échappé,
     moins lisible mais toujours affiché, et jamais interprété.

     options.breaks : un retour à la ligne simple est voulu (réponse de chat,
     liste d'agences) là où le Markdown standard le mangerait. */
  h.markdownToHtml = function (text, options) {
    var parse = null;
    if (typeof global.marked !== 'undefined' && global.marked) {
      if (typeof global.marked.parse === 'function') parse = global.marked.parse;
      else if (typeof global.marked === 'function') parse = global.marked;
    }
    if (!parse) return null;
    if (typeof global.DOMPurify === 'undefined' || !global.DOMPurify ||
        typeof global.DOMPurify.sanitize !== 'function') return null;

    try {
      var html = parse(String(text), {
        breaks: !options || options.breaks !== false,
        gfm: true
      });
      return global.DOMPurify.sanitize(html);
    } catch (error) {
      return null;
    }
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
