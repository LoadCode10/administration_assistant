/* Écran 5 — Administrations : les organismes propriétaires des procédures.

   Elles ne se créent pas ici — une administration naît de l'import d'une
   procédure, et le backend n'expose ni création ni suppression. L'écran sert à
   compléter ce que l'import laisse vide : la plupart des administrations
   arrivent sans adresse ni site web. D'où la mention explicite des manques
   dans la liste, plutôt qu'une ligne muette.

   L'édition se fait sur place, à la ligne : ouvrir une fiche ne fait pas perdre
   de vue le reste de la liste, et il y a au plus quelques dizaines d'entrées.
   La recherche filtre donc elle aussi côté client. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  function normalize(value) {
    return String(value === null || value === undefined ? '' : value).toLowerCase();
  }

  function mount(root) {
    var view = document.createElement('div');
    root.appendChild(view);

    var state = {
      administrations: [],
      query: '',
      loaded: false,
      // Page courante du découpage client (voir App.helpers.paginate).
      page: 1,
      // Fiche ouverte en édition : son identifiant, la saisie en cours, et le
      // message renvoyé par le serveur pour le champ « Nom ».
      editingId: null,
      draft: null,
      nameError: '',
      saving: false
    };

    view.innerHTML =
      '<div class="screen-header">' +
        '<div>' +
          '<h1>Administrations</h1>' +
          '<p class="subtitle" id="admin-subtitle">Chargement…</p>' +
        '</div>' +
      '</div>' +
      '<div class="toolbar">' +
        '<label class="search">' + icon('search', 'icon-sm') +
          '<input type="search" dir="auto" id="admin-search" ' +
            'placeholder="Rechercher une administration…" aria-label="Rechercher">' +
        '</label>' +
      '</div>' +
      '<div id="admin-body">' +
        '<div class="skeleton-card" style="height:64px"></div>' +
        '<div class="skeleton-card" style="height:64px"></div>' +
        '<div class="skeleton-card" style="height:64px"></div>' +
      '</div>';

    var bodyNode = view.querySelector('#admin-body');
    var subtitle = view.querySelector('#admin-subtitle');
    var searchInput = view.querySelector('#admin-search');
    var destroyed = false;

    function filtered() {
      if (!state.query) return state.administrations;
      var needle = normalize(state.query);
      return state.administrations.filter(function (administration) {
        return normalize(administration.name).indexOf(needle) !== -1;
      });
    }

    function find(id) {
      return state.administrations.filter(function (administration) {
        return String(administration.id) === String(id);
      })[0] || null;
    }

    /* --- Ligne repliée ------------------------------------------------------ */

    /* Adresse et site sous le nom. Les deux manquent souvent : on le dit au
       lieu de laisser une ligne vide, sinon le trou passe inaperçu.
       Chacun est precede de son icone : les deux valeurs sont du texte gris de
       meme taille, sans elles on ne sait pas laquelle on lit avant de l'avoir
       lue. Les icones sont decoratives — le texte porte deja le sens — d'ou le
       aria-hidden pose par le helper. Elles remplacent aussi le point median :
       elles separent mieux que lui, on garde juste un ecart plus large. */
    function renderContact(administration) {
      var parts = [];
      if (administration.address) {
        parts.push('<span class="admin-bit" dir="auto">' + icon('map-pin', 'icon-sm') +
          '<span>' + esc(administration.address) + '</span></span>');
      }
      if (administration.url) {
        parts.push('<a class="admin-bit admin-link" href="' + esc(administration.url) + '" ' +
          'target="_blank" rel="noopener noreferrer" dir="auto">' +
          icon('link', 'icon-sm') + '<span>' + esc(administration.url) + '</span></a>');
      }
      if (!parts.length) {
        return '<div class="admin-contact is-empty">Adresse et site non renseignés</div>';
      }
      return '<div class="admin-contact">' + parts.join('') + '</div>';
    }

    function renderRow(administration) {
      return '<div class="admin-row">' +
          '<div class="admin-main">' +
            '<div class="admin-name" dir="auto">' + esc(administration.name) + '</div>' +
            renderContact(administration) +
          '</div>' +
          '<span class="meta-chip">' + icon('list', 'icon-sm') +
            esc(h.plural(administration.procedureCount, 'procédure')) + '</span>' +
          '<button type="button" class="btn-quiet btn-tiny" data-action="edit" ' +
            'data-id="' + esc(administration.id) + '" ' +
            'aria-label="Modifier ' + esc(administration.name) + '">Modifier</button>' +
        '</div>';
    }

    /* --- Fiche en édition --------------------------------------------------- */

    /* Le formulaire remplace la ligne, il ne s'ouvre pas en fenêtre : la saisie
       reste à sa place dans la liste. Les valeurs viennent de state.draft, tenu
       à jour à la frappe — un redessin (un 409, par exemple) ne perd donc jamais
       ce qui a été tapé. */
    function renderForm(administration) {
      var draft = state.draft || { name: '', address: '', url: '' };
      var id = administration.id;
      return '<div class="admin-form">' +
          '<div class="field-group">' +
            '<label class="field-label" for="admin-name-' + esc(id) + '">Nom</label>' +
            '<input type="text" dir="auto" id="admin-name-' + esc(id) + '" data-draft="name" ' +
              'class="' + (state.nameError ? 'is-invalid' : '') + '" ' +
              'value="' + esc(draft.name) + '">' +
            (state.nameError
              ? '<div class="field-error">' + esc(state.nameError) + '</div>'
              : '') +
          '</div>' +
          '<div class="field-group two-col">' +
            '<div>' +
              '<label class="field-label" for="admin-addr-' + esc(id) + '">Adresse</label>' +
              '<input type="text" dir="auto" id="admin-addr-' + esc(id) + '" data-draft="address" ' +
                'placeholder="Non renseignée" value="' + esc(draft.address) + '">' +
            '</div>' +
            '<div>' +
              '<label class="field-label" for="admin-url-' + esc(id) + '">Site web</label>' +
              '<input type="text" dir="auto" id="admin-url-' + esc(id) + '" data-draft="url" ' +
                'placeholder="Non renseigné" value="' + esc(draft.url) + '">' +
            '</div>' +
          '</div>' +
          '<div class="admin-form-actions">' +
            '<button type="button" class="btn-quiet" data-action="cancel"' +
              (state.saving ? ' disabled' : '') + '>Annuler</button>' +
            '<button type="button" class="btn-primary" data-action="save"' +
              (state.saving ? ' disabled' : '') + '>' +
              (state.saving ? 'Enregistrement…' : 'Enregistrer') + '</button>' +
          '</div>' +
        '</div>';
    }

    function emptyState() {
      return '<div class="state-block">' +
        '<div class="state-title">Aucune administration</div>' +
        '<div>' + (state.query
          ? 'Aucun nom ne correspond à « ' + esc(state.query) + ' ».'
          : 'Les administrations apparaissent ici dès qu\'une procédure les cite.') + '</div>' +
        '</div>';
    }

    /* --- Rendu -------------------------------------------------------------- */

    function render() {
      var list = filtered();
      var page = h.paginate(list, state.page);
      state.page = page.page;

      bodyNode.innerHTML = !list.length ? emptyState() : page.items.map(function (administration) {
        var editing = String(state.editingId) === String(administration.id);
        return '<div class="proc-card' + (editing ? ' is-open' : '') + '">' +
          (editing ? renderForm(administration) : renderRow(administration)) +
          '</div>';
      }).join('') + page.controls;

      subtitle.textContent = state.query
        ? h.plural(list.length, 'résultat') + ' sur ' + state.administrations.length
        : h.plural(list.length, 'administration');
    }

    /* Redonne le focus au champ « Nom » : appelé après un conflit, pour que la
       correction se fasse sans reprendre la souris. */
    function focusName() {
      var input = bodyNode.querySelector('[data-draft="name"]');
      if (!input) return;
      input.focus();
      input.select();
    }

    /* --- Interactions ------------------------------------------------------- */

    var searchTimer = null;
    searchInput.addEventListener('input', function () {
      // Anti-rebond, comme sur l'écran « Procédures ».
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.query = searchInput.value.trim();
        // Le filtre s'applique avant le découpage : on repart de la première
        // page, sinon un filtre court laisserait une page vide à l'écran.
        state.page = 1;
        if (state.loaded) render();
      }, 160);
    });

    // La saisie alimente le brouillon sans redessiner : le DOM affiche déjà la
    // frappe, et redessiner couperait le curseur.
    h.on(view, 'input', '[data-draft]', function (event, target) {
      if (!state.draft) return;
      state.draft[target.getAttribute('data-draft')] = target.value;
    });

    h.on(view, 'click', '[data-action]', function (event, target) {
      var action = target.getAttribute('data-action');

      if (action === 'edit') {
        openForm(target.getAttribute('data-id'));
      } else if (action === 'cancel') {
        closeForm();
      } else if (action === 'save') {
        save();
      } else if (action === 'page-prev' || action === 'page-next') {
        changePage(action === 'page-next' ? 1 : -1);
      } else if (action === 'retry') {
        load();
      }
    });

    function openForm(id) {
      var administration = find(id);
      if (!administration) return;
      state.editingId = administration.id;
      state.draft = {
        name: administration.name,
        address: administration.address,
        url: administration.url
      };
      state.nameError = '';
      state.saving = false;
      render();
      focusName();
    }

    function resetForm() {
      state.editingId = null;
      state.draft = null;
      state.nameError = '';
      state.saving = false;
    }

    function closeForm() {
      resetForm();
      render();
    }

    /* Vrai tant que la saisie diffère de ce qui est enregistré : sert à ne
       demander confirmation que lorsqu'il y a réellement quelque chose à
       perdre. */
    function isDirty() {
      var administration = find(state.editingId);
      if (!administration || !state.draft) return false;
      return ['name', 'address', 'url'].some(function (field) {
        return String(state.draft[field] || '') !== String(administration[field] || '');
      });
    }

    /* La fiche ouverte appartient à la page qu'on quitte : elle se referme.
       Une saisie en cours ne disparaît pas sans qu'on le demande — un
       enregistrement en cours, lui, n'est pas interrompu. */
    function changePage(delta) {
      if (state.saving) return;
      if (isDirty() && !global.confirm(
        'Les modifications sur « ' + h.isolate(state.draft.name) +
        ' » ne sont pas enregistrées.\n\n' +
        'Changer de page et les perdre ?')) return;
      state.page += delta;
      resetForm();
      render();
    }

    function save() {
      var administration = find(state.editingId);
      if (!administration || state.saving) return;

      var draft = state.draft;
      if (!String(draft.name || '').trim()) {
        state.nameError = 'Le nom est obligatoire.';
        render();
        focusName();
        return;
      }

      state.saving = true;
      state.nameError = '';
      render();

      App.api.saveAdministration(administration.id, draft).then(function (updated) {
        if (destroyed) return;
        // Mise à jour sur place. Le backend ne renvoie pas le nombre de
        // procédures : on garde celui déjà affiché.
        administration.name = updated.name;
        administration.address = updated.address;
        administration.url = updated.url;
        closeForm();
        h.toast('« ' + h.isolate(administration.name) + ' » a été enregistrée.');
      }).catch(function (error) {
        if (destroyed) return;
        state.saving = false;
        // 409 : un autre organisme porte déjà ce nom. Le formulaire reste
        // ouvert avec la saisie intacte, le message se pose sur le champ.
        if (error && error.status === 409) {
          state.nameError = error.message;
          render();
          focusName();
          return;
        }
        render();
        h.toast(error.message, 'error');
      });
    }

    /* --- Chargement --------------------------------------------------------- */

    function load() {
      return App.api.listAdministrations().then(function (list) {
        if (destroyed) return;
        // Le backend trie déjà par nom : on garde son ordre.
        state.administrations = list;
        state.loaded = true;
        closeForm();
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
  App.screens.administrations = { mount: mount };
})(window);
