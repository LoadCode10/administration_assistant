/* Écran 3 — Modale « Importer un JSON ».
   Le fichier est validé côté client AVANT tout envoi au serveur. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  var MAX_LISTED_PROBLEMS = 8;
  var PREVIEW_TITLES = 4;

  /* Le format attendu depuis le passage au bilingue : chaque texte est une
     paire { "fr": …, "ar": … }, et les deux cotes doivent etre remplis. Le
     backend refuse l'ancien format plat par un 422 — on le dit ici, avant
     l'envoi, parce que c'est le fichier qu'il faut regenerer et non la saisie
     qu'il faut corriger.

     « proc_law » fait exception : une liste de chaines, les textes de loi
     etant cites dans leur langue d'origine. */
  var PAIR_FIELDS = ['proc_title', 'proc_description', 'fee', 'proc_delai'];
  var PAIR_LISTS = ['proc_administration', 'proc_pieces', 'proc_steps'];

  function isPair(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
      typeof value.fr === 'string' && typeof value.ar === 'string';
  }

  /* Renvoie le probleme de cette valeur, ou null si elle convient.
     « optional » : la valeur peut etre absente ou null (description, frais,
     delai) ; elle ne peut pas etre a moitie remplie pour autant. */
  function pairProblem(value, name, optional) {
    if (value === undefined || value === null) {
      return optional ? null : name + ' manquant.';
    }
    if (typeof value === 'string') {
      return name + ' est au format plat (une chaîne) : le format bilingue ' +
        '{ "fr": …, "ar": … } est désormais attendu.';
    }
    if (!isPair(value)) {
      return name + ' doit être un objet { "fr": …, "ar": … }.';
    }
    if (!value.fr.trim() || !value.ar.trim()) {
      return name + ' : les deux langues sont obligatoires (' +
        (value.fr.trim() ? 'arabe' : 'français') + ' vide).';
    }
    return null;
  }

  /* Valide le contenu d'un fichier JSON de procédures.
     Renvoie { valid, problems: [], procedures: [] } */
  function validate(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return { valid: false, problems: ['Fichier JSON illisible : ' + error.message], procedures: [] };
    }

    if (!Array.isArray(parsed)) {
      return {
        valid: false,
        problems: ['Le fichier doit contenir un tableau JSON de procédures (racine de type ' +
          (parsed === null ? 'null' : typeof parsed) + ' trouvée).'],
        procedures: []
      };
    }

    if (!parsed.length) {
      return { valid: false, problems: ['Le tableau est vide : aucune procédure à importer.'], procedures: [] };
    }

    var problems = [];
    parsed.forEach(function (entry, index) {
      var label = 'Entrée ' + (index + 1) + ' : ';

      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        problems.push(label + 'ce n\'est pas un objet JSON.');
        return;
      }

      // Titre obligatoire, description / frais / délai facultatifs.
      var titleProblem = pairProblem(entry.proc_title, 'titre (proc_title)', false);
      if (titleProblem) problems.push(label + titleProblem);

      PAIR_FIELDS.slice(1).forEach(function (key) {
        var problem = pairProblem(entry[key], key, true);
        if (problem) problems.push(label + problem);
      });

      PAIR_LISTS.forEach(function (key) {
        var value = entry[key];
        if (value === undefined || value === null) {
          // proc_administration absente : la procédure sera rattachée à
          // « Administration non spécifiée », ce n'est pas un refus.
          return;
        }
        if (!Array.isArray(value)) {
          problems.push(label + key + ' doit être un tableau.');
          return;
        }
        value.forEach(function (item, itemIndex) {
          var problem = pairProblem(item, key + '[' + itemIndex + ']', false);
          if (problem) problems.push(label + problem);
        });
      });

      // Les textes de loi restent des chaînes simples.
      if (entry.proc_law !== undefined && entry.proc_law !== null) {
        if (!Array.isArray(entry.proc_law)) {
          problems.push(label + 'proc_law doit être un tableau.');
        } else if (entry.proc_law.some(function (item) { return typeof item !== 'string'; })) {
          problems.push(label + 'proc_law doit être une liste de chaînes ' +
            '(les textes de loi ne sont pas traduits).');
        }
      }
    });

    return { valid: problems.length === 0, problems: problems, procedures: parsed };
  }

  function renderValidation(result) {
    if (!result) return '';

    if (result.valid) {
      var titles = result.procedures.slice(0, PREVIEW_TITLES).map(function (entry) {
        // Le titre est une paire : on montre celui de la langue courante.
        return '<li dir="auto">' + esc(h.pick(entry.proc_title).trim()) + '</li>';
      }).join('');
      var remaining = result.procedures.length - PREVIEW_TITLES;
      return '<div class="validation-box ok">' +
        '<div class="v-title">' + esc(h.plural(result.procedures.length, 'procédure détectée', 'procédures détectées')) +
          ' — prêtes à importer</div>' +
        '<ul>' + titles +
          (remaining > 0 ? '<li>… et ' + remaining + ' autre' + (remaining >= 2 ? 's' : '') + '</li>' : '') +
        '</ul></div>';
    }

    var listed = result.problems.slice(0, MAX_LISTED_PROBLEMS);
    var hidden = result.problems.length - listed.length;
    return '<div class="validation-box ko">' +
      '<div class="v-title">' + esc(h.plural(result.problems.length, 'problème détecté', 'problèmes détectés')) +
        ' — import bloqué</div>' +
      '<ul>' + listed.map(function (problem) { return '<li>' + esc(problem) + '</li>'; }).join('') +
        (hidden > 0 ? '<li>… et ' + hidden + ' autre' + (hidden >= 2 ? 's' : '') + '</li>' : '') +
      '</ul></div>';
  }

  function open() {
    var file = null;
    var result = null;
    var busy = false;

    var modal = h.openModal('' +
      '<h3>Importer un JSON</h3>' +
      '<p class="dialog-sub">Fichier de procédures déjà vérifiées. Aucune extraction n\'est lancée.</p>' +
      '<div id="json-error"></div>' +
      '<div class="dropzone" id="json-zone" role="button" tabindex="0" ' +
        'aria-label="Choisir un fichier JSON">' +
        '<div id="json-zone-content">' +
          '<div>Glissez un fichier ici ou cliquez pour parcourir</div>' +
          '<div class="dz-hint">Fichier .json uniquement · format bilingue ' +
            '{ "fr": …, "ar": … }</div>' +
        '</div>' +
      '</div>' +
      '<div id="json-validation"></div>' +
      '<div class="field-group">' +
        '<label class="field-label" for="json-source">Source (facultatif)</label>' +
        '<input type="text" id="json-source" placeholder="Ex. : crawler service-public.ma">' +
      '</div>' +
      '<div class="info-note">' + icon('info') +
        '<span>Le fichier sera ouvert dans l\'éditeur pour une dernière vérification ' +
        'avant enregistrement en base.</span></div>' +
      '<div class="dialog-actions">' +
        '<button type="button" data-action="cancel">Annuler</button>' +
        '<button type="button" class="btn-primary" data-action="submit" disabled>Importer</button>' +
      '</div>',
      { wide: true, canClose: function () { return !busy; } }
    );

    var dialog = modal.dialog;
    var zone = dialog.querySelector('#json-zone');
    var zoneContent = dialog.querySelector('#json-zone-content');
    var errorBox = dialog.querySelector('#json-error');
    var validationBox = dialog.querySelector('#json-validation');
    var submitButton = dialog.querySelector('[data-action="submit"]');

    function showError(message) {
      errorBox.innerHTML = message
        ? '<div class="inline-error" role="alert">' + icon('alert') +
          '<span dir="auto">' + esc(message) + '</span></div>'
        : '';
    }

    h.wireDropzone(zone, {
      accept: ['.json'],
      maxBytes: App.config.MAX_UPLOAD_BYTES,
      onError: function (message) {
        showError(message);
        file = null;
        result = null;
        validationBox.innerHTML = '';
        submitButton.disabled = true;
      },
      onFile: function (selected) {
        showError('');
        zoneContent.innerHTML =
          '<div class="dz-file">' + icon('braces') + '<span>' + esc(selected.name) + '</span></div>' +
          '<div class="dz-hint">' + esc(h.formatBytes(selected.size)) + ' · analyse en cours…</div>';
        submitButton.disabled = true;

        h.readFileAsText(selected).then(function (text) {
          file = selected;
          result = validate(text);
          zoneContent.querySelector('.dz-hint').textContent =
            h.formatBytes(selected.size) + ' · cliquez pour changer de fichier';
          validationBox.innerHTML = renderValidation(result);
          submitButton.disabled = !result.valid;
        }).catch(function (error) {
          file = null;
          result = null;
          showError(error.message);
        });
      }
    });

    function submit() {
      if (busy || !file || !result || !result.valid) return;
      busy = true;
      submitButton.disabled = true;
      submitButton.textContent = 'Import en cours…';
      showError('');

      App.api.importJson({
        file: file,
        source: dialog.querySelector('#json-source').value.trim()
      }).then(function (extractionId) {
        busy = false;
        modal.close();
        h.toast('JSON importé. Vérifiez les procédures avant enregistrement.', 'success');
        // On ouvre l'éditeur : rien n'est écrit en base depuis cette modale.
        App.router.navigate('#/extractions/' + encodeURIComponent(extractionId));
      }).catch(function (error) {
        busy = false;
        submitButton.disabled = false;
        submitButton.textContent = 'Importer';
        /* Un 422 vient du refus de l'ancien format plat : son message nomme
           l'entrée et le champ fautifs. On l'affiche tel quel — c'est le
           fichier qu'il faut regénérer, et rien d'autre ne le dit aussi
           precisement. */
        showError(error.status === 422
          ? 'Format refusé par le serveur — ' + error.message
          : error.message);
      });
    }

    h.on(dialog, 'click', '[data-action]', function (event, target) {
      var action = target.getAttribute('data-action');
      if (action === 'cancel') modal.requestClose();
      else if (action === 'submit') submit();
    });
  }

  App.modals = App.modals || {};
  App.modals.importJson = open;
  App.modals.validateProceduresJson = validate; // exporté pour d'éventuels tests
})(window);
