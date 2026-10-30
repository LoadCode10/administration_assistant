/* Écran 8 — Cache des agences (#/agency-cache).

   La recherche des bureaux à proximité coûte un appel au modèle : cinq à
   quinze secondes et des tokens. Le serveur garde donc chaque réponse par
   (administration, ville) pendant « ttl_days » jours, et cet écran montre ce
   qu'il a gardé — combien de fois chaque entrée a resservi, quand elle
   expire — et permet de le vider : une entrée à la fois, les seules entrées
   expirées, ou tout.

   Chaque suppression est confirmée dans la page (App.modals.confirm), puis la
   liste et les compteurs sont rechargés depuis le serveur plutôt que
   recalculés ici : le compteur « Recherches IA évitées » est une somme côté
   base, le reconstituer à la main finirait par diverger.

   Les textes suivent la langue de l'interface (h.labelsFor()), et la mise en
   page n'emploie que des propriétés logiques : en arabe, l'écran se retourne
   avec la page. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  function mount(root) {
    var view = document.createElement('div');
    root.appendChild(view);

    var lang = h.lang();
    var labels = h.labelsFor(lang);

    var state = {
      stats: null,
      entries: [],
      loaded: false,
      // 403 : l'écran n'offre plus aucune action, seulement l'explication.
      forbidden: false
    };

    var destroyed = false;

    view.innerHTML =
      '<div class="screen-header">' +
        '<div>' +
          '<h1>' + esc(labels.cacheTitle) + '</h1>' +
          '<p class="subtitle" id="cache-subtitle">' + esc(labels.cacheLoading) + '</p>' +
        '</div>' +
        '<div class="header-actions" id="cache-actions" hidden>' +
          '<button type="button" data-action="purge">' +
            icon('clock') + esc(labels.cachePurge) + '</button>' +
          '<button type="button" class="btn-danger" data-action="clear">' +
            icon('trash') + esc(labels.cacheClear) + '</button>' +
        '</div>' +
      '</div>' +
      '<div id="cache-body">' + renderSkeleton() + '</div>';

    var bodyNode = view.querySelector('#cache-body');
    var subtitle = view.querySelector('#cache-subtitle');
    var actions = view.querySelector('#cache-actions');

    function renderSkeleton() {
      var tile = '<div class="skeleton-card" style="height:88px"></div>';
      return '<div class="kpi-row">' + tile + tile + tile + tile + tile + '</div>' +
        '<div class="skeleton-card" style="height:220px"></div>';
    }

    /* --- Rendu -------------------------------------------------------------- */

    function statTile(label, value, hint, tone) {
      return '<div class="stat-tile' + (tone ? ' ' + tone : '') + '">' +
        '<div class="stat-label">' + esc(label) + '</div>' +
        '<div class="stat-row"><div class="stat-value">' +
          esc(App.charts.fmt(value)) + '</div></div>' +
        (hint ? '<div class="stat-hint">' + esc(hint) + '</div>' : '') +
        '</div>';
    }

    function renderStats(stats) {
      return '<div class="kpi-row">' +
        statTile(labels.cacheStatEntries, stats.entries) +
        statTile(labels.cacheStatActive, stats.active) +
        statTile(labels.cacheStatExpired, stats.expired, '',
          stats.expired ? 'is-expired' : '') +
        statTile(labels.cacheStatSaved, stats.searchesSaved, labels.cacheStatSavedHint) +
        statTile(labels.cacheStatTtl, stats.ttlDays, labels.cacheStatTtlHint) +
        '</div>';
    }

    /* Le nom français reste la référence de la console ; en arabe, le nom
       arabe passe devant et le français reste dessous, pour qu'une ligne se
       recoupe avec le reste des écrans. */
    function administrationCell(entry) {
      var fr = entry.administration_fr;
      var ar = entry.administration_ar;
      if (!fr && !ar) return '<span class="cache-muted">' + esc(labels.noAdministration) + '</span>';
      if (lang === 'ar' && ar) {
        return '<span class="cache-admin" dir="rtl" lang="ar">' + esc(ar) + '</span>' +
          (fr ? '<span class="cache-admin-alt" dir="auto">' + esc(fr) + '</span>' : '');
      }
      return '<span class="cache-admin" dir="auto">' + esc(fr || ar) + '</span>';
    }

    function dateCell(value, fallback) {
      var text = h.formatLocaleDate(value, lang, true);
      return text
        ? '<span class="cache-date">' + esc(text) + '</span>'
        : '<span class="cache-muted">' + esc(fallback || '—') + '</span>';
    }

    function entryTarget(entry) {
      var name = h.pick(entry, 'administration', lang) || labels.noAdministration;
      return entry.city ? name + ' · ' + entry.city : name;
    }

    function renderRow(entry) {
      return '<tr class="' + (entry.expired ? 'is-expired' : '') + '">' +
        '<td>' + administrationCell(entry) + '</td>' +
        '<td dir="auto">' + esc(entry.city || '—') + '</td>' +
        '<td class="num">' + esc(App.charts.fmt(entry.hits)) + '</td>' +
        '<td>' + dateCell(entry.createdAt) + '</td>' +
        '<td>' + dateCell(entry.expiresAt) +
          (entry.expired
            ? ' <span class="pill pill-xs pill-warning">' + esc(labels.cacheExpired) + '</span>'
            : '') +
        '</td>' +
        '<td>' + dateCell(entry.lastHitAt, labels.cacheNever) + '</td>' +
        '<td class="cache-actions">' +
          '<button type="button" class="btn-tiny btn-danger-quiet" data-action="delete" ' +
            'data-id="' + esc(entry.id) + '" ' +
            'aria-label="' + esc(labels.cacheDeleteAria(entryTarget(entry))) + '">' +
            icon('trash', 'icon-sm') + esc(labels.cacheDelete) + '</button>' +
        '</td>' +
        '</tr>';
    }

    function renderTable(entries) {
      if (!entries.length) {
        return '<div class="state-block">' +
          '<div class="state-title">' + esc(labels.cacheEmptyTitle) + '</div>' +
          '<div>' + esc(labels.cacheEmptyText) + '</div>' +
          '</div>';
      }
      return '<section class="card cache-card">' +
        '<div class="cache-table-wrap">' +
          '<table class="cache-table">' +
            '<thead><tr>' +
              '<th scope="col">' + esc(labels.cacheColAdministration) + '</th>' +
              '<th scope="col">' + esc(labels.cacheColCity) + '</th>' +
              '<th scope="col" class="num">' + esc(labels.cacheColHits) + '</th>' +
              '<th scope="col">' + esc(labels.cacheColCreated) + '</th>' +
              '<th scope="col">' + esc(labels.cacheColExpires) + '</th>' +
              '<th scope="col">' + esc(labels.cacheColLastHit) + '</th>' +
              '<th scope="col"><span class="sr-only">' +
                esc(labels.cacheColActions) + '</span></th>' +
            '</tr></thead>' +
            '<tbody>' + entries.map(renderRow).join('') + '</tbody>' +
          '</table>' +
        '</div>' +
        '</section>';
    }

    function render() {
      var stats = state.stats;
      subtitle.textContent = labels.cacheSubtitle(stats.entries, stats.ttlDays);
      actions.hidden = false;
      view.querySelector('[data-action="purge"]').disabled = !stats.expired;
      view.querySelector('[data-action="clear"]').disabled = !stats.entries;
      bodyNode.innerHTML = renderStats(stats) + renderTable(state.entries);
    }

    function renderError(error) {
      actions.hidden = true;
      if (error && error.status === 403) {
        state.forbidden = true;
        subtitle.textContent = labels.forbidden;
        bodyNode.innerHTML =
          '<div class="state-block error">' +
            '<div class="state-title">' + esc(labels.cacheForbiddenTitle) + '</div>' +
            '<div>' + esc(labels.forbidden) + '</div>' +
          '</div>';
        return;
      }
      subtitle.textContent = labels.cacheLoadFailed;
      bodyNode.innerHTML =
        '<div class="state-block error">' +
          '<div class="state-title">' + esc(labels.cacheLoadFailed) + '</div>' +
          '<div>' + esc(h.errorText(error, lang)) + '</div>' +
          '<div class="state-actions">' +
            '<button type="button" data-action="retry">' +
              icon('refresh') + esc(labels.retry) + '</button>' +
          '</div>' +
        '</div>';
    }

    /* --- Actions ------------------------------------------------------------ */

    function find(id) {
      return state.entries.filter(function (entry) { return entry.id === String(id); })[0] || null;
    }

    /* Une seule forme pour les trois suppressions : la confirmation dans la
       page, puis le nombre supprimé en toast et le rechargement. L'erreur est
       traduite avant d'atteindre la modale, qui l'affiche telle quelle. Un 401
       a déjà renvoyé vers la connexion (request()). */
    function confirmClear(options) {
      App.modals.confirm({
        title: options.title,
        intro: labels.cacheDeleteIntro,
        target: options.target,
        noteTitle: labels.cacheConfirmNote,
        consequences: [esc(options.consequence)],
        confirmLabel: options.confirmLabel || labels.cacheDelete,
        busyLabel: labels.cacheBusy,
        cancelLabel: labels.cancel,
        run: function () {
          return App.api.clearAgencyCache(options.filters).catch(function (error) {
            throw new Error(h.errorText(error, lang));
          });
        },
        onDeleted: function (deleted) {
          if (destroyed) return;
          h.toast(labels.cacheDeleted(deleted), 'success');
          load();
        }
      });
    }

    function deleteEntry(id) {
      var entry = find(id);
      if (!entry) return;
      confirmClear({
        title: labels.cacheDeleteTitle,
        target: entryTarget(entry),
        consequence: labels.cacheDeleteConsequence,
        // admin_id ET city : sans la ville, toutes les villes de cette
        // administration partiraient avec.
        filters: { adminId: entry.administrationId, city: entry.city }
      });
    }

    function purgeExpired() {
      if (!state.stats || !state.stats.expired) return;
      confirmClear({
        title: labels.cachePurgeTitle,
        target: labels.cachePurgeTarget(state.stats.expired),
        consequence: labels.cachePurgeConsequence,
        confirmLabel: labels.cachePurgeConfirm,
        filters: { expiredOnly: true }
      });
    }

    function clearAll() {
      if (!state.stats || !state.stats.entries) return;
      confirmClear({
        title: labels.cacheClearTitle,
        target: labels.cacheClearTarget(state.stats.entries),
        consequence: labels.cacheClearConsequence,
        confirmLabel: labels.cacheClearConfirm,
        filters: {}
      });
    }

    h.on(view, 'click', '[data-action]', function (event, target) {
      if (state.forbidden) return;
      var action = target.getAttribute('data-action');
      if (action === 'delete') deleteEntry(target.getAttribute('data-id'));
      else if (action === 'purge') purgeExpired();
      else if (action === 'clear') clearAll();
      else if (action === 'retry') load();
    });

    /* --- Chargement --------------------------------------------------------- */

    function load() {
      // Au premier chargement, le squelette est déjà là ; ensuite on garde
      // la liste affichée jusqu'à la réponse plutôt que de la faire clignoter.
      if (!state.loaded) bodyNode.innerHTML = renderSkeleton();

      return App.api.getAgencyCache().then(function (payload) {
        if (destroyed) return;
        state.stats = payload.stats;
        state.entries = payload.entries;
        state.loaded = true;
        render();
      }).catch(function (error) {
        if (destroyed) return;
        state.loaded = false;
        renderError(error);
      });
    }

    load();

    return {
      destroy: function () { destroyed = true; }
    };
  }

  App.screens = App.screens || {};
  App.screens.agencyCache = { mount: mount };
})(window);
