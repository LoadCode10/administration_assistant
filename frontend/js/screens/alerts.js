/* Écran 9 — Alertes (#/alerts).

   Chaque citoyen a une limite quotidienne de jetons ; le serveur crée une
   alerte quand il franchit un seuil (80 % puis 100 %) et l'envoie par email.
   Cet écran montre les trois choses qu'un administrateur vient y chercher :
   la configuration (limite, seuils, email), qui consomme le plus aujourd'hui,
   et l'historique des alertes — avec la possibilité de renvoyer celles qui
   ne sont pas parties.

   Les deux appels (GET /admin/quota et GET /admin/alerts) sont indépendants :
   chaque bloc a son propre chargement et sa propre erreur, la panne de l'un
   ne masque pas l'autre. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;
  var fmt = function (value) { return App.charts.fmt(value); };

  var WARN = 80;

  var STATUS = {
    sent: { label: 'Envoyée', pill: 'pill-success' },
    failed: { label: 'Échec', pill: 'pill-danger' },
    skipped: { label: 'Ignorée', pill: 'pill-neutral' },
    pending: { label: 'En attente', pill: 'pill-accent' }
  };

  function pct(value) {
    return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';
  }

  function tone(percent) {
    return percent >= 100 ? 'is-over' : (percent >= WARN ? 'is-warn' : 'is-ok');
  }

  /* « 2026-11-01T14:02:11 » -> « 01/11/2026 14:02 ». Lu tel quel plutôt que
     via new Date() : la date est déjà à l'heure du serveur, la repasser par le
     fuseau du navigateur la décalerait. */
  function formatDateTime(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(value || ''));
    if (!match) return '';
    return match[3] + '/' + match[2] + '/' + match[1] +
      (match[4] ? ' ' + match[4] + ':' + match[5] : '');
  }

  function formatDay(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    return match ? match[3] + '/' + match[2] + '/' + match[1] : '';
  }

  function mount(root) {
    var view = document.createElement('div');
    root.appendChild(view);

    var state = {
      quota: null,
      quotaError: null,
      alerts: [],
      alertsLoaded: false,
      alertsError: null,
      resending: {},     // id -> true tant que le renvoi est en vol
      testing: false
    };

    var destroyed = false;

    view.innerHTML =
      '<div class="screen-header">' +
        '<div>' +
          '<h1>Alertes</h1>' +
          '<p class="subtitle" id="alerts-subtitle">Chargement…</p>' +
        '</div>' +
        '<div class="header-actions">' +
          '<button type="button" data-action="refresh">' +
            icon('refresh') + 'Rafraîchir</button>' +
        '</div>' +
      '</div>' +
      '<div id="alerts-summary"></div>' +
      '<div id="alerts-users"></div>' +
      '<div id="alerts-history"></div>';

    var subtitle = view.querySelector('#alerts-subtitle');
    var summaryNode = view.querySelector('#alerts-summary');
    var usersNode = view.querySelector('#alerts-users');
    var historyNode = view.querySelector('#alerts-history');

    /* --- Rendu -------------------------------------------------------------- */

    function inlineError(error) {
      return '<div class="inline-error" role="alert">' + icon('alert') +
        '<span>' + esc(h.errorText(error, 'fr')) + '</span></div>';
    }

    function section(title, sub, body) {
      return '<section class="card alerts-card">' +
        '<div class="chart-head">' +
          '<div>' +
            '<h2>' + esc(title) + '</h2>' +
            (sub ? '<p class="chart-sub">' + esc(sub) + '</p>' : '') +
          '</div>' +
        '</div>' + body +
        '</section>';
    }

    function emptyRow(text) {
      return '<div class="alerts-empty">' + esc(text) + '</div>';
    }

    function renderSummary() {
      if (state.quotaError) {
        summaryNode.innerHTML = inlineError(state.quotaError);
        return;
      }
      var quota = state.quota;
      if (!quota) {
        var tile = '<div class="skeleton-card" style="height:88px"></div>';
        summaryNode.innerHTML = '<div class="kpi-row alerts-kpi">' + tile + tile + tile + '</div>';
        return;
      }

      var thresholds = quota.thresholds.length
        ? quota.thresholds.map(function (value) { return value + ' %'; }).join(' · ')
        : '—';

      summaryNode.innerHTML = '<div class="kpi-row alerts-kpi">' +
        '<div class="stat-tile">' +
          '<div class="stat-label">Limite par utilisateur</div>' +
          '<div class="stat-row"><div class="stat-value">' +
            esc(quota.userLimit === null ? '—' : fmt(quota.userLimit)) + '</div></div>' +
          '<div class="stat-hint">jetons / jour</div>' +
        '</div>' +
        '<div class="stat-tile">' +
          '<div class="stat-label">Seuils d\'alerte</div>' +
          '<div class="stat-row"><div class="stat-value">' + esc(thresholds) + '</div></div>' +
        '</div>' +
        '<div class="stat-tile">' +
          '<div class="stat-label">Email</div>' +
          '<div class="alerts-email">' +
            (quota.emailConfigured
              ? '<span class="pill pill-success">Configuré</span>'
              : '<span class="pill pill-danger">Non configuré</span>') +
            '<button type="button" class="btn-tiny" data-action="test-email"' +
              (state.testing ? ' disabled' : '') + '>' +
              (state.testing ? 'Envoi…' : 'Tester l\'email') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    function meter(percent) {
      return '<div class="alerts-meter ' + tone(percent) + '">' +
        '<div class="quota-track"><span class="quota-bar" style="width:' +
          Math.min(percent, 100) + '%"></span></div>' +
        '<span class="alerts-meter-value">' + esc(pct(percent)) + '</span>' +
      '</div>';
    }

    function renderUsers() {
      var title = 'Utilisateurs les plus actifs aujourd\'hui';
      if (state.quotaError) {
        usersNode.innerHTML = '';
        return;
      }
      var quota = state.quota;
      if (!quota) {
        usersNode.innerHTML = '<div class="skeleton-card" style="height:160px"></div>';
        return;
      }
      if (!quota.topUsers.length) {
        usersNode.innerHTML = section(title, '', emptyRow('Aucune consommation aujourd\'hui.'));
        return;
      }

      var limit = quota.userLimit === null ? '—' : fmt(quota.userLimit);
      var rows = quota.topUsers.map(function (user) {
        return '<tr>' +
          '<td dir="auto">' + esc(user.name || '—') + '</td>' +
          '<td class="num">' + esc(fmt(user.used) + ' / ' + limit) + '</td>' +
          '<td>' + meter(user.percent) + '</td>' +
          '<td>' + (user.blocked
            ? '<span class="pill pill-danger">Bloqué</span>'
            : '<span class="pill pill-neutral">Actif</span>') + '</td>' +
        '</tr>';
      }).join('');

      usersNode.innerHTML = section(title, '',
        '<div class="cache-table-wrap"><table class="cache-table">' +
          '<thead><tr>' +
            '<th scope="col">Utilisateur</th>' +
            '<th scope="col" class="num">Consommation</th>' +
            '<th scope="col">Utilisation</th>' +
            '<th scope="col">Statut</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>');
    }

    function renderAlertRow(alert) {
      var status = STATUS[alert.status] || STATUS.pending;
      var canResend = alert.status === 'failed' || alert.status === 'pending';
      var busy = state.resending[alert.id] === true;
      return '<tr>' +
        '<td><span class="cache-date">' + esc(formatDateTime(alert.createdAt) || '—') + '</span></td>' +
        '<td dir="auto">' + esc(alert.user || '—') + '</td>' +
        '<td class="num">' + esc(alert.threshold === null ? '—' : alert.threshold + ' %') + '</td>' +
        '<td class="num">' + esc(fmt(alert.used) + ' / ' +
          (alert.limit === null ? '—' : fmt(alert.limit))) + '</td>' +
        '<td><span class="pill ' + status.pill + '">' + esc(status.label) + '</span></td>' +
        '<td class="alerts-mail">' + (alert.sentEmail
          ? '<span class="alerts-yes" aria-label="Email envoyé">✓</span>'
          : '<span class="alerts-no" aria-label="Email non envoyé">✗</span>') + '</td>' +
        '<td class="alerts-error">' + (alert.error
          ? '<span title="' + esc(alert.error) + '">' + esc(h.truncate(alert.error, 48)) + '</span>'
          : '<span class="cache-muted">—</span>') + '</td>' +
        '<td class="cache-actions">' + (canResend
          ? '<button type="button" class="btn-tiny" data-resend="' + esc(alert.id) + '"' +
              (busy ? ' disabled' : '') + '>' +
              (busy ? 'Envoi…' : icon('send', 'icon-sm') + 'Renvoyer') + '</button>'
          : '') + '</td>' +
      '</tr>';
    }

    function renderHistory() {
      var title = 'Historique des alertes';
      if (state.alertsError) {
        historyNode.innerHTML = section(title, '', inlineError(state.alertsError));
        return;
      }
      if (!state.alertsLoaded) {
        historyNode.innerHTML = '<div class="skeleton-card" style="height:200px"></div>';
        return;
      }
      if (!state.alerts.length) {
        historyNode.innerHTML = section(title, '', emptyRow('Aucune alerte pour le moment.'));
        return;
      }
      historyNode.innerHTML = section(title,
        h.plural(state.alerts.length, 'alerte', 'alertes') + ' · les plus récentes en tête',
        '<div class="cache-table-wrap"><table class="cache-table">' +
          '<thead><tr>' +
            '<th scope="col">Date</th>' +
            '<th scope="col">Utilisateur</th>' +
            '<th scope="col" class="num">Seuil</th>' +
            '<th scope="col" class="num">Consommation</th>' +
            '<th scope="col">Statut</th>' +
            '<th scope="col">Email</th>' +
            '<th scope="col">Erreur</th>' +
            '<th scope="col"><span class="sr-only">Actions</span></th>' +
          '</tr></thead>' +
          '<tbody>' + state.alerts.map(renderAlertRow).join('') + '</tbody>' +
        '</table></div>');
    }

    function renderSubtitle() {
      var day = state.quota && formatDay(state.quota.day);
      subtitle.textContent = day
        ? 'Consommation du ' + day + ' · limite quotidienne et alertes email'
        : 'Limite quotidienne et alertes email';
    }

    /* --- Chargement --------------------------------------------------------- */

    function loadQuota() {
      return App.api.getAdminQuota().then(function (quota) {
        if (destroyed) return;
        state.quota = quota;
        state.quotaError = null;
      }, function (error) {
        if (destroyed) return;
        state.quota = null;
        state.quotaError = error;
      }).then(function () {
        if (destroyed) return;
        renderSubtitle();
        renderSummary();
        renderUsers();
      });
    }

    function loadAlerts() {
      return App.api.listAlerts(100).then(function (list) {
        if (destroyed) return;
        state.alerts = list;
        state.alertsLoaded = true;
        state.alertsError = null;
      }, function (error) {
        if (destroyed) return;
        state.alertsError = error;
      }).then(function () {
        if (!destroyed) renderHistory();
      });
    }

    // Les données affichées restent en place pendant le rafraîchissement :
    // seul le bouton dit que l'appel est en cours.
    function loadAll() {
      var button = view.querySelector('[data-action="refresh"]');
      button.disabled = true;
      Promise.all([loadQuota(), loadAlerts()]).then(function () {
        if (!destroyed) button.disabled = false;
      });
    }

    /* --- Actions ------------------------------------------------------------ */

    function testEmail() {
      if (state.testing) return;
      state.testing = true;
      renderSummary();
      App.api.testAlertEmail().then(function (message) {
        if (destroyed) return;
        h.toast('Email de test : ' + (message || 'réponse vide'),
          message === 'envoyé' ? 'success' : 'error');
      }, function (error) {
        if (destroyed) return;
        h.toast(h.errorText(error, 'fr'), 'error');
      }).then(function () {
        if (destroyed) return;
        state.testing = false;
        renderSummary();
      });
    }

    function resend(id) {
      if (!id || state.resending[id]) return;
      state.resending[id] = true;
      renderHistory();
      App.api.resendAlert(id).then(function (result) {
        if (destroyed) return;
        if (result.status === 'sent') h.toast('Alerte renvoyée.', 'success');
        else h.toast('Renvoi échoué' + (result.error ? ' : ' + result.error : '.'), 'error');
      }, function (error) {
        if (destroyed) return;
        h.toast(h.errorText(error, 'fr'), 'error');
      }).then(function () {
        if (destroyed) return;
        delete state.resending[id];
        loadAlerts();
      });
    }

    h.on(view, 'click', '[data-action]', function (event, target) {
      var action = target.getAttribute('data-action');
      if (action === 'refresh') loadAll();
      else if (action === 'test-email') testEmail();
    });

    h.on(view, 'click', '[data-resend]', function (event, target) {
      resend(target.getAttribute('data-resend'));
    });

    renderSummary();
    renderUsers();
    renderHistory();
    loadAll();

    return {
      destroy: function () { destroyed = true; }
    };
  }

  App.screens = App.screens || {};
  App.screens.alerts = { mount: mount };
})(window);
