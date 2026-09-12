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
      trackedIds: {}
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
        '<p class="composer-hint">Entrée pour envoyer, Maj + Entrée pour aller à la ligne.</p>' +
      '</div>';

    var streamNode = view.querySelector('#chat-stream');
    var errorNode = view.querySelector('#chat-error');
    var input = view.querySelector('#chat-input');
    var sendButton = view.querySelector('[data-action="send"]');

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
    function renderSources(message) {
      if (!message.sources.length) return '';

      return '<div class="msg-sources">' +
        '<div class="msg-sources-title">' + icon('file-text', 'icon-sm') +
          esc(h.plural(message.sources.length, 'source utilisée', 'sources utilisées')) +
        '</div>' +
        message.sources.map(function (source) {
          var isTracked = source.procedureId !== null &&
            state.trackedIds[String(source.procedureId)] === true;
          return '<div class="source-row">' +
            '<div class="source-main">' +
              '<div class="source-title" dir="auto">' + esc(source.title) + '</div>' +
              (source.administration
                ? '<div class="source-admin" dir="auto">' + icon('building', 'icon-sm') +
                  '<span>' + esc(source.administration) + '</span></div>'
                : '<div class="source-admin is-empty">Administration non renseignée</div>') +
            '</div>' +
            '<button type="button" class="btn-tiny source-track' +
              (isTracked ? ' is-tracked' : '') + '" ' +
              'data-track="' + esc(source.procedureId === null ? '' : source.procedureId) + '"' +
              (isTracked || source.procedureId === null ? ' disabled' : '') + '>' +
              (isTracked ? icon('check', 'icon-sm') + 'Déjà suivie' : 'Suivre cette procédure') +
            '</button>' +
          '</div>';
        }).join('') +
        '</div>';
    }

    /* Les réponses arrivent en Markdown : gras, titres, listes, filets. Sans
       conversion l'utilisateur lit la syntaxe au lieu de la mise en forme, et
       ces réponses sont longues et structurées (frais, délais, pièces).

       Deux garde-fous :
       - seules les réponses de l'assistant passent par ce chemin. Le texte de
         l'utilisateur reste échappé, il n'est jamais interprété comme du HTML ;
       - le HTML produit est lavé par DOMPurify avant d'entrer dans la page.
       Si l'une des deux bibliothèques manque (CDN injoignable), on retombe sur
       le texte échappé : moins lisible, mais toujours affiché. */
    function markdownToHtml(text) {
      var parse = null;
      if (typeof marked !== 'undefined' && marked) {
        if (typeof marked.parse === 'function') parse = marked.parse;
        else if (typeof marked === 'function') parse = marked;
      }
      if (!parse) return null;
      if (typeof DOMPurify === 'undefined' || !DOMPurify ||
          typeof DOMPurify.sanitize !== 'function') return null;

      try {
        // breaks : dans une réponse de chat, un retour à la ligne simple est
        // voulu — le Markdown standard le mangerait.
        var html = parse(String(text), { breaks: true, gfm: true });
        return DOMPurify.sanitize(html);
      } catch (error) {
        return null;
      }
    }

    function renderMessage(message) {
      var side = message.role === 'user' ? 'is-user' : 'is-assistant';
      var html = message.role === 'assistant' ? markdownToHtml(message.content) : null;
      // is-markdown : la bulle passe du texte préformaté au flux HTML, c'est
      // le CSS qui reprend l'espacement à partir de là.
      var bubble = html === null
        ? '<div class="msg-bubble" dir="auto">' + esc(message.content) + '</div>'
        : '<div class="msg-bubble is-markdown" dir="auto">' + html + '</div>';

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
      if (!question || state.pending) return;

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
      sendButton.disabled = true;
      renderStream();

      App.api.sendMessage(previousId, question).then(function (result) {
        if (destroyed) return;
        state.pending = false;
        sendButton.disabled = false;
        state.conversationId = result.conversationId;
        if (result.message) state.messages.push(result.message);
        renderStream();
        // La discussion vient peut-être de naître, et dans tous les cas elle
        // remonte en tête de la colonne : on relit la liste plutôt que de
        // deviner son nouveau rang.
        loadConversations();
      }, function (error) {
        if (destroyed) return;
        state.pending = false;
        sendButton.disabled = false;
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
      button.disabled = true;
      button.textContent = 'Ajout…';

      App.api.trackProcedure(procedureId).then(function (item) {
        if (destroyed) return;
        state.trackedIds[String(item.procedureId === null ? procedureId : item.procedureId)] = true;
        // La même procédure peut être citée par plusieurs réponses du fil :
        // on redessine, tous ses boutons passent à « Déjà suivie ».
        renderStream(true);
        h.toast('Procédure suivie — retrouvez-la dans « Mes procédures ».', 'success');
      }, function (error) {
        if (destroyed) return;
        button.disabled = false;
        button.textContent = 'Suivre cette procédure';
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
