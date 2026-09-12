/* Confirmation « Supprimer le document » — habille la modale générique. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var esc = App.helpers.esc;

  /* options : { document, onDeleted } — document au format normalisé par l'API. */
  function open(options) {
    var doc = options.document;
    var isImport = doc.kind === 'import';
    var extractionName = doc.extraction && doc.extraction.filename;

    // Ce qui disparaît dépend de la nature de l'élément : un import direct n'a
    // pas de document source, le JSON est l'élément lui-même.
    var consequences = [];
    if (isImport) {
      consequences.push('Le fichier JSON importé et les procédures qu\'il contient.');
    } else {
      consequences.push('Le document source et son fichier téléversé.');
      consequences.push(extractionName
        ? 'L\'extraction ' + esc(extractionName) + ' et les procédures qu\'elle contient.'
        : 'L\'extraction associée, si elle existe, et ses procédures.');
    }
    if (doc.status === 'published') {
      consequences.push('Ces procédures ne seront plus disponibles dans la recherche.');
    }

    App.modals.confirmDelete({
      title: 'Supprimer ' + (isImport ? 'l\'import' : 'le document'),
      target: doc.title || doc.filename,
      consequences: consequences,
      run: function () { return App.api.deleteDocument(doc.id); },
      onDeleted: options.onDeleted
    });
  }

  App.modals = App.modals || {};
  App.modals.deleteDocument = open;
})(window);
