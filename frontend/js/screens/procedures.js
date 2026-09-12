/* Écran 2 — Procédures, toutes extractions confondues.

   Deux vues sur le même jeu de données :
   — « Procédures » : la liste, dépliable sur ses pièces et ses étapes ;
   — « Pièces requises » : l'inventaire des pièces, par fréquence.
   La seconde répond à la question « quelle pièce revient partout ? »,
   qu'on ne peut pas lire dans une liste de procédures.

   Une procédure retirée par son administration n'est pas supprimée : elle est
   marquée obsolète. Sa ligne reste, elle sort des réponses de l'assistant, et
   les citoyens qui la suivaient gardent leur liste de pièces avec un
   avertissement. La suppression définitive existe toujours, mais pour le seul
   cas d'une procédure extraite par erreur — et le backend la refuse tant qu'un
   citoyen suit la procédure. D'où deux gestes distincts sur la carte :
   l'archivage en premier, à sa place habituelle, la suppression à l'intérieur
   de la carte dépliée. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  // Les délais issus de l'import idarati peuvent être de longs paragraphes :
  // on les raccourcit dans la puce, la valeur complète restant en infobulle.
  function truncate(value, max) {
    var text = String(value || '');
    return text.length > max ? text.slice(0, max) + '…' : text;
  }

  var VIEWS = [
    { key: 'all',    hash: '#/procedures',        label: 'Procédures' },
    { key: 'pieces', hash: '#/procedures/pieces', label: 'Pièces requises' }
  ];

  function normalize(value) {
    return String(value === null || value === undefined ? '' : value).toLowerCase();
  }

  /* Toutes les chaînes d'une procédure, pour la recherche plein texte. */
  function haystack(procedure) {
    return normalize([
      procedure.proc_title,
      procedure.proc_description,
      (procedure.proc_administration || []).join(' '),
      (procedure.proc_pieces || []).join(' '),
      (procedure.proc_steps || []).join(' '),
      procedure.extractionName
    ].join(' '));
  }

  /* Inventaire : chaque valeur distincte, son nombre d'occurrences et les
     procédures qui la citent. */
  function inventory(procedures, field) {
    var map = {};
    procedures.forEach(function (procedure) {
      (procedure[field] || []).forEach(function (raw) {
        var label = String(raw).trim();
        if (!label) return;
        var key = label.toLowerCase();
        if (!map[key]) map[key] = { label: label, count: 0, owners: [] };
        map[key].count += 1;
        map[key].owners.push(procedure);
      });
    });
    return Object.keys(map).map(function (key) { return map[key]; })
      .sort(function (a, b) {
        return b.count - a.count || a.label.localeCompare(b.label, 'fr');
      });
  }

  function mount(root, params) {
    var view = document.createElement('div');
    root.appendChild(view);

    var state = {
      procedures: [],
      query: '',
      openKey: null,
      // Page courante du découpage client (voir App.helpers.paginate).
      page: 1,
      // Les obsolètes sont masquées tant qu'on ne les demande pas : la liste
      // répond d'abord à « que peut-on faire aujourd'hui ? ».
      showObsolete: false,
      vue: (params && params.vue) || 'all',
      loaded: false
    };
    if (!VIEWS.some(function (v) { return v.key === state.vue; })) state.vue = 'all';

    var current = VIEWS.filter(function (v) { return v.key === state.vue; })[0];

    view.innerHTML =
      '<div class="screen-header">' +
        '<div>' +
          '<h1>' + esc(current.label) + '</h1>' +
          '<p class="subtitle" id="proc-subtitle">Chargement…</p>' +
        '</div>' +
      '</div>' +
      '<div class="toolbar">' +
        '<div class="tabs">' +
          VIEWS.map(function (v) {
            return '<a class="tab' + (v.key === state.vue ? ' is-active' : '') + '" ' +
              'href="' + v.hash + '">' + esc(v.label) + '</a>';
          }).join('') +
        '</div>' +
        '<label class="search">' + icon('search', 'icon-sm') +
          '<input type="search" dir="auto" id="proc-search" ' +
            'placeholder="Rechercher un titre, une administration, une pièce…" ' +
            'aria-label="Rechercher">' +
        '</label>' +
      '</div>' +
      '<div class="list-filters">' +
        '<label class="filter-toggle">' +
          '<input type="checkbox" id="proc-obsolete">' +
          '<span>Afficher les procédures obsolètes</span>' +
        '</label>' +
      '</div>' +
      '<div id="proc-body">' +
        '<div class="skeleton-card" style="height:64px"></div>' +
        '<div class="skeleton-card" style="height:64px"></div>' +
        '<div class="skeleton-card" style="height:64px"></div>' +
      '</div>';

    var bodyNode = view.querySelector('#proc-body');
    var subtitle = view.querySelector('#proc-subtitle');
    var destroyed = false;

    function isObsolete(procedure) {
      return procedure.status === 'obsolete';
    }

    /* Le statut d'abord : la recherche et la pagination ne travaillent que sur
       ce que la liste montre. */
    function visible() {
      if (state.showObsolete) return state.procedures;
      return state.procedures.filter(function (procedure) {
        return !isObsolete(procedure);
      });
    }

    function filtered() {
      var list = visible();
      if (!state.query) return list;
      var needle = normalize(state.query);
      return list.filter(function (procedure) {
        return haystack(procedure).indexOf(needle) !== -1;
      });
    }

    // Combien d'obsolètes le filtre retient : le sous-titre le dit, sinon
    // l'écart entre le compte affiché et la base ne s'explique pas.
    function hiddenCount() {
      if (state.showObsolete) return 0;
      return state.procedures.filter(isObsolete).length;
    }

    function findByKey(key) {
      return state.procedures.filter(function (procedure) {
        return procedure.extractionId + ':' + procedure.index === key;
      })[0] || null;
    }

    /* --- Vue « Procédures » ------------------------------------------------ */

    function renderList(list) {
      if (!list.length) return emptyState();

      return list.map(function (procedure) {
        var key = procedure.extractionId + ':' + procedure.index;
        var open = state.openKey === key;
        var obsolete = isObsolete(procedure);
        var title = procedure.proc_title || 'Procédure sans titre';
        var administration = (procedure.proc_administration || [])
          .filter(function (a) { return String(a).trim(); })[0];

        /* Le geste principal archive, il ne détruit pas : l'icône est un carton
           d'archives et non une corbeille, sans quoi l'affordance mentirait sur
           ce qui va se passer. Rien à archiver sur une procédure déjà obsolète —
           la place revient alors au badge et à sa date. */
        var head =
          '<div class="proc-row">' +
            '<button type="button" class="proc-toggle" data-action="toggle" ' +
              'data-key="' + esc(key) + '" aria-expanded="' + open + '">' +
              icon(open ? 'chevron-down' : 'chevron-right') +
              '<span class="proc-title-text" dir="auto">' + esc(title) + '</span>' +
            '</button>' +
            (obsolete
              ? '<span class="pill pill-obsolete">Obsolète</span>' +
                (procedure.obsoleteAt
                  ? '<span class="proc-obsolete-date">depuis le ' +
                    esc(h.formatDate(procedure.obsoleteAt)) + '</span>'
                  : '')
              : '<button type="button" class="icon-btn icon-btn-archive" ' +
                'data-action="obsolete" data-key="' + esc(key) + '" ' +
                'title="Marquer comme obsolète" ' +
                'aria-label="Marquer « ' + esc(title) + ' » comme obsolète">' +
                icon('archive') + '</button>') +
          '</div>';

        var meta =
          '<div class="proc-meta">' +
            (administration
              ? '<span class="meta-chip">' + icon('building', 'icon-sm') +
                '<span dir="auto">' + esc(administration) + '</span></span>'
              : '<span class="meta-chip is-missing">' + icon('alert', 'icon-sm') +
                'Administration manquante</span>') +
            '<span class="meta-chip">' + icon('layers', 'icon-sm') +
              esc(h.plural((procedure.proc_pieces || []).length, 'pièce')) + '</span>' +
            '<span class="meta-chip">' + icon('clock', 'icon-sm') +
              esc(h.plural((procedure.proc_steps || []).length, 'étape')) + '</span>' +
            (procedure.fee ? '<span class="meta-chip" dir="auto">' + esc(procedure.fee) + '</span>' : '') +
            (procedure.proc_delai
              ? '<span class="meta-chip" dir="auto" title="' + esc(procedure.proc_delai) + '">' +
                icon('clock', 'icon-sm') + esc(truncate(procedure.proc_delai, 40)) + '</span>'
              : '') +
          '</div>';

        var detail = open ? '<div class="proc-detail">' +
            (procedure.proc_description
              ? '<p class="proc-desc" dir="auto">' + esc(procedure.proc_description) + '</p>' : '') +
            listBlock('Pièces requises', procedure.proc_pieces, false) +
            listBlock('Étapes', procedure.proc_steps, true) +
            listBlock('Textes de loi', procedure.proc_law, false) +
            /* La suppression définitive ne vaut que pour une procédure extraite
               par erreur : elle vit à l'intérieur de la carte dépliée, jamais
               dans le bandeau, pour qu'on ne l'atteigne pas d'un clic distrait.
               Le fichier d'origine n'est pas toujours connu (/admin/procedures
               ne le renvoie pas) : dans ce cas on n'affiche ni son nom ni un
               lien mort vers l'éditeur. */
            '<div class="proc-detail-foot">' +
              '<span class="detail-source mono" dir="auto">' +
                esc(procedure.extractionId ? (procedure.extractionName || '') : '') +
                '</span>' +
              '<div class="detail-foot-actions">' +
                (procedure.extractionId
                  ? '<button type="button" class="btn-quiet btn-tiny" data-action="edit" ' +
                    'data-id="' + esc(procedure.extractionId) + '">' +
                    icon('code', 'icon-sm') + 'Ouvrir dans l\'éditeur</button>'
                  : '') +
                '<button type="button" class="btn-quiet btn-tiny btn-danger-quiet" ' +
                  'data-action="delete-proc" data-key="' + esc(key) + '">' +
                  icon('trash', 'icon-sm') + 'Supprimer définitivement</button>' +
              '</div>' +
            '</div>' +
          '</div>' : '';

        return '<div class="proc-card' + (open ? ' is-open' : '') +
          (obsolete ? ' is-obsolete' : '') + '">' +
          head + meta + detail + '</div>';
      }).join('');
    }

    function listBlock(title, items, numbered) {
      items = (items || []).filter(function (item) { return String(item).trim(); });
      return '<div class="detail-block">' +
        '<div class="detail-title">' + esc(title) +
          ' <span class="detail-count">' + items.length + '</span></div>' +
        (items.length
          ? '<' + (numbered ? 'ol' : 'ul') + ' class="detail-list">' +
            items.map(function (item) {
              return '<li dir="auto">' + esc(item) + '</li>';
            }).join('') + '</' + (numbered ? 'ol' : 'ul') + '>'
          : '<div class="list-empty">Aucun élément.</div>') +
        '</div>';
    }

    /* --- Vue « Pièces » ---------------------------------------------------- */

    /* entries : l'inventaire complet, déjà trié par fréquence. La pagination
       ne fait qu'en prendre une tranche — l'ordre ne change pas d'une page à
       l'autre, et l'échelle des barres reste celle de l'entrée la plus
       fréquente, sinon la même pièce n'aurait pas la même barre page 1 et
       page 2. */
    function renderInventory(entries, page, unitSingular) {
      if (!entries.length) return emptyState();

      var max = entries[0].count;

      return '<div class="inv-head">' +
          '<span>' + esc(h.plural(entries.length, unitSingular + ' distincte',
            unitSingular + 's distinctes')) + '</span>' +
          '<span class="inv-hint">Triées par fréquence</span>' +
        '</div>' +
        page.items.map(function (entry) {
          // Barre de fréquence : une seule teinte, la longueur porte la valeur.
          var pct = Math.round((entry.count / max) * 100);
          return '<div class="inv-row">' +
            '<span class="inv-label" dir="auto">' + esc(entry.label) + '</span>' +
            '<span class="inv-bar"><span style="width:' + pct + '%"></span></span>' +
            '<span class="inv-count">' + entry.count + '</span>' +
            '</div>';
        }).join('') +
        page.controls;
    }

    /* Trois vides à ne pas confondre : la recherche sans résultat, la base
       encore vide, et le cas où seules des obsolètes existent — dire alors
       « importez un document » enverrait chercher ce qui est déjà là. */
    function emptyState() {
      var hidden = hiddenCount();
      var title = state.query ? 'Aucun résultat'
        : (hidden ? 'Aucune procédure en vigueur' : 'Aucune procédure');
      var message;
      if (state.query) {
        message = 'Aucune entrée ne correspond à « ' + esc(state.query) + ' ».';
      } else if (hidden) {
        message = esc(h.plural(hidden, 'procédure obsolète est masquée',
          'procédures obsolètes sont masquées')) +
          ' : cochez « Afficher les procédures obsolètes » pour les voir.';
      } else {
        message = 'Importez un document ou un fichier JSON pour commencer.';
      }
      return '<div class="state-block">' +
        '<div class="state-title">' + title + '</div>' +
        '<div>' + message + '</div>' +
        '</div>';
    }

    /* --- Rendu -------------------------------------------------------------- */

    function render() {
      var list = filtered();

      if (state.vue === 'pieces') {
        var entries = inventory(list, 'proc_pieces');
        var piecesPage = h.paginate(entries, state.page);
        state.page = piecesPage.page;
        bodyNode.innerHTML = renderInventory(entries, piecesPage, 'pièce');
        subtitle.textContent = 'Inventaire des pièces citées par ' +
          h.plural(list.length, 'procédure');
      } else {
        var procPage = h.paginate(list, state.page);
        // La page est ramenée dans les bornes : une suppression qui vide la
        // dernière page nous fait reculer d'une, sans vue vide.
        state.page = procPage.page;
        bodyNode.innerHTML = renderList(procPage.items) + procPage.controls;
        var hidden = hiddenCount();
        subtitle.textContent = state.query
          ? h.plural(list.length, 'résultat') + ' sur ' + visible().length
          : (hidden
            ? h.plural(list.length, 'procédure en vigueur', 'procédures en vigueur') +
              ' · ' + h.plural(hidden, 'obsolète masquée', 'obsolètes masquées')
            : h.plural(list.length, 'procédure') + ', tous fichiers confondus');
      }
    }

    /* --- Interactions -------------------------------------------------------- */

    var searchInput = view.querySelector('#proc-search');
    var searchTimer = null;
    searchInput.addEventListener('input', function () {
      // Anti-rebond : la liste peut être longue, on ne redessine pas à chaque frappe.
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.query = searchInput.value.trim();
        state.openKey = null;
        // Sans ce retour, un filtre de trois résultats lu depuis la page 3
        // n'afficherait rien.
        state.page = 1;
        if (state.loaded) render();
      }, 160);
    });

    /* Changer de filtre change le jeu paginé : on revient page 1 et on referme
       la carte dépliée, qui peut ne plus être là. */
    var obsoleteToggle = view.querySelector('#proc-obsolete');
    obsoleteToggle.checked = state.showObsolete;
    obsoleteToggle.addEventListener('change', function () {
      state.showObsolete = obsoleteToggle.checked;
      state.openKey = null;
      state.page = 1;
      if (state.loaded) render();
    });

    h.on(view, 'click', '[data-action]', function (event, target) {
      var action = target.getAttribute('data-action');
      if (action === 'toggle') {
        var key = target.getAttribute('data-key');
        state.openKey = state.openKey === key ? null : key;
        render();
      } else if (action === 'obsolete') {
        markObsolete(target.getAttribute('data-key'));
      } else if (action === 'delete-proc') {
        removeProcedure(target.getAttribute('data-key'));
      } else if (action === 'edit') {
        App.router.navigate('#/extractions/' +
          encodeURIComponent(target.getAttribute('data-id')));
      } else if (action === 'page-prev' || action === 'page-next') {
        state.page += (action === 'page-next' ? 1 : -1);
        // La carte dépliée appartient à la page qu'on quitte.
        state.openKey = null;
        render();
      } else if (action === 'retry') {
        load();
      }
    });

    /* Marquer obsolète : la ligne reste, seul son statut change. La modale dit
       les deux conséquences qui ne se devinent pas — l'assistant cesse de la
       citer, et les citoyens qui la suivent voient leur fiche marquée. */
    function markObsolete(key) {
      var procedure = findByKey(key);
      if (!procedure || isObsolete(procedure)) return;

      var title = procedure.proc_title || 'cette procédure';

      App.modals.confirm({
        title: 'Marquer la procédure comme obsolète',
        intro: 'Confirmez la mise hors vigueur de',
        target: title,
        tone: 'warning',
        noteTitle: 'La procédure est conservée, mais n\'est plus en vigueur.',
        consequences: [
          'Elle n\'apparaîtra plus dans les réponses de l\'assistant.',
          'Les citoyens qui la suivent gardent leur liste de pièces, ' +
            'signalée comme n\'étant plus en vigueur.',
          'Sa fiche reste ici, marquée « Obsolète ».'
        ],
        confirmLabel: 'Marquer obsolète',
        confirmIcon: 'archive',
        busyLabel: 'Enregistrement…',
        run: function () { return App.api.markProcedureObsolete(procedure.id); },
        onDeleted: function (result) {
          var affected = (result && result.affectedUsers) || 0;
          /* Mise à jour sur place : un seul champ a changé, recharger toute la
             liste ferait clignoter l'écran pour rien. La date exacte est celle
             du serveur, que la réponse ne renvoie pas — l'instant présent en
             est à la seconde près. */
          procedure.status = 'obsolete';
          procedure.obsoleteAt = new Date().toISOString();
          render();
          h.toast('Procédure marquée obsolète · ' + (affected
            ? h.plural(affected, 'citoyen concerné', 'citoyens concernés')
            : 'aucun citoyen concerné'));
        }
      });
    }

    /* Suppression définitive — réservée aux procédures extraites par erreur.
       Le backend la refuse (409) tant qu'un citoyen suit la procédure : son
       message s'affiche dans la modale, la procédure reste en place, et on ne
       propose pas de passer outre. */
    function removeProcedure(key) {
      var procedure = findByKey(key);
      if (!procedure) return;

      var title = procedure.proc_title || 'cette procédure';
      var consequences = [
        procedure.extractionName
          ? 'La procédure sera retirée du fichier ' + esc(procedure.extractionName) + '.'
          : 'La procédure sera effacée de la base : il n\'y a pas de corbeille.',
        'Ses pièces, ses étapes et ses textes de loi seront perdus.'
      ];
      if (!isObsolete(procedure)) {
        consequences.push('Pour retirer une démarche qui n\'a plus cours, ' +
          'préférez « Marquer comme obsolète » : la fiche est conservée.');
      }

      App.modals.confirmDelete({
        title: 'Supprimer définitivement la procédure',
        intro: 'Confirmez la suppression définitive de',
        target: title,
        noteTitle: 'Cette suppression est irréversible : rien ne sera récupérable.',
        consequences: consequences,
        confirmLabel: 'Supprimer définitivement',
        run: function () { return App.api.deleteProcedure(procedure.id); },
        onDeleted: function () {
          h.toast('« ' + h.isolate(title) + ' » a été supprimée.');
          if (state.openKey === key) state.openKey = null;
          load();
        }
      });
    }

    /* --- Chargement ---------------------------------------------------------- */

    function load() {
      return App.api.listProcedures().then(function (list) {
        if (destroyed) return;
        state.procedures = list;
        state.loaded = true;
        render();
      }).catch(function (error) {
        if (destroyed) return;
        bodyNode.innerHTML =
          '<div class="state-block error">' +
            '<div class="state-title">Chargement impossible</div>' +
            '<div>' + esc(error.message) + '</div>' +
            '<div class="state-actions">' +
              '<button type="button" data-action="retry">' + icon('refresh') + 'Réessayer</button>' +
            '</div>' +
          '</div>';
        subtitle.textContent = '';
      });
    }

    load();

    return {
      destroy: function () {
        destroyed = true;
        clearTimeout(searchTimer);
      }
    };
  }

  App.screens = App.screens || {};
  App.screens.procedures = { mount: mount };
})(window);
