/* Écran citoyen 1 — Assistant (#/chat).

   Deux colonnes : la barre latérale et la conversation. L'historique des
   discussions vit dans la barre latérale, sous l'entrée « Assistant » — on y
   revient sans arrêt, une question posée hier est la réponse à celle
   d'aujourd'hui, elle doit rester sous les yeux sans manger la largeur du fil.

   Ce fil est rendu par la coque mais il appartient à cet écran : c'est lui qui
   charge la liste, ouvre une discussion, en commence une neuve. Il pousse ses
   données par App.shell.setConversations() et reçoit les clics par les
   fonctions posées avec App.shell.setConversationHandlers(). La coque ne parle
   jamais au serveur.

   Une discussion n'existe côté serveur qu'à partir de sa première question :
   « Nouvelle discussion » ne crée rien, elle remet simplement l'écran à zéro.
   C'est l'envoi qui crée, et c'est le serveur qui donne l'identifiant.

   Le contenu peut être arabe, français ou anglais — parfois d'une bulle à
   l'autre dans la même discussion. Chaque bulle porte donc dir="auto" : le
   sens de lecture se décide par message, pas par écran. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;
  var icon = h.icon;

  function mount(root) {
    // L'écran occupe toute la hauteur et n'a pas la gouttière habituelle :
    // la conversation est ancrée en bas et défile seule.
    root.classList.add('is-flush');

    var view = document.createElement('div');
    view.className = 'chat-screen';
    root.appendChild(view);

    var state = {
      conversations: [],      // résumés { id, title, updatedAt }
      conversationId: null,   // null = discussion pas encore créée
      messages: [],
      loadingThread: false,
      pending: false,         // une question est partie, on attend la réponse
      error: '',
      // Identifiants des procédures déjà suivies : décide du libellé du bouton
      // sous chaque source.
      trackedIds: {},
      // Limite quotidienne atteinte (429, ou jauge à 100 %) : le champ et le
      // bouton restent désactivés jusqu'au lendemain.
      blocked: false,
      // Dernière réponse de GET /citizen/quota ; null tant qu'elle n'est pas là.
      quota: null
    };

    var destroyed = false;

    view.innerHTML =
      '<div class="chat-stream" id="chat-stream" aria-live="polite"></div>' +
      '<div class="chat-composer">' +
        '<div id="chat-error"></div>' +
        '<div class="composer-box">' +
          '<textarea id="chat-input" dir="auto" rows="1" ' +
            'placeholder="Posez votre question…" ' +
            'aria-label="Votre question"></textarea>' +
          '<button type="button" class="btn-primary composer-send" data-action="send" ' +
            'aria-label="Envoyer">' + icon('send') + '</button>' +
        '</div>' +
        '<p class="composer-blocked" id="chat-blocked" hidden>' + icon('alert', 'icon-sm') +
          '<span>Limite quotidienne atteinte — réessayez demain.</span></p>' +
        '<div class="quota-meter" id="chat-quota" hidden></div>' +
        '<p class="composer-hint">Entrée pour envoyer, Maj + Entrée pour aller à la ligne.</p>' +
      '</div>';

    var streamNode = view.querySelector('#chat-stream');
    var errorNode = view.querySelector('#chat-error');
    var input = view.querySelector('#chat-input');
    var sendButton = view.querySelector('[data-action="send"]');
    var blockedNode = view.querySelector('#chat-blocked');
    var quotaNode = view.querySelector('#chat-quota');

    /* --- Fil des discussions (rendu par la coque) --------------------------- */

    /* Le seul point de passage vers la barre latérale : on lui donne la liste
       et la discussion ouverte, elle dessine. Appelé après chaque chargement et
       à chaque changement de discussion, pour que le soulignement suive. */
    function pushConversations() {
      App.shell.setConversations(state.conversations, state.conversationId);
    }

    /* --- Fil de la conversation --------------------------------------------- */

    /* Sous une réponse : les procédures qu'elle a utilisées. C'est le seul
       endroit d'où l'on peut lancer un suivi — d'où le bouton par source,
       plutôt qu'un lien vers un catalogue à re-chercher. */
    /* Le bloc entier prend la langue de la réponse : titres et administrations
       via h.pick (repli sur l'autre langue si la moitié est vide), libellés
       via h.labelsFor, et dir sur le bloc pour que l'icône, le texte et le
       bouton se retournent ensemble. Chaque texte garde son dir="auto" : un
       titre français de repli dans un bloc arabe reste lisible. */
    function renderSources(message) {
      if (!message.sources.length) return '';

      var lang = h.contentLang(message.lang);
      var labels = h.labelsFor(lang);

      return '<div class="msg-sources" lang="' + lang + '" dir="' + h.langDir(lang) + '">' +
        '<div class="msg-sources-title">' + icon('file-text', 'icon-sm') +
          esc(labels.sourcesCount(message.sources.length)) +
        '</div>' +
        message.sources.map(function (source) {
          var isTracked = source.procedureId !== null &&
            state.trackedIds[String(source.procedureId)] === true;
          var title = h.pick(source, 'title', lang) || source.title || labels.untitled;
          var administration = h.pick(source, 'administration', lang) || source.administration;
          return '<div class="source-row">' +
            '<div class="source-main">' +
              '<div class="source-title" dir="auto">' + esc(title) + '</div>' +
              (administration
                ? '<div class="source-admin">' + icon('building', 'icon-sm') +
                  '<span dir="auto">' + esc(administration) + '</span></div>'
                : '<div class="source-admin is-empty">' + esc(labels.noAdministration) + '</div>') +
            '</div>' +
            '<button type="button" class="btn-tiny source-track' +
              (isTracked ? ' is-tracked' : '') + '" ' +
              'data-track="' + esc(source.procedureId === null ? '' : source.procedureId) + '"' +
              (isTracked || source.procedureId === null ? ' disabled' : '') + '>' +
              (isTracked
                ? icon('check', 'icon-sm') + esc(labels.tracked)
                : esc(labels.track)) +
            '</button>' +
          '</div>';
        }).join('') +
        '</div>';
    }

    /* Les réponses arrivent en Markdown : gras, titres, listes, filets. La
       conversion et le lavage DOMPurify vivent dans h.markdownToHtml — le même
       chemin sert aux bureaux à proximité, écran « Mes procédures ».

       Seules les réponses de l'assistant y passent : le texte de l'utilisateur
       reste échappé, il n'est jamais interprété comme du HTML. Et si l'une des
       deux bibliothèques manque (CDN injoignable), h.markdownToHtml renvoie
       null : on retombe alors sur le texte échappé. */

    /* Refus du serveur (429, limite quotidienne) : ce n'est ni une réponse ni
       une panne. Bulle ambre côté assistant, sous la question restée visible ;
       elle n'existe que dans la page, le serveur n'a rien enregistré. */
    function renderNotice(message) {
      return '<div class="msg is-assistant">' +
        '<div class="msg-bubble is-quota" role="alert">' + icon('alert') +
          '<span>' + esc(message.content) + '</span></div>' +
        '</div>';
    }

    function renderMessage(message) {
      if (message.role === 'notice') return renderNotice(message);
      var side = message.role === 'user' ? 'is-user' : 'is-assistant';
      var html = message.role === 'assistant'
        ? h.markdownToHtml(message.content) : null;
      // Une réponse dont le serveur a donné la langue prend le sens de cette
      // langue, comme ses sources ; le reste (questions, anciens messages)
      // garde dir="auto".
      var dir = message.role === 'assistant' && message.lang
        ? h.langDir(message.lang) : 'auto';
      // is-markdown : la bulle passe du texte préformaté au flux HTML, c'est
      // le CSS qui reprend l'espacement à partir de là.
      var bubble = html === null
        ? '<div class="msg-bubble" dir="' + dir + '">' + esc(message.content) + '</div>'
        : '<div class="msg-bubble is-markdown" dir="' + dir + '">' + html + '</div>';

      return '<div class="msg ' + side + '">' +
        bubble +
        (message.role === 'assistant' ? renderSources(message) : '') +
        '</div>';
    }

    /* La réponse met plusieurs secondes : sans repère visible, on ne sait pas
       si la question est partie. Trois points animés, dans une bulle à la
       place qu'occupera la réponse. */
    function renderThinking() {
      return '<div class="msg is-assistant">' +
        '<div class="msg-bubble is-thinking" role="status">' +
          '<span class="sr-only">Réponse en cours de rédaction…</span>' +
          '<i></i><i></i><i></i>' +
        '</div></div>';
    }

    function renderEmpty() {
      return '<div class="chat-empty">' +
        icon('sparkles', 'icon-lg') +
        '<div class="chat-empty-title">Comment puis-je vous aider ?</div>' +
        '<p>Décrivez votre démarche — en français, en arabe ou en anglais. ' +
          'Les procédures citées en réponse peuvent être suivies pour cocher ' +
          'les pièces au fur et à mesure.</p>' +
        '</div>';
    }

    function renderStream(keepScroll) {
      if (state.loadingThread) {
        streamNode.innerHTML =
          '<div class="skeleton-card" style="height:60px"></div>' +
          '<div class="skeleton-card" style="height:90px"></div>';
        return;
      }

      if (!state.messages.length && !state.pending) {
        streamNode.innerHTML = renderEmpty();
        return;
      }

      streamNode.innerHTML =
        '<div class="chat-thread">' +
          state.messages.map(renderMessage).join('') +
          (state.pending ? renderThinking() : '') +
        '</div>';

      if (!keepScroll) streamNode.scrollTop = streamNode.scrollHeight;
    }

    /* --- Limite quotidienne -------------------------------------------------- */

    var QUOTA_WARN = 80;

    function formatPercent(value) {
      return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    }

    // Un seul endroit décide de l'état du champ : attente d'une réponse,
    // limite atteinte, ou libre.
    function syncComposer() {
      sendButton.disabled = state.pending || state.blocked;
      input.disabled = state.blocked;
      blockedNode.hidden = !state.blocked;
    }

    /* Jauge sous le champ. Masquée pour un compte exempté (administrateur) et
       tant que rien n'est chargé : une jauge vide se lirait « 0 % utilisé ». */
    function renderQuota() {
      var quota = state.quota;
      if (!quota || quota.exempt || quota.limit === null) {
        quotaNode.hidden = true;
        quotaNode.innerHTML = '';
        return;
      }

      var percent = quota.percent !== null ? quota.percent
        : (quota.limit ? 100 * quota.used / quota.limit : 0);
      var tone = percent >= 100 ? 'is-over' : (percent >= QUOTA_WARN ? 'is-warn' : 'is-ok');
      var detail = App.charts.fmt(quota.used) + ' / ' + App.charts.fmt(quota.limit) + ' jetons';

      quotaNode.hidden = false;
      quotaNode.className = 'quota-meter ' + tone;
      quotaNode.innerHTML =
        '<div class="quota-meter-row" title="' + esc(detail) + '">' +
          '<span class="quota-meter-label">Utilisation du jour : ' +
            esc(formatPercent(percent)) + ' %</span>' +
          '<span class="quota-meter-detail">' + esc(detail) + '</span>' +
        '</div>' +
        '<div class="quota-track" role="progressbar" aria-label="Utilisation du jour" ' +
            'aria-valuemin="0" aria-valuemax="100" ' +
            'aria-valuenow="' + Math.round(Math.min(percent, 100)) + '">' +
          '<span class="quota-bar" style="width:' + Math.min(percent, 100) + '%"></span>' +
        '</div>' +
        (percent >= QUOTA_WARN
          ? '<p class="quota-meter-hint">Vous approchez de votre limite quotidienne.</p>'
          : '');
    }

    /* Relue à l'ouverture, après chaque réponse et après un 429. Le serveur
       compte avec la même règle que son refus : à 100 %, le champ se ferme
       sans attendre un envoi voué à l'échec. Un échec de lecture ne change
       rien — la jauge est une indication, pas une condition d'envoi. */
    function loadQuota() {
      return App.api.getMyQuota().then(function (quota) {
        if (destroyed) return;
        state.quota = quota;
        if (!quota.exempt && quota.limit !== null) {
          state.blocked = quota.used >= quota.limit;
          syncComposer();
        }
        renderQuota();
      }, function () {
        /* Jauge absente ou périmée : l'envoi reste possible, et un 429
           éventuel sera dit dans la conversation. */
      });
    }

    function showError(message) {
      state.error = message || '';
      errorNode.innerHTML = state.error
        ? '<div class="inline-error">' + icon('alert') + '<span>' + esc(state.error) + '</span></div>'
        : '';
    }

    /* --- Chargement --------------------------------------------------------- */

    function loadConversations() {
      return App.api.listConversations().then(function (list) {
        if (destroyed) return null;
        state.conversations = list;
        pushConversations();
        return list;
      }, function (error) {
        if (destroyed) return null;
        state.conversations = [];
        pushConversations();
        showError(error.message);
        return null;
      });
    }

    function loadTracked() {
      return App.api.listTracked().then(function (list) {
        if (destroyed) return;
        state.trackedIds = {};
        list.forEach(function (item) {
          if (item.procedureId !== null) state.trackedIds[String(item.procedureId)] = true;
        });
        renderStream(true);
      }, function () {
        /* Sans cette liste, les boutons affichent tous « Suivre » : le serveur
           refusera un doublon, ce n'est pas bloquant pour la conversation. */
      });
    }

    function openConversation(id) {
      if (state.pending) return;
      state.conversationId = id;
      state.messages = [];
      state.loadingThread = true;
      showError('');
      pushConversations();
      renderStream();

      App.api.getConversation(id).then(function (conversation) {
        if (destroyed || String(state.conversationId) !== String(id)) return;
        state.loadingThread = false;
        state.messages = conversation.messages;
        renderStream();
      }, function (error) {
        if (destroyed || String(state.conversationId) !== String(id)) return;
        state.loadingThread = false;
        renderStream();
        showError(error.message);
      });
    }

    function startNew() {
      if (state.pending) return;
      state.conversationId = null;
      state.messages = [];
      state.loadingThread = false;
      showError('');
      pushConversations();
      renderStream();
      input.focus();
    }

    /* Suppression demandée depuis la corbeille du fil. La coque n'envoie que
       l'identifiant : le titre, l'état courant et l'appel au serveur sont ici.

       Rien n'est retiré de la liste avant la réponse : enlever la discussion
       tout de suite obligerait à la remettre à sa place en cas d'échec, et
       une ligne qui disparaît puis revient se lit comme un bug. */
    function removeConversation(id) {
      if (state.pending) return;

      var summary = state.conversations.filter(function (item) {
        return String(item.id) === String(id);
      })[0];
      if (!summary) return;

      App.modals.confirmDelete({
        title: 'Supprimer cette discussion ?',
        target: h.truncate(summary.title, 80),
        consequences: [
          'Tous les messages de cette discussion sont définitivement supprimés.',
          'Les procédures déjà suivies ne sont pas affectées.'
        ],
        run: function () {
          return App.api.deleteConversation(id);
        },
        onDeleted: function () {
          if (destroyed) return;

          state.conversations = state.conversations.filter(function (item) {
            return String(item.id) !== String(id);
          });

          /* Seule la discussion ouverte remet l'écran à zéro : effacer une
             autre ligne du fil ne doit pas interrompre la lecture en cours.
             L'identifiant repasse à null, la prochaine question ouvrira donc
             une discussion neuve. */
          if (String(state.conversationId) === String(id)) {
            state.conversationId = null;
            state.messages = [];
            state.loadingThread = false;
            showError('');
            renderStream();
          }

          pushConversations();
          h.toast('Discussion supprimée.', 'success');
        }
      });
    }

    /* --- Envoi -------------------------------------------------------------- */

    function autoGrow() {
      input.style.height = 'auto';
      // Borné par max-height en CSS : au-delà, le champ défile au lieu de
      // manger la conversation.
      input.style.height = input.scrollHeight + 'px';
    }

    function send() {
      var question = input.value.trim();
      if (!question || state.pending || state.blocked) return;

      var previousId = state.conversationId;
      var optimistic = {
        id: 'local-' + Date.now(), role: 'user', content: question,
        createdAt: new Date().toISOString(), sources: []
      };

      state.messages.push(optimistic);
      state.pending = true;
      showError('');
      input.value = '';
      autoGrow();
      syncComposer();
      renderStream();

      App.api.sendMessage(previousId, question).then(function (result) {
        if (destroyed) return;
        state.pending = false;
        syncComposer();
        state.conversationId = result.conversationId;
        if (result.message) state.messages.push(result.message);
        renderStream();
        loadQuota();
        // La discussion vient peut-être de naître, et dans tous les cas elle
        // remonte en tête de la colonne : on relit la liste plutôt que de
        // deviner son nouveau rang.
        loadConversations();
      }, function (error) {
        if (destroyed) return;
        state.pending = false;

        /* Limite quotidienne : la question reste affichée, la raison
           s'affiche dessous, et le champ se ferme. Rendre le texte au champ
           inviterait à renvoyer une question qui sera refusée de nouveau. */
        if (error && error.status === 429) {
          state.blocked = true;
          state.messages.push({
            id: 'notice-' + Date.now(), role: 'notice',
            content: error.detail || error.message, sources: []
          });
          syncComposer();
          renderStream();
          loadQuota();
          return;
        }

        syncComposer();
        // La question n'a pas abouti : on retire la bulle et on rend le texte
        // au champ. Laisser un message sans réponse ferait croire qu'il est
        // parti et que le serveur se tait.
        var index = state.messages.indexOf(optimistic);
        if (index !== -1) state.messages.splice(index, 1);
        input.value = question;
        autoGrow();
        renderStream();
        showError(error.message);
        input.focus();
      });
    }

    /* --- Suivi d'une procédure depuis une source ---------------------------- */

    function track(procedureId, button) {
      // Les libellés, et la langue dans laquelle la procédure sera suivie,
      // sont ceux de la réponse dont le bouton fait partie.
      var block = button.closest('.msg-sources');
      var lang = h.contentLang(block && block.getAttribute('lang'));
      var labels = h.labelsFor(lang);

      button.disabled = true;
      button.textContent = labels.adding;

      App.api.trackProcedure(procedureId, lang).then(function (item) {
        if (destroyed) return;
        state.trackedIds[String(item.procedureId === null ? procedureId : item.procedureId)] = true;
        // La même procédure peut être citée par plusieurs réponses du fil :
        // on redessine, tous ses boutons passent à « Déjà suivie ».
        renderStream(true);
        // isolate : le toast est en LTR, un message arabe y garde son sens.
        h.toast(h.isolate(labels.trackedToast), 'success');
      }, function (error) {
        if (destroyed) return;
        button.disabled = false;
        button.textContent = labels.track;
        h.toast(error.message, 'error');
      });
    }

    /* --- Évènements ---------------------------------------------------------- */

    /* Les deux actions du fil vivent dans la barre latérale : la coque les
       renvoie ici, l'état de la conversation ne sort pas de cet écran. */
    App.shell.setConversationHandlers({
      create: startNew,
      select: openConversation,
      remove: removeConversation
    });

    h.on(view, 'click', '[data-action="send"]', send);

    h.on(view, 'click', '[data-track]', function (event, target) {
      var procedureId = target.getAttribute('data-track');
      if (procedureId) track(procedureId, target);
    });

    input.addEventListener('keydown', function (event) {
      // Maj + Entrée : retour à la ligne. Entrée seule : envoi — c'est une
      // conversation, pas un formulaire.
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    });
    input.addEventListener('input', autoGrow);

    renderStream();

    loadConversations().then(function (list) {
      if (destroyed || !list || !list.length) return;
      // On rouvre la discussion la plus récente : arriver sur un écran vide
      // alors qu'un historique existe donne l'impression de l'avoir perdu.
      openConversation(list[0].id);
    });
    loadTracked();
    loadQuota();

    return {
      destroy: function () {
        destroyed = true;
        root.classList.remove('is-flush');
        // Plus d'écran pour répondre aux clics du fil, et plus de fil à
        // afficher : la coque le retire avec la route.
        App.shell.setConversationHandlers(null);
        // null et non [] : rien n'est chargé, ce n'est pas un historique vide.
        App.shell.setConversations(null, null);
      }
    };
  }

  App.screens = App.screens || {};
  App.screens.chat = { mount: mount };
})(window);
