/* Indexation des procédures (embeddings) : une procédure n'est recherchable
   par le chat qu'une fois son embedding calculé, en tâche de fond côté
   serveur. Ce module suit cet avancement pour deux endroits :
   — la carte « Indexation des procédures » du tableau de bord (mountCard) ;
   — le message qui suit une approbation (followApproval), qui reste affiché
     le temps que les nouvelles procédures soient indexées.

   Les compteurs viennent de la base : après un redémarrage du backend, le
   suivi reprend tout seul à la prochaine interrogation. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  var FAST_MS = 3000;     // pendant un lot, ou juste après une action
  var SLOW_MS = 30000;    // le reste du temps
  var BOOST_MS = 15000;   // durée du rythme rapide après une action
  var MESSAGE_MS = 6000;  // durée d'affichage des messages « déjà en cours »…

  /* --- Interrogation périodique --------------------------------------------

     Toutes les 3 s tant qu'un lot tourne ou juste après une action, toutes les
     30 s sinon. Rien ne part tant que l'onglet est masqué : on reprend
     immédiatement quand il redevient visible. Une erreur (backend en cours de
     redémarrage, par exemple) ne coupe pas la boucle : on garde le rythme
     courant et on réessaie. Seuls 401/403 l'arrêtent — la session n'est plus
     celle d'un administrateur. */
  function watch(onUpdate, onError) {
    var timer = null;
    var controller = null;
    var inFlight = false;
    var stopped = false;
    var last = null;
    var boostUntil = 0;

    function fast() {
      return (last && last.running) || Date.now() < boostUntil;
    }

    function schedule() {
      clearTimeout(timer);
      timer = null;
      if (stopped || document.hidden) return;
      timer = setTimeout(tick, fast() ? FAST_MS : SLOW_MS);
    }

    function tick() {
      clearTimeout(timer);
      timer = null;
      // Une réponse déjà attendue replanifiera d'elle-même.
      if (stopped || document.hidden || inFlight) return;
      inFlight = true;
      controller = typeof AbortController === 'function' ? new AbortController() : null;

      App.api.getIndexingStatus({ signal: controller && controller.signal })
        .then(function (status) {
          if (stopped) return;
          last = status;
          onUpdate(status);
        }, function (error) {
          if (stopped || (error && error.name === 'AbortError')) return;
          if (error && (error.status === 401 || error.status === 403)) stop();
          if (onError) onError(error);
        })
        .then(function () {
          inFlight = false;
          controller = null;
          schedule();
        });
    }

    function onVisibility() {
      if (document.hidden) {
        clearTimeout(timer);
        timer = null;
      } else {
        tick();
      }
    }

    function stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
      document.removeEventListener('visibilitychange', onVisibility);
      if (controller) controller.abort();
    }

    document.addEventListener('visibilitychange', onVisibility);
    tick();

    return {
      /* Après une action : rythme rapide pendant BOOST_MS. La prochaine
         lecture attend un intervalle plein, le temps que la tâche de fond
         démarre côté serveur. */
      boost: function () {
        boostUntil = Date.now() + BOOST_MS;
        if (!inFlight) schedule();
      },
      // Statut déjà connu sans le relire (réponse du POST).
      push: function (status) {
        last = status;
        onUpdate(status);
      },
      stop: stop
    };
  }

  /* --- Libellés ------------------------------------------------------------- */

  // Jamais « 100 % » tant qu'une procédure attend : l'arrondi mentirait.
  function percentOf(status) {
    if (!status.pending) return 100;
    return Math.max(0, Math.min(99, Math.floor(status.percent)));
  }

  function countLabel(status) {
    return status.embedded + ' / ' + h.plural(status.total, 'procédure') +
      (status.total >= 2 ? ' indexées' : ' indexée') +
      ' (' + percentOf(status) + ' %)';
  }

  // Vide quand la durée est inconnue (eta_seconds null).
  function etaLabel(seconds) {
    if (seconds === null || seconds === undefined) return '';
    if (seconds < 45) return 'moins d\'une minute restante';
    var minutes = Math.round(seconds / 60);
    return 'environ ' + minutes + ' min restante' + (minutes >= 2 ? 's' : '');
  }

  function runningLabel(status) {
    var eta = etaLabel(status.etaSeconds);
    return 'Indexation en cours…' + (eta ? ' ' + eta : '');
  }

  function batchLabel(status) {
    return status.run.total
      ? status.run.done + ' / ' + status.run.total + ' traitées dans ce lot'
      : '';
  }

  function pendingLabel(status) {
    return h.plural(status.pending, 'procédure') +
      (status.pending >= 2 ? ' ne sont pas encore recherchables' : ' n\'est pas encore recherchable') +
      ' par le chat';
  }

  function failureLabel(run) {
    if (run.failed) {
      return h.plural(run.failed, 'procédure') +
        (run.failed >= 2 ? ' n\'ont pas pu être indexées' : ' n\'a pas pu être indexée') +
        ' lors du dernier lot.';
    }
    return run.lastError ? 'Le dernier lot d\'indexation s\'est interrompu.' : '';
  }

  /* --- Fragments ------------------------------------------------------------ */

  /* La barre est réécrite à chaque lecture : on repart de l'ancienne largeur
     pour que la transition CSS montre la progression au lieu d'un saut. */
  function barMarkup(status, extraClass) {
    var pct = percentOf(status);
    return '<div class="track-track ' + (extraClass || '') + '" role="progressbar" ' +
        'aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" ' +
        'aria-label="Procédures indexées">' +
        '<span class="track-bar' + (status.pending ? '' : ' is-complete') + '" ' +
          'data-width="' + pct + '"></span>' +
      '</div>';
  }

  function setMarkup(node, markup) {
    var previous = node.querySelector('.track-bar');
    var from = previous ? previous.style.width : '';
    node.innerHTML = markup;
    var bar = node.querySelector('.track-bar');
    if (!bar) return;
    var to = bar.getAttribute('data-width') + '%';
    if (from && from !== to) {
      bar.style.width = from;
      void bar.offsetWidth;   // force le calcul avant la nouvelle largeur
    }
    bar.style.width = to;
  }

  function failureNote(run) {
    var text = failureLabel(run);
    if (!text) return '';
    return '<div class="info-note is-warning index-note">' + icon('alert') +
      '<div><div>' + esc(text) + '</div>' +
      (run.lastError ? '<div class="index-error-detail">' + esc(run.lastError) + '</div>' : '') +
      '</div></div>';
  }

  /* --- Carte du tableau de bord ------------------------------------------- */

  function mountCard(node) {
    var status = null;
    var error = null;
    var busy = false;        // POST /admin/indexing/run en cours
    var message = null;      // { type: 'info' | 'error', text }
    var messageTimer = null;

    function header() {
      var showButton = status && (status.pending > 0 || status.running);
      var disabled = busy || (status && status.running);
      return '<div class="chart-head">' +
        '<div><h2>Indexation des procédures</h2>' +
          '<p class="chart-sub">Seules les procédures indexées sont trouvées par le chat</p></div>' +
        (showButton
          ? '<button type="button" class="btn-primary btn-tiny" data-action="run-indexing"' +
              (disabled ? ' disabled' : '') + '>' + icon('sparkles', 'icon-sm') +
              (busy ? 'Lancement…' : 'Lancer l\'indexation') + '</button>'
          : '') +
        '</div>';
    }

    function bodyMarkup() {
      if (!status) {
        return error
          ? '<div class="info-note is-danger">' + icon('alert') +
              '<span>Avancement indisponible (' + esc(error.message.replace(/\.$/, '')) +
              '). Nouvelle tentative automatique.</span></div>'
          : '<div class="skeleton-line" style="width:60%"></div>';
      }

      var parts = [];
      if (!status.total) {
        parts.push('<div class="index-count">Aucune procédure active pour l\'instant.</div>');
      } else {
        parts.push(barMarkup(status, 'index-track'));
        parts.push('<div class="index-count">' + esc(countLabel(status)) + '</div>');
      }

      if (status.running) {
        var batch = batchLabel(status);
        parts.push('<div class="index-running">' +
          '<span class="index-spinner" aria-hidden="true"></span>' +
          '<span>' + esc(runningLabel(status)) + '</span>' +
          (batch ? '<span class="index-batch">' + esc(batch) + '</span>' : '') +
          '</div>');
      } else if (status.pending > 0) {
        parts.push('<div class="info-note is-warning index-note">' + icon('alert') +
          '<span>' + esc(pendingLabel(status)) + '</span></div>');
      } else if (status.total) {
        parts.push('<div class="info-note is-success index-note">' + icon('check') +
          '<span>Toutes les procédures sont indexées</span></div>');
      }

      parts.push(failureNote(status.run));

      if (message) {
        parts.push('<div class="info-note index-note' +
          (message.type === 'error' ? ' is-danger' : '') + '" role="status">' +
          icon(message.type === 'error' ? 'alert' : 'info') +
          '<span>' + esc(message.text) + '</span></div>');
      }
      if (error) {
        parts.push('<div class="index-stale">Mise à jour impossible pour le moment, ' +
          'nouvelle tentative automatique.</div>');
      }
      return parts.join('');
    }

    function render() {
      setMarkup(node, '<section class="card index-card">' + header() + bodyMarkup() + '</section>');
    }

    function showMessage(type, text) {
      clearTimeout(messageTimer);
      message = { type: type, text: text };
      messageTimer = setTimeout(function () {
        message = null;
        render();
      }, MESSAGE_MS);
    }

    var watcher = watch(function (next) {
      status = next;
      error = null;
      render();
    }, function (next) {
      error = next;
      render();
    });

    function start() {
      if (busy || (status && status.running)) return;
      busy = true;
      message = null;
      render();

      App.api.runIndexing().then(function (result) {
        if (result.started) {
          /* Le statut renvoyé est celui d'avant le lancement : on affiche le
             lot comme démarré, la prochaine lecture donnera les vrais chiffres. */
          result.running = true;
          result.etaSeconds = null;
          result.run = { startedAt: null, finishedAt: null, done: 0,
            total: result.pending, failed: 0, lastError: null };
        } else if (result.reason === 'already_running') {
          showMessage('info', 'Une indexation est déjà en cours.');
        } else if (result.reason === 'nothing_to_index') {
          showMessage('info', 'Rien à indexer : toutes les procédures le sont déjà.');
        }
        busy = false;
        watcher.push(result);
      }).catch(function (failure) {
        busy = false;
        showMessage('error', failure.message);
        render();
      }).then(function () {
        watcher.boost();
      });
    }

    h.on(node, 'click', '[data-action="run-indexing"]', start);
    render();

    return {
      destroy: function () {
        watcher.stop();
        clearTimeout(messageTimer);
      }
    };
  }

  /* --- Suivi après une approbation ------------------------------------------

     Le message de réussite reste affiché avec une petite barre d'avancement
     jusqu'à la fin du lot, puis se retire seul. Il vit dans #toast-root : il
     survit au retour vers la liste des documents qui suit l'approbation. */
  var START_GRACE_MS = 10000;   // délai laissé au lot pour démarrer côté serveur
  var activeFollow = null;

  function followApproval(message) {
    if (activeFollow) activeFollow.close();

    var root = document.getElementById('toast-root');
    var node = h.fromHTML(
      '<div class="toast toast-success toast-index" role="status">' +
        icon('check') +
        '<div class="toast-index-body">' +
          '<div>' + esc(message) + '</div>' +
          '<div class="toast-index-progress">' +
            '<div class="toast-index-label">Indexation pour la recherche : démarrage…</div>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="toast-close" aria-label="Fermer">' + icon('x', 'icon-sm') + '</button>' +
      '</div>'
    );
    root.appendChild(node);
    var progress = node.querySelector('.toast-index-progress');

    var startedAt = Date.now();
    var seenRunning = false;
    var closeTimer = null;
    var closed = false;

    function close() {
      if (closed) return;
      closed = true;
      watcher.stop();
      unsubscribe();
      clearTimeout(closeTimer);
      if (node.parentNode) node.parentNode.removeChild(node);
      if (activeFollow === handle) activeFollow = null;
    }

    function label(text) {
      return '<div class="toast-index-label">' + esc(text) + '</div>';
    }

    function update(status) {
      if (status.running) seenRunning = true;
      var finished = !status.running &&
        (seenRunning || !status.pending || Date.now() - startedAt > START_GRACE_MS);

      var markup = status.total ? barMarkup(status, 'toast-index-track') : '';
      if (status.running) {
        var batch = batchLabel(status);
        markup += label(countLabel(status) + ' — ' + runningLabel(status)) +
          (batch ? label(batch) : '');
      } else if (!finished) {
        markup += label('Indexation pour la recherche : démarrage…');
      } else if (!status.pending) {
        markup += label('Toutes les procédures sont indexées : elles sont recherchables par le chat.');
      } else {
        markup += label(countLabel(status) + '. ' + pendingLabel(status) +
          ' : relancez l\'indexation depuis le tableau de bord.');
      }
      if (finished && failureLabel(status.run)) markup += label(failureLabel(status.run));
      setMarkup(progress, markup);

      if (finished) {
        watcher.stop();
        closeTimer = setTimeout(close, status.pending ? 12000 : 5000);
      }
    }

    // Déconnexion : le suivi n'a plus lieu d'être (et lirait des 401).
    var unsubscribe = App.auth.onChange(function () {
      if (!App.auth.isAuthenticated()) close();
    });

    var watcher = watch(update, function (error) {
      if (error && (error.status === 401 || error.status === 403)) return close();
      var stale = progress.querySelector('.toast-index-stale');
      if (!stale) {
        progress.appendChild(h.fromHTML(
          '<div class="toast-index-label toast-index-stale">Avancement momentanément indisponible…</div>'));
      }
    });
    watcher.boost();

    node.querySelector('.toast-close').addEventListener('click', close);

    var handle = { close: close };
    activeFollow = handle;
    return handle;
  }

  App.indexing = {
    watch: watch,
    mountCard: mountCard,
    followApproval: followApproval
  };
})(window);
