/* Écran 0 — Tableau de bord.

   Règles de lecture appliquées ici :
   — une série = une seule couleur (jamais une rampe sur des catégories) ;
   — la valeur est toujours lisible sans survol (étiquette directe, axe ou
     tableau) : l'infobulle enrichit, elle ne conditionne rien ;
   — chaque graphique a son jumeau tableau, bouton « Tableau » ;
   — les couleurs de statut ne portent jamais seules le sens : icône + libellé. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;
  var charts = App.charts;

  /* Statut : teintes validées (bande de clarté, chroma, contraste >= 3:1 sur
     fond blanc). « Extraction » est volontairement neutre — c'est un état
     transitoire, pas une sévérité. */
  var STATUS_VIEW = [
    { key: 'published',  label: 'Publié',      color: '#0ca30c', icon: 'check' },
    { key: 'review',     label: 'À vérifier',  color: '#c98500', icon: 'alert' },
    { key: 'extracting', label: 'Extraction',  color: '#7b838c', icon: 'clock' },
    { key: 'failed',     label: 'Échec',       color: '#d03b3b', icon: 'x' }
  ];

  /* --- Fragments réutilisables -------------------------------------------- */

  function statTile(spec) {
    return '<div class="stat-tile">' +
      '<div class="stat-label">' + esc(spec.label) + '</div>' +
      '<div class="stat-row">' +
        '<div class="stat-value">' +
          (spec.value === null || spec.value === undefined
            ? '<span class="stat-na" title="Nécessite l\'endpoint /admin/stats">—</span>'
            : charts.fmt(spec.value)) +
        '</div>' +
        (spec.spark || '') +
      '</div>' +
      (spec.hint ? '<div class="stat-hint">' + esc(spec.hint) + '</div>' : '') +
      '</div>';
  }

  /* Jumeau tableau : le graphique n'est jamais le seul accès à la donnée. */
  function dataTable(headers, rows) {
    return '<div class="chart-table" hidden>' +
      '<table><thead><tr>' +
        headers.map(function (label) { return '<th>' + esc(label) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
        rows.map(function (row) {
          return '<tr>' + row.map(function (cell, i) {
            return '<td' + (i ? ' class="num"' : ' dir="auto"') + '>' + esc(cell) + '</td>';
          }).join('') + '</tr>';
        }).join('') +
      '</tbody></table></div>';
  }

  function chartCard(id, title, subtitle, body, span) {
    return '<section class="card chart-card' + (span ? ' span-2' : '') + '">' +
      '<div class="chart-head">' +
        '<div>' +
          '<h2>' + esc(title) + '</h2>' +
          (subtitle ? '<p class="chart-sub">' + esc(subtitle) + '</p>' : '') +
        '</div>' +
        '<button type="button" class="btn-quiet btn-tiny" data-action="toggle-table" ' +
          'data-target="' + id + '" aria-pressed="false">' +
          icon('table', 'icon-sm') + 'Tableau</button>' +
      '</div>' + body +
      '</section>';
  }

  /* --- Écran --------------------------------------------------------------- */

  function mount(root) {
    var view = document.createElement('div');
    view.className = 'dashboard';
    root.appendChild(view);

    var destroyed = false;
    var today = new Date();
    var calendar = { year: today.getFullYear(), month: today.getMonth() };
    var stats = null;

    view.innerHTML =
      '<div class="screen-header">' +
        '<div>' +
          '<h1>Tableau de bord</h1>' +
          '<p class="subtitle">Vue d\'ensemble des extractions au ' +
            esc(h.formatDate(today)) + '</p>' +
        '</div>' +
        '<div class="header-actions">' +
          '<button type="button" data-action="upload-document">' +
            icon('upload') + 'Importer un document</button>' +
          '<button type="button" class="btn-primary" data-action="import-json">' +
            icon('braces') + 'Importer un JSON</button>' +
        '</div>' +
      '</div>' +
      '<div id="dash-body">' + renderSkeleton() + '</div>';

    var body = view.querySelector('#dash-body');

    function renderSkeleton() {
      var tile = '<div class="skeleton-card" style="height:88px"></div>';
      return '<div class="kpi-row">' + tile + tile + tile + tile + tile + '</div>' +
        '<div class="dash-grid">' +
          '<div class="skeleton-card span-2" style="height:240px"></div>' +
          '<div class="skeleton-card" style="height:240px"></div>' +
        '</div>';
    }

    /* --- Rendu ------------------------------------------------------------ */

    function render() {
      var totals = stats.totals || {};
      var weekly = stats.weekly || [];
      var byStatus = stats.byStatus || {};
      var administrations = stats.byAdministration;

      var docTotal = STATUS_VIEW.reduce(function (sum, s) {
        return sum + (byStatus[s.key] || 0);
      }, 0);

      /* -- Ligne d'indicateurs -- */
      var kpis =
        '<div class="kpi-row">' +
          statTile({
            label: 'Documents traités', value: totals.documents,
            spark: charts.sparkline(weekly.map(function (w) { return w.value; })),
            hint: '12 dernières semaines'
          }) +
          statTile({
            label: 'Administrations', value: totals.administrations,
            hint: totals.administrations === null ? 'Indisponible sans /admin/stats' : 'Citées au moins une fois'
          }) +
          statTile({ label: 'Procédures extraites', value: totals.procedures }) +
          statTile({
            label: 'Pièces requises', value: totals.pieces,
            hint: totals.pieces === null ? 'Indisponible sans /admin/stats' : 'Tous fichiers confondus'
          }) +
          statTile({
            label: 'Étapes décrites', value: totals.steps,
            hint: totals.steps === null ? 'Indisponible sans /admin/stats' : 'Tous fichiers confondus'
          }) +
        '</div>';

      /* -- Répartition par statut : liste + jauges, pas un camembert --
         Quatre segments dont deux confusables sous daltonisme si on les
         accolait ; en tuiles séparées chaque couleur est portée par une icône
         et un libellé, et la valeur est écrite. */
      var statusRows = STATUS_VIEW.map(function (spec) {
        var count = byStatus[spec.key] || 0;
        var ratio = docTotal ? count / docTotal : 0;
        return '<div class="status-row">' +
          '<span class="status-key">' +
            '<span class="status-dot" style="background:' + spec.color + '"></span>' +
            esc(spec.label) + '</span>' +
          '<span class="status-count">' + charts.fmt(count) + '</span>' +
          '<span class="status-pct">' + Math.round(ratio * 100) + ' %</span>' +
          charts.meter(ratio, spec.color) +
          '</div>';
      }).join('');

      var statusCard = chartCard('t-status', 'Documents par statut',
        h.plural(docTotal, 'document') + ' au total',
        '<div class="status-list">' + statusRows + '</div>' +
        dataTable(['Statut', 'Documents'], STATUS_VIEW.map(function (spec) {
          return [spec.label, String(byStatus[spec.key] || 0)];
        })));

      /* -- Activité hebdomadaire -- */
      var activityCard = chartCard('t-activity', 'Activité d\'extraction',
        'Documents importés par semaine',
        '<div id="chart-activity"></div>' +
        dataTable(['Semaine', 'Documents'], weekly.map(function (w) {
          return [w.full || w.label, String(w.value)];
        })), true);

      /* -- Par administration -- */
      var adminBody;
      if (administrations === null) {
        adminBody = '<div class="state-block" style="margin:0">' +
          '<div class="state-title">Répartition indisponible</div>' +
          '<div>Ce classement demande le contenu des extractions. Exposez ' +
          '<code>GET /admin/stats</code> côté FastAPI pour l\'activer.</div></div>';
      } else if (!administrations.length) {
        adminBody = '<div class="chart-empty">Aucune administration renseignée.</div>';
      } else {
        adminBody = '<div id="chart-admin"></div>' +
          dataTable(['Administration', 'Procédures'], administrations.map(function (a) {
            return [a.label, String(a.value)];
          }));
      }
      var adminCard = chartCard('t-admin', 'Procédures par administration',
        administrations && administrations.length ? 'Les 7 premières' : '', adminBody, true);

      /* -- Calendrier -- */
      var calendarCard =
        '<section class="card chart-card">' +
          '<div class="chart-head">' +
            '<div><h2>Calendrier d\'activité</h2>' +
            '<p class="chart-sub" id="cal-title">' +
              esc(charts.monthLabel(calendar.year, calendar.month)) + '</p></div>' +
            '<div class="cal-nav">' +
              '<button type="button" class="icon-btn" data-action="cal-prev" ' +
                'aria-label="Mois précédent">' + icon('chevron-right', 'icon-flip') + '</button>' +
              '<button type="button" class="icon-btn" data-action="cal-next" ' +
                'aria-label="Mois suivant">' + icon('chevron-right') + '</button>' +
            '</div>' +
          '</div>' +
          '<div id="chart-calendar"></div>' +
        '</section>';

      body.innerHTML = kpis +
        '<div class="dash-grid">' +
          activityCard + statusCard +
          adminCard + calendarCard +
        '</div>';

      /* -- Dessin des graphiques (après insertion : ils mesurent leur cadre) -- */
      if (weekly.length) {
        charts.area(body.querySelector('#chart-activity'), {
          points: weekly, unit: 'documents', height: 190,
          ariaLabel: 'Documents importés par semaine sur 12 semaines'
        });
      }
      if (administrations && administrations.length) {
        charts.barsH(body.querySelector('#chart-admin'), {
          data: administrations, unit: 'procédures',
          ariaLabel: 'Nombre de procédures par administration'
        });
      }
      drawCalendar();
    }

    function drawCalendar() {
      var node = body.querySelector('#chart-calendar');
      if (!node) return;
      charts.calendar(node, {
        year: calendar.year, month: calendar.month, counts: stats.daily || {}
      });
      var title = body.querySelector('#cal-title');
      if (title) title.textContent = charts.monthLabel(calendar.year, calendar.month);
    }

    /* --- Interactions ------------------------------------------------------ */

    h.on(view, 'click', '[data-action]', function (event, target) {
      var action = target.getAttribute('data-action');

      if (action === 'toggle-table') {
        // Le tableau est le frère suivant du conteneur de graphique.
        var card = target.closest('.chart-card');
        var table = card.querySelector('.chart-table');
        if (!table) return;
        table.hidden = !table.hidden;
        target.setAttribute('aria-pressed', String(!table.hidden));

      } else if (action === 'cal-prev' || action === 'cal-next') {
        var delta = action === 'cal-next' ? 1 : -1;
        var d = new Date(calendar.year, calendar.month + delta, 1);
        calendar.year = d.getFullYear();
        calendar.month = d.getMonth();
        drawCalendar();

      } else if (action === 'upload-document') {
        App.modals.uploadDocument({ onDone: load });

      } else if (action === 'import-json') {
        App.modals.importJson();

      } else if (action === 'retry') {
        load();
      }
    });

    /* --- Chargement --------------------------------------------------------- */

    function load() {
      return App.api.getStats().then(function (payload) {
        if (destroyed) return;
        stats = payload;
        render();
        // Pastille « à vérifier » dans la barre latérale.
        App.shell.setBadge('#/documents', (payload.byStatus || {}).review || 0);
      }).catch(function (error) {
        if (destroyed) return;
        body.innerHTML =
          '<div class="state-block error">' +
            '<div class="state-title">Statistiques indisponibles</div>' +
            '<div>' + esc(error.message) + '</div>' +
            '<div class="state-actions">' +
              '<button type="button" data-action="retry">' + icon('refresh') + 'Réessayer</button>' +
            '</div>' +
          '</div>';
      });
    }

    load();

    return {
      destroy: function () {
        destroyed = true;
        // Sans cela les ResizeObserver survivent au changement d'écran.
        App.charts.destroyAll(view);
      }
    };
  }

  App.screens = App.screens || {};
  App.screens.dashboard = { mount: mount };
})(window);
