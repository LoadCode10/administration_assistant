/* Couche d'accès au backend FastAPI.
   Toutes les réponses sont normalisées ici : les écrans ne manipulent que des
   objets au format documenté en bas de fichier. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var config = App.config;
  var toStringArray = App.helpers.toStringArray;
  var pick = App.helpers.pick;

  /* --- Requête générique -------------------------------------------------- */

  function url(path) {
    return config.API_BASE_URL.replace(/\/+$/, '') + path;
  }

  /* Chemin du champ fautif dans un 422 de FastAPI : loc vaut
     ["body","payload",0,"proc_steps",1,"ar"] et on en fait
     « payload.0.proc_steps.1.ar ».

     Ce chemin est la seule chose qui permette a l'editeur de designer l'input
     a corriger. Sans lui, « String should have at least 1 character » est
     exact et parfaitement inexploitable sur un fichier de trente procedures. */
  function locPath(loc) {
    if (!Array.isArray(loc)) return '';
    return loc.filter(function (part, index) {
      // « body » / « query » / « path » en tete nomme l'emplacement, pas un champ.
      return !(index === 0 &&
        (part === 'body' || part === 'query' || part === 'path'));
    }).join('.');
  }

  /* Les chemins des champs refuses par un 422, dans l'ordre ou le serveur les
     donne. Tableau vide pour toute autre erreur : l'appelant peut appeler sans
     tester le code. */
  function validationFields(payload) {
    var detail = payload && typeof payload === 'object' ? payload.detail : null;
    if (!Array.isArray(detail)) return [];
    return detail.map(function (item) {
      return item ? locPath(item.loc) : '';
    }).filter(function (path) { return path.length > 0; });
  }

  function describeHttpError(response, payload) {
    // FastAPI renvoie en général { "detail": ... }
    if (payload && typeof payload === 'object') {
      var detail = payload.detail !== undefined ? payload.detail : payload.message;
      if (typeof detail === 'string' && detail) return detail;
      if (Array.isArray(detail) && detail.length) {
        return detail.map(function (item) {
          var message = item && item.msg ? item.msg : JSON.stringify(item);
          var path = item ? locPath(item.loc) : '';
          // Le champ d'abord : c'est ce qu'on cherche des lors qu'il y a
          // plusieurs erreurs dans le meme envoi.
          return path ? path + ' : ' + message : message;
        }).join(' · ');
      }
    }
    if (typeof payload === 'string' && payload.trim()) return payload.trim().slice(0, 300);
    if (response.status === 404) return 'Ressource introuvable (404).';
    if (response.status === 413) return 'Fichier refusé par le serveur : trop volumineux (413).';
    if (response.status >= 500) return 'Erreur du serveur (' + response.status + ').';
    return 'La requête a échoué (' + response.status + ').';
  }

  /* options.allowUnauthorized : laisse le 401 remonter tel quel a l'appelant
     au lieu de le traiter comme une expiration de session. Reserve aux trois
     appels ou « non authentifie » est une reponse normale et non un accident —
     la verification de session au demarrage, la connexion et la deconnexion. */
  function request(path, options) {
    options = options || {};
    var init = {
      method: options.method || 'GET',
      headers: options.headers || {},
      signal: options.signal,
      /* Le jeton vit dans un cookie HttpOnly : le navigateur ne l'attache a une
         requete vers une autre origine (front sur :5500, FastAPI sur :8000) que
         si on le demande ici. C'est le seul endroit ou cela se decide — aucun
         appel ne doit repasser « credentials » lui-meme.

         Cote FastAPI, cela impose allow_credentials=True ET une liste d'origines
         explicite : avec des identifiants, le navigateur REFUSE la reponse si
         l'en-tete Access-Control-Allow-Origin vaut « * ». */
      credentials: 'include'
    };
    if (options.body !== undefined) init.body = options.body;
    if (options.json !== undefined) {
      init.body = JSON.stringify(options.json);
      init.headers['Content-Type'] = 'application/json';
    }

    return fetch(url(path), init).then(function (response) {
      var isJson = (response.headers.get('content-type') || '').indexOf('json') !== -1;
      return (isJson ? response.json() : response.text())
        .catch(function () { return null; })
        .then(function (payload) {
          if (!response.ok) {
            // Le code est porte par l'erreur : certains ecrans distinguent un
            // conflit (409) d'une panne, pour le montrer sur le champ fautif
            // plutot que comme un echec global.
            var httpError = new Error(describeHttpError(response, payload));
            httpError.status = response.status;
            // Chemins des champs refuses par un 422 — l'editeur s'en sert pour
            // surligner les inputs concernes.
            httpError.fields = validationFields(payload);

            /* Session expiree ou cookie revoque : la conclusion est la meme quel
               que soit l'ecran qui a lance la requete, on la tire une seule fois
               ici. L'erreur continue de remonter — l'ecran appelant est en train
               d'etre demonte, mais il ne doit pas pour autant afficher une
               reussite. */
            if (response.status === 401 && !options.allowUnauthorized && App.auth) {
              App.auth.handleExpired();
            }
            throw httpError;
          }
          return payload;
        });
    }, function (networkError) {
      if (networkError && networkError.name === 'AbortError') throw networkError;
      throw new Error(
        'Impossible de joindre le serveur (' + config.API_BASE_URL + '). ' +
        'Vérifiez que le backend est démarré et qu\'il autorise cette origine (CORS).'
      );
    });
  }

  /* --- Normalisation ------------------------------------------------------ */

  var STATUS_MAP = {
    published: 'published', publie: 'published', 'publié': 'published',
    approved: 'published', indexed: 'published', done: 'published', complete: 'published',
    pending_review: 'review', needs_review: 'review', review: 'review',
    to_review: 'review', extracted: 'review', ready: 'review', imported: 'review',
    draft: 'review',
    extracting: 'extracting', processing: 'extracting', pending: 'extracting',
    running: 'extracting', queued: 'extracting', in_progress: 'extracting',
    failed: 'failed', error: 'failed', 'échec': 'failed', echec: 'failed'
  };

  function normalizeStatus(raw) {
    var key = String(raw === null || raw === undefined ? '' : raw).toLowerCase().trim();
    return STATUS_MAP[key] || 'review';
  }

  function firstDefined(object, keys, fallback) {
    for (var i = 0; i < keys.length; i++) {
      var value = object[keys[i]];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return fallback;
  }

  /* Chaine de requete a partir d'un objet de filtres. Les valeurs vides sont
     omises : « ?action= » ne veut pas dire la meme chose que pas de filtre du
     tout, et le backend traiterait la premiere forme comme une valeur. */
  function queryString(params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value === null || value === undefined || value === '') return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  /* Un document ou un import direct, tel que consommé par les écrans :
     { id, kind, filename, uploadedAt, status, error, extraction } */
  function normalizeDocument(raw) {
    raw = raw || {};
    var nested = raw.extraction || raw.extraction_file || raw.json_file || null;

    var extractionId = nested
      ? firstDefined(nested, ['id', 'extraction_id', 'id_extraction'], null)
      : firstDefined(raw, ['extraction_id', 'extractionId', 'id_extraction'], null);

    var extractionName = nested
      ? firstDefined(nested, ['filename', 'name', 'file_name'], null)
      : firstDefined(raw, ['extraction_filename', 'json_filename', 'extraction_file'], null);

    var count = nested
      ? firstDefined(nested, ['procedure_count', 'procedures_count', 'count'], null)
      : firstDefined(raw, ['procedure_count', 'procedures_count', 'nb_procedures'], null);

    var kindRaw = String(firstDefined(raw, ['kind', 'type', 'source_type', 'origin'], '')).toLowerCase();
    var isImport = kindRaw === 'import' || kindRaw === 'json' || kindRaw === 'direct' ||
      raw.is_direct_import === true || raw.direct_import === true;

    // Le statut et le message d'erreur vivent sur l'extraction imbriquee ; on ne
    // retombe au niveau du document que si celle-ci ne les porte pas.
    var status = normalizeStatus(firstDefined(
      nested || {}, ['status', 'state'],
      firstDefined(raw, ['status', 'state'], '')
    ));
    var error = firstDefined(
      nested || {}, ['error', 'error_message', 'detail'],
      firstDefined(raw, ['error', 'error_message', 'detail'], null)
    );
    var filename = firstDefined(
      raw,
      ['filename', 'file_name', 'name', 'titre', 'title', 'titre_doc'],
      'Fichier sans nom'
    );

    // Un import direct n'a pas de document source : le JSON est l'élément lui-même.
    if (!isImport && !nested && /\.json$/i.test(String(filename)) && !extractionName) {
      isImport = true;
    }

    return {
      id: String(firstDefined(raw, ['id', 'document_id', 'uuid', 'id_document'], '')),
      kind: isImport ? 'import' : 'document',
      filename: String(filename),
      title: raw.titre || raw.title || raw.titre_doc || null,
      uploadedAt: firstDefined(
        raw,
        ['created_at', 'uploaded_at', 'date_upload', 'createdAt'],
        null
      ),
      status: status,
      error: error,
      extraction: extractionId || extractionName ? {
        id: extractionId === null ? null : String(extractionId),
        filename: extractionName ? String(extractionName) : 'extraction.json',
        count: count === null ? null : Number(count)
      } : null
    };
  }

  /* --- Contenu d'une extraction (bilingue) --------------------------------

     Le contenu d'une extraction n'est plus du texte simple : chaque valeur est
     une paire { "fr": …, "ar": … }, produite directement par le modele. Seul
     « proc_law » reste une liste de chaines — un texte de loi est cite dans sa
     langue d'origine, il ne se traduit pas.

     L'editeur travaille donc sur des paires et non sur des chaines : c'est le
     seul ecran a le faire, parce que c'est le seul ou les deux langues sont
     modifiees. Partout ailleurs, h.pick n'en garde qu'une pour l'affichage.

     Le backend refuse par un 422 toute paire dont un cote est vide. L'editeur
     conserve donc les deux moities telles quelles, meme vides, plutot que de
     les rabattre sur null : c'est ce qui permet de montrer a l'administrateur
     le champ qu'il reste a remplir. */

  /* Une valeur bilingue, toujours ramenee a { fr, ar } avec deux chaines.
     Accepte la paire, une chaine seule (ancienne forme : elle devient le
     francais), ou null. */
  function normalizePair(raw) {
    if (raw === null || raw === undefined) return { fr: '', ar: '' };
    if (typeof raw !== 'object') {
      return { fr: String(raw), ar: '' };
    }
    return {
      fr: raw.fr === null || raw.fr === undefined ? '' : String(raw.fr),
      ar: raw.ar === null || raw.ar === undefined ? '' : String(raw.ar)
    };
  }

  function normalizePairList(raw) {
    if (!Array.isArray(raw)) {
      return raw === null || raw === undefined ? [] : [normalizePair(raw)];
    }
    return raw.map(normalizePair);
  }

  function isEmptyPair(pair) {
    return !String(pair.fr).trim() && !String(pair.ar).trim();
  }

  function trimPair(pair) {
    return { fr: String(pair.fr).trim(), ar: String(pair.ar).trim() };
  }

  /* Une procédure, complétée avec tous les champs attendus par l'éditeur. */
  function normalizeProcedure(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var normalized = {};
    // On conserve les champs inconnus pour ne rien perdre à l'enregistrement.
    Object.keys(raw).forEach(function (key) { normalized[key] = raw[key]; });

    normalized.proc_title = normalizePair(raw.proc_title);
    normalized.proc_description = normalizePair(raw.proc_description);
    normalized.proc_administration = normalizePairList(raw.proc_administration);
    // L'editeur affiche toujours un champ « Administration » : sans entree, il
    // n'aurait rien a lier et l'absence passerait inapercue.
    if (!normalized.proc_administration.length) {
      normalized.proc_administration = [normalizePair(null)];
    }
    normalized.proc_pieces = normalizePairList(raw.proc_pieces);
    normalized.proc_steps = normalizePairList(raw.proc_steps);
    // Les textes de loi restent des chaines simples.
    normalized.proc_law = toStringArray(raw.proc_law);
    normalized.fee = normalizePair(raw.fee);
    normalized.proc_delai = normalizePair(raw.proc_delai);
    return normalized;
  }

  /* Remet une procédure éditée dans la forme attendue par le backend :
     paires entierement vides -> null, listes nettoyees de leurs lignes vides.

     Une paire a moitie remplie est envoyee telle quelle, et c'est voulu : le
     serveur la refusera en nommant le cote manquant, ce qui est exactement le
     message que l'administrateur doit lire. La faire disparaitre ici
     reviendrait a effacer sa saisie sans rien dire. */
  function serializeProcedure(procedure) {
    var out = {};
    Object.keys(procedure).forEach(function (key) { out[key] = procedure[key]; });

    function cleanPairList(list) {
      return (list || []).map(normalizePair).map(trimPair)
        .filter(function (pair) { return !isEmptyPair(pair); });
    }
    function pairOrNull(value) {
      var pair = trimPair(normalizePair(value));
      return isEmptyPair(pair) ? null : pair;
    }

    out.proc_title = trimPair(normalizePair(procedure.proc_title));
    out.proc_description = pairOrNull(procedure.proc_description);
    out.proc_administration = cleanPairList(procedure.proc_administration);
    out.proc_pieces = cleanPairList(procedure.proc_pieces);
    out.proc_steps = cleanPairList(procedure.proc_steps);
    out.proc_law = (procedure.proc_law || []).map(function (item) {
      return String(item).trim();
    }).filter(function (item) { return item.length > 0; });
    out.fee = pairOrNull(procedure.fee);
    out.proc_delai = pairOrNull(procedure.proc_delai);
    return out;
  }

  /* Le contenu d'une extraction : { filename, procedures } */
  function normalizeExtraction(payload, fallbackId) {
    var rawList = null;
    var filename = null;

    if (Array.isArray(payload)) {
      rawList = payload;
    } else if (payload && typeof payload === 'object') {
      rawList = payload.procedures|| payload.payload || payload.data || payload.content ||
        payload.json || payload.items || payload.extraction || null;
      if (typeof rawList === 'string') {
        try { rawList = JSON.parse(rawList); } catch (e) { rawList = null; }
      }
      if (Array.isArray(payload.procedures)) rawList = payload.procedures;
      filename = payload.filename || payload.file_name || payload.name || null;
    }

    if (!Array.isArray(rawList)) {
      throw new Error('Réponse inattendue du serveur : aucune liste de procédures trouvée.');
    }

    return {
      filename: filename || ('extraction_' + fallbackId + '.json'),
      status: payload && payload.status ? normalizeStatus(payload.status) : 'review',
      error: payload && (payload.error_message || payload.error) || null,
      procedures: rawList.map(normalizeProcedure)
    };
  }

  /* --- Statistiques -------------------------------------------------------

     getStats() interroge d'abord /admin/stats. Si le backend ne l'expose pas
     encore, on retombe sur ce qui est deductible de /admin/documents seul :
     statuts, volumes, activite par jour. La repartition par administration,
     elle, demande le contenu des extractions — impossible a reconstituer sans
     un appel par document. Dans ce cas le champ vaut null et l'ecran affiche
     un encart explicite plutot qu'un graphique vide. */

  function dayKey(value) {
    if (!value) return null;
    var d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /* Regroupe une activite quotidienne en 12 semaines glissantes, la derniere
     etant celle d'aujourd'hui. Les semaines commencent le lundi. */
  function weeklyBuckets(daily, weeks) {
    weeks = weeks || 12;
    var out = [];
    var cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7)); // lundi courant

    for (var w = weeks - 1; w >= 0; w--) {
      var start = new Date(cursor);
      start.setDate(start.getDate() - w * 7);
      var total = 0;
      for (var d = 0; d < 7; d++) {
        var day = new Date(start);
        day.setDate(day.getDate() + d);
        total += daily[dayKey(day)] || 0;
      }
      out.push({
        label: String(start.getDate()).padStart(2, '0') + '/' +
          String(start.getMonth() + 1).padStart(2, '0'),
        full: 'Semaine du ' + App.helpers.formatDate(start),
        value: total
      });
    }
    return out;
  }

  /* Une barre de la repartition par administration. Le serveur sert
     { label, label_ar, value }, « label » etant le francais : on choisit la
     langue ici, charts.js n'a pas a savoir qu'il y en a deux. */
  function pickStatLabel(item) {
    item = item || {};
    return {
      label: pick({ label_fr: item.label, label_ar: item.label_ar }, 'label'),
      value: Number(item.value) || 0
    };
  }

  function deriveStats(documents) {
    var byStatus = { published: 0, review: 0, extracting: 0, failed: 0 };
    var daily = {};
    var procedures = 0;

    documents.forEach(function (doc) {
      byStatus[doc.status] = (byStatus[doc.status] || 0) + 1;
      if (doc.extraction && doc.extraction.count) procedures += doc.extraction.count;
      var key = dayKey(doc.uploadedAt);
      if (key) daily[key] = (daily[key] || 0) + 1;
    });

    return {
      totals: {
        documents: documents.length,
        procedures: procedures,
        pieces: null,
        steps: null,
        administrations: null
      },
      byStatus: byStatus,
      byAdministration: null,
      daily: daily,
      weekly: weeklyBuckets(daily),
      // Signale a l'ecran que certaines cartes ne sont pas calculables.
      partial: true
    };
  }

  /* Une procedure telle que la renvoie /admin/procedures : forme « base de
     donnees », ou chaque texte porte desormais deux colonnes — titre_proc_fr /
     titre_proc_ar, l'administration imbriquee, les pieces et les etapes en
     objets eux aussi bilingues.

     L'ecran « Procedures » ne fait que LIRE : on n'y garde donc qu'une langue
     par valeur, celle de l'interface (h.pick), et la procedure ressort en
     chaines simples — la meme forme qu'avant la migration, d'ou un ecran
     inchange. L'edition des deux langues, elle, n'existe que dans l'editeur
     d'extraction, qui travaille sur des paires. */
  function mapStoredProcedure(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};

    var administration = raw.administration || null;
    var administrationName = administration
      ? (pick(administration, 'nom_administration') ||
         String(firstDefined(administration, ['nom', 'name'], '')))
      : '';

    var etapes = Array.isArray(raw.etapes) ? raw.etapes.slice() : [];
    etapes.sort(function (a, b) {
      return Number((a && a.ordre_etape) || 0) - Number((b && b.ordre_etape) || 0);
    });

    return {
      id: firstDefined(raw, ['id_procedure', 'id', 'procedure_id', 'proc_id'], null),
      proc_title: pick(raw, 'titre_proc'),
      proc_description: pick(raw, 'description_proc'),
      fee: pick(raw, 'frais_proc'),
      proc_delai: pick(raw, 'delai_proc'),
      proc_administration: administrationName ? [String(administrationName)] : [],
      // h.pick rend telle quelle une valeur qui n'est pas un objet : une piece
      // arrivant en simple chaine (mode demonstration) traverse sans cas a part.
      proc_pieces: (Array.isArray(raw.pieces) ? raw.pieces : []).map(function (piece) {
        return pick(piece, 'nom_piece');
      }),
      proc_steps: etapes.map(function (etape) {
        return pick(etape, 'description_etape');
      }),
      proc_law: (Array.isArray(raw.lois) ? raw.lois : []).map(function (loi) {
        return loi && loi.texte_loi !== undefined ? loi.texte_loi : loi;
      }),
      /* « statut_proc » vaut « active » ou « obsolete ». Une procedure
         obsolete n'est pas supprimee : sa ligne reste, elle sort seulement
         des reponses de l'assistant, et les citoyens qui la suivaient la
         voient marquee comme n'etant plus en vigueur. Toute valeur inconnue
         est lue comme « active » : masquer une procedure en vigueur serait
         pire que d'en montrer une perimee. */
      status: String(firstDefined(raw, ['statut_proc', 'statut', 'status'], 'active'))
        .toLowerCase().trim() === 'obsolete' ? 'obsolete' : 'active',
      // Renseignee seulement quand la procedure est obsolete.
      obsoleteAt: firstDefined(raw, ['date_obsolete', 'obsolete_at', 'dateObsolete'], null),
      // /admin/procedures ne dit pas de quel fichier vient la procedure :
      // l'ecran masque le lien « ouvrir dans l'editeur » quand c'est absent.
      extractionId: null,
      extractionName: null
    };
  }

  /* Une administration telle que consommee par l'ecran « Administrations » :
     { id, name, nameFr, nameAr, address, url, procedureCount }.

     « name » est le nom a AFFICHER — une seule langue, celle de l'interface.
     « nameFr » et « nameAr » sont les deux valeurs a EDITER : le formulaire
     porte deux champs et le PUT renvoie les deux colonnes, sinon la moitie
     non affichee serait ecrasee par celle qu'on vient de taper.

     L'adresse et le site sont tres souvent nuls dans les donnees importees :
     on les ramene a la chaine vide pour que les champs du formulaire s'y
     lient sans avoir a tester null a chaque rendu. */
  function normalizeAdministration(raw) {
    raw = raw || {};
    var count = firstDefined(raw, ['procedure_count', 'procedures_count', 'nb_procedures'], 0);
    var nameFr = String(firstDefined(raw,
      ['nom_administration_fr', 'nom', 'name'], ''));
    var nameAr = String(firstDefined(raw, ['nom_administration_ar'], ''));
    return {
      id: firstDefined(raw, ['id_administration', 'id', 'administration_id'], null),
      name: pick(raw, 'nom_administration') || nameFr || nameAr,
      nameFr: nameFr,
      nameAr: nameAr,
      address: String(firstDefined(raw, ['addr_administration', 'adresse', 'address'], '')),
      url: String(firstDefined(raw, ['url_administration', 'url', 'site'], '')),
      procedureCount: Number(count) || 0
    };
  }

  /* Une entree du journal d'activite, telle que la renvoie /admin/logs :
     { id, action, entityType, entityId, detail, ipAddress, userAgent, method,
       path, date, actorRole, actor }.

     « actor » est nul pour les echecs de connexion et d'inscription : personne
     n'etait authentifie, et c'est justement ce que l'entree raconte. L'ecran
     doit donc toujours tester avant d'afficher un nom.

     « actorRole » est le role enregistre au moment de l'action : il peut
     differer de celui que la personne porte aujourd'hui, et c'est le premier
     qui fait foi dans un journal. On ne le remplace donc pas par celui de
     l'objet « user » imbrique — on s'en sert seulement comme repli. */
  function normalizeLogActor(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = firstDefined(raw, ['id_user', 'id', 'user_id', 'uuid'], '');
    var username = firstDefined(raw,
      ['userName_user', 'userName', 'username', 'user_name'], '');
    // Un objet vide n'est pas un acteur : mieux vaut « non authentifie » qu'une
    // ligne au nom vide.
    if (!id && !username) return null;
    return {
      id: String(id),
      username: String(username),
      role: normalizeRole(firstDefined(raw, ['role_user', 'role'], 'citizen'))
    };
  }

  function normalizeLog(raw) {
    raw = raw || {};
    var actor = normalizeLogActor(raw.user || raw.actor || raw.utilisateur);
    return {
      id: String(firstDefined(raw, ['id_log', 'id', 'log_id', 'uuid'], '')),
      action: String(firstDefined(raw, ['action', 'action_log'], '')),
      entityType: String(firstDefined(raw, ['entity_type', 'entityType'], '')),
      entityId: String(firstDefined(raw, ['entity_id', 'entityId'], '')),
      detail: String(firstDefined(raw, ['detail', 'details', 'message'], '')),
      ipAddress: String(firstDefined(raw, ['ip_address', 'ipAddress', 'ip'], '')),
      userAgent: String(firstDefined(raw, ['user_agent', 'userAgent'], '')),
      method: String(firstDefined(raw, ['method', 'http_method'], '')),
      path: String(firstDefined(raw, ['path', 'url', 'endpoint'], '')),
      date: firstDefined(raw, ['date_log', 'created_at', 'date', 'timestamp'], null),
      actorRole: normalizeRole(firstDefined(raw, ['user_role', 'userRole'],
        actor ? actor.role : '')),
      actor: actor
    };
  }

  /* --- Espace citoyen : assistant et suivi --------------------------------

     Les points d'entrée « /citizen/tracked » existent côté FastAPI, et le
     contrat ci-dessous est celui qu'ils servent réellement ; ceux des
     discussions restent à écrire. Les normaliseurs acceptent en plus les
     variantes de nommage les plus probables (camelCase / snake_case,
     français / anglais), notamment celles du mode démonstration, pour que le
     branchement ne demande pas de retoucher les écrans.

       GET    /citizen/conversations
                -> [ { id, title, updated_at } ]
       GET    /citizen/conversations/{id}
                -> { id, title, updated_at, messages: [ message ] }
       POST   /citizen/conversations               { question }
                -> { id, title, updated_at, messages: [ message ] }
                   (crée la discussion et répond à la première question)
       POST   /citizen/conversations/{id}/messages { question }
                -> { conversation_id, message }
       DELETE /citizen/conversations/{id}

       GET    /citizen/tracked
                -> [ tracked ]
       POST   /citizen/tracked                     { id_procedure, lang }
                -> tracked
       DELETE /citizen/tracked/{id_user_procedure}
       PATCH  /citizen/tracked/documents/{id_upd}  { est_coche, note }
                -> document  (la seule pièce mise à jour : le front réaligne
                              la case, pas la carte entière)

       message = { id, role: 'user'|'assistant', content, created_at,
                   lang: 'fr'|'ar' (reponses seulement),
                   sources: [ source ] }
       source  = { id_procedure, titre_proc_fr, titre_proc_ar,
                   administration: { nom_administration_fr,
                                     nom_administration_ar } }
       tracked = { id_user_procedure, id_procedure, lang: 'fr'|'ar',
                   titre_proc_fr, titre_proc_ar,
                   id_administration,
                   administration: { nom_administration_fr,
                                     nom_administration_ar } | null,
                   status, date_debut,
                   documents: [ { id_upd, id_piece,
                                  nom_piece_fr, nom_piece_ar,
                                  est_coche, note } ],
                   etapes:    [ { ordre_etape, description_etape_fr,
                                  description_etape_ar } ] }

     « source » a exactement la meme forme dans /ask et dans
     /citizen/conversations/{id} — avant la migration bilingue, le premier
     servait un objet et le second une chaine.

     « administration » est un objet bilingue, ou null quand la procedure n'en
     cite aucune. Les normaliseurs acceptent aussi une chaine seule, forme
     servie par le mode demonstration.

     Le rôle d'un message est ramené à deux valeurs : tout ce qui n'est pas
     l'utilisateur est présenté comme une réponse de l'assistant. */

  /* Le nom d'une administration, quelle que soit la forme sous laquelle elle
     arrive : l'objet bilingue { nom_administration_fr, nom_administration_ar }
     que servent desormais /ask, /citizen/tracked, /citizen/.../nearby et
     /admin/users/{id} ; une chaine seule (mode demonstration) ; ou rien.
     On n'en garde que la langue courante — aucun de ces ecrans ne l'edite. */
  function administrationName(raw) {
    if (raw === null || raw === undefined) return '';
    if (typeof raw !== 'object') return String(raw);
    return pick(raw, 'nom_administration') ||
      String(firstDefined(raw, ['nom', 'name', 'label', 'title'], ''));
  }

  function normalizeSource(raw) {
    raw = raw || {};

    /* « administration » est maintenant un objet bilingue dans les DEUX
       points d'entree — /ask et /citizen/conversations/{id} — la ou l'un
       servait un objet et l'autre une chaine. La chaine reste acceptee pour
       le mode demonstration. */
    var administration = firstDefined(raw,
      ['administration', 'administration_name', 'admin'], '');
    var bilingualAdmin = (administration && typeof administration === 'object')
      ? administration : {};

    return {
      procedureId: firstDefined(raw,
        ['procedure_id', 'procedureId', 'id_procedure', 'id'], null),
      // title / administration : dans la langue de l'interface, comme partout.
      // Les paires _fr / _ar restent a cote : l'ecran les reprend dans la
      // langue du message (h.pick(source, 'title', message.lang)).
      // Pas de « Procédure sans titre » ici : l'écran le met dans la langue
      // de la réponse.
      title: pick(raw, 'titre_proc') ||
        String(firstDefined(raw,
          ['procedure_title', 'title', 'proc_title', 'titre'], '')),
      title_fr: String(raw.titre_proc_fr || ''),
      title_ar: String(raw.titre_proc_ar || ''),
      administration: administrationName(administration),
      administration_fr: String(bilingualAdmin.nom_administration_fr || ''),
      administration_ar: String(bilingualAdmin.nom_administration_ar || '')
    };
  }

  /* Langue d'une reponse, detectee par le serveur sur la question : « fr » ou
     « ar ». Tout le reste — absent, ancien message, valeur inattendue — donne
     null, et l'ecran retombe sur la langue de l'interface. */
  function normalizeLang(value) {
    var lang = String(value === null || value === undefined ? '' : value).toLowerCase();
    return (lang === 'fr' || lang === 'ar') ? lang : null;
  }

  function normalizeMessage(raw) {
    raw = raw || {};
    var role = String(firstDefined(raw, ['role', 'author', 'sender'], 'assistant')).toLowerCase();
    var isUser = role === 'user' || role === 'utilisateur' || role === 'citizen';
    var sources = raw.sources || raw.citations || raw.references || [];
    return {
      id: String(firstDefined(raw, ['id', 'message_id', 'id_question', 'uuid'], '')),
      role: isUser ? 'user' : 'assistant',
      content: String(firstDefined(raw, ['content', 'text', 'message', 'answer', 'reponse'], '')),
      createdAt: firstDefined(raw, ['created_at', 'createdAt', 'date'], null),
      // Seules les reponses portent une langue ; la question n'en a pas.
      lang: isUser ? null : normalizeLang(raw.lang),
      sources: (Array.isArray(sources) ? sources : []).map(normalizeSource)
    };
  }

  /* Le titre d'une discussion est dérivé de sa première question quand le
     serveur n'en donne pas : c'est ce que la colonne de gauche affiche, elle
     ne doit jamais tomber sur une ligne vide. */
  function normalizeConversation(raw) {
    raw = raw || {};
    var rawMessages = raw.messages || raw.items || null;
    var messages = Array.isArray(rawMessages) ? rawMessages.map(normalizeMessage) : null;

    var title = firstDefined(raw, ['title', 'titre', 'label'], null);
    if (!title && messages) {
      var firstQuestion = messages.filter(function (message) {
        return message.role === 'user';
      })[0];
      if (firstQuestion) title = firstQuestion.content;
    }

    return {
      id: String(firstDefined(raw, ['id', 'conversation_id', 'uuid'], '')),
      title: String(title || 'Nouvelle discussion'),
      updatedAt: firstDefined(raw,
        ['updated_at', 'updatedAt', 'last_message_at', 'created_at'], null),
      messages: messages
    };
  }

  function normalizeTrackedPiece(raw, index) {
    // Une pièce peut arriver comme simple chaîne tant que le backend ne stocke
    // pas de cases cochées : on lui fabrique alors un identifiant de rang.
    if (typeof raw === 'string') {
      return { id: 'p' + index, label: raw, checked: false, note: '' };
    }
    raw = raw || {};
    return {
      // « id_upd » identifie la ligne de suivi, et c'est elle que le PATCH
      // adresse — pas la pièce (« id_piece »), qui est la même pour tous les
      // citoyens suivant la procédure.
      id: String(firstDefined(raw,
        ['id_upd', 'id', 'piece_id', 'id_piece'], 'p' + index)),
      label: pick(raw, 'nom_piece') ||
        String(firstDefined(raw, ['label', 'name', 'piece'], '')),
      // Les deux langues restent là : la carte affiche celle du suivi.
      label_fr: String(raw.nom_piece_fr || ''),
      label_ar: String(raw.nom_piece_ar || ''),
      checked: firstDefined(raw,
        ['checked', 'est_coche', 'is_checked', 'done'], false) === true,
      note: String(firstDefined(raw, ['note', 'comment', 'remarque'], '') || '')
    };
  }

  /* Les étapes sont en lecture seule : on ne garde que leur libellé, remis
     dans l'ordre porté par le serveur. */
  function normalizeTrackedSteps(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (raw, index) {
      if (typeof raw === 'string') return { order: index + 1, label: raw };
      raw = raw || {};
      return {
        order: Number(firstDefined(raw, ['order', 'ordre_etape', 'position'], index + 1)),
        label: pick(raw, 'description_etape') ||
          String(firstDefined(raw, ['label', 'text', 'etape'], '')),
        label_fr: String(raw.description_etape_fr || ''),
        label_ar: String(raw.description_etape_ar || '')
      };
    }).sort(function (a, b) { return a.order - b.order; });
  }

  /* « administration » est desormais un objet bilingue — ou null quand la
     procedure n'en cite aucune. On n'en garde que le nom, dans la langue de
     l'interface. */
  function normalizeTrackedAdministration(raw) {
    return administrationName(firstDefined(raw,
      ['administration', 'administration_name'], ''));
  }

  function normalizeTracked(raw) {
    raw = raw || {};
    // La liste des pièces s'appelle « documents » côté API ; « pieces » reste
    // accepté pour le mode démonstration.
    var pieces = firstDefined(raw, ['documents', 'pieces'], null);
    if (!Array.isArray(pieces)) pieces = [];
    var administration = raw.administration;
    var bilingualAdmin = (administration && typeof administration === 'object')
      ? administration : {};

    return {
      id: String(firstDefined(raw,
        ['id_user_procedure', 'id', 'tracking_id', 'id_suivi'], '')),
      procedureId: firstDefined(raw,
        ['procedure_id', 'procedureId', 'id_procedure'], null),
      // Langue dans laquelle la procédure a été suivie ; null (ancien suivi)
      // = celle de l'interface. title / administration restent dans la
      // langue de l'interface, les paires _fr / _ar servent à la carte.
      // Pas de « Procédure sans titre » ici : la carte le met dans sa langue.
      lang: normalizeLang(raw.lang),
      title: pick(raw, 'titre_proc') ||
        String(firstDefined(raw,
          ['procedure_title', 'title', 'proc_title'], '')),
      title_fr: String(raw.titre_proc_fr || ''),
      title_ar: String(raw.titre_proc_ar || ''),
      administration: normalizeTrackedAdministration(raw),
      administration_fr: String(bilingualAdmin.nom_administration_fr || ''),
      administration_ar: String(bilingualAdmin.nom_administration_ar || ''),
      // L'identifiant de l'administration, et non son nom : c'est lui qu'attend
      // /citizen/administrations/{id}/nearby. Sans lui l'écran « Mes procédures »
      // n'a rien à adresser et le bouton « bureau le plus proche » n'existe pas.
      administrationId: firstDefined(raw,
        ['id_administration', 'administration_id', 'administrationId'], null),
      status: String(firstDefined(raw, ['status', 'statut', 'etat'], '')),
      startedAt: firstDefined(raw,
        ['date_debut', 'created_at', 'started_at', 'createdAt'], null),
      pieces: pieces.map(normalizeTrackedPiece),
      steps: normalizeTrackedSteps(raw.steps || raw.etapes)
    };
  }

  /* --- Bureaux à proximité ------------------------------------------------

     GET /citizen/administrations/{id}/nearby?lat=&lon=
       -> { administration, ville, texte, sources: [ { title, uri, officielle } ],
            verifie }

     « texte » est de la prose Markdown libre, écrite par un modèle : elle n'a
     pas de structure sur laquelle s'appuyer, et elle n'entre dans la page
     qu'après conversion et lavage (h.markdownToHtml). « verifie » ne vaut true
     que si au moins une source officielle a été trouvée — l'écran s'en sert
     pour avertir, c'est la seule valeur qui décide de ce qu'on affirme. */

  /* Une source arrive avec une URL que personne n'a validée : on n'accepte que
     http(s). Un « javascript: » glissé dans une réponse de modèle deviendrait
     sinon un lien exécutable posé dans la page. */
  function safeHttpUrl(value) {
    var text = String(value === null || value === undefined ? '' : value).trim();
    return /^https?:\/\//i.test(text) ? text : '';
  }

  function normalizeNearbySource(raw) {
    raw = raw || {};
    var uri = safeHttpUrl(firstDefined(raw, ['uri', 'url', 'lien', 'link'], ''));
    var title = String(firstDefined(raw, ['title', 'titre', 'name', 'nom'], ''));
    return {
      // Sans titre, l'hôte du lien vaut mieux qu'une puce vide.
      title: title || uri.replace(/^https?:\/\//i, '').split('/')[0] || 'Source sans titre',
      uri: uri,
      official: firstDefined(raw,
        ['officielle', 'official', 'is_official'], false) === true
    };
  }

  function normalizeNearby(raw) {
    raw = raw || {};
    var sources = firstDefined(raw, ['sources', 'liens'], null);
    if (!Array.isArray(sources)) sources = [];
    return {
      // « administration » est passee d'une chaine a l'objet bilingue.
      administration: administrationName(raw.administration),
      // Paires gardées : le panneau affiche le nom dans la langue de la carte.
      administration_fr: String((raw.administration && raw.administration.nom_administration_fr) || ''),
      administration_ar: String((raw.administration && raw.administration.nom_administration_ar) || ''),
      city: String(firstDefined(raw, ['ville', 'city'], '')),
      text: String(firstDefined(raw, ['texte', 'text', 'reponse'], '') || ''),
      sources: sources.map(normalizeNearbySource),
      verified: firstDefined(raw, ['verifie', 'verified'], false) === true
    };
  }

  /* Réponse d'un PATCH sur une pièce. Le serveur renvoie le document mis à
     jour ; le mode démonstration, lui, renvoie le suivi complet — on y
     retrouve alors la pièce par son identifiant. */
  function normalizeUpdatedPiece(payload, pieceId) {
    payload = payload || {};

    var list = firstDefined(payload, ['documents', 'pieces'], null);
    if (Array.isArray(list)) {
      var match = list.map(normalizeTrackedPiece).filter(function (piece) {
        return String(piece.id) === String(pieceId);
      })[0];
      if (match) return match;
    }

    var updated = normalizeTrackedPiece(payload, 0);
    // Le document renvoyé peut ne pas reporter son identifiant : on garde
    // celui qu'on vient d'adresser plutôt qu'un rang inventé.
    updated.id = String(firstDefined(payload,
      ['id_upd', 'id', 'piece_id', 'id_piece'], pieceId));
    return updated;
  }

  /* L'utilisateur connecte, tel que le renvoient POST /auth/login (sous la cle
     « user ») et GET /citizen/me (a plat). Le rôle est la seule valeur dont
     depend la navigation : une valeur inconnue est ramenee a « citizen », le
     rôle le moins capable — mieux vaut un ecran manquant qu'une console
     d'administration ouverte par accident. */
  /* Un role inconnu est ramene a « citizen », le role le moins capable : mieux
     vaut un ecran manquant qu'une console d'administration ouverte par
     accident. La colonne s'appelle « role » sur /citizen/me et « role_user »
     sur /admin/users — les deux noms sont acceptes ici. */
  function normalizeRole(raw) {
    var role = String(raw === null || raw === undefined ? '' : raw).toLowerCase().trim();
    return role === 'admin' ? 'admin' : 'citizen';
  }

  function normalizeUser(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var payload = raw.user && typeof raw.user === 'object' ? raw.user : raw;

    var firstName = String(firstDefined(payload, ['prenom_user', 'prenom', 'first_name'], ''));
    var lastName = String(firstDefined(payload, ['nom_user', 'nom', 'last_name'], ''));
    var role = normalizeRole(firstDefined(payload, ['role', 'role_user'], 'citizen'));

    var name = (firstName + ' ' + lastName).trim() ||
      String(firstDefined(payload, ['userName', 'username', 'email_user', 'email'], 'Utilisateur'));

    return {
      id: String(firstDefined(payload, ['id_user', 'id'], '')),
      firstName: firstName,
      lastName: lastName,
      name: name,
      email: String(firstDefined(payload, ['email_user', 'email'], '')),
      role: role,
      roleLabel: App.auth ? App.auth.roleLabel(role) : role
    };
  }

  /* --- Comptes (console d'administration) --------------------------------

     GET /admin/users        -> [ compte ]       (deja trie, plus recent en tete)
     GET /admin/users/{id}   -> compte + tracked_procs

     Les deux repondent 401 sans session et 403 a un compte non administrateur.

     Les colonnes portent le suffixe de la table — « userName_user »,
     « role_user » — la ou le reste de l'API s'en tient a « username » et
     « role » : les deux jeux de noms sont acceptes.

     La fiche ne renvoie NI le nombre de discussions NI le telephone : l'ecran
     de detail ne les affiche donc pas, et le normaliseur ne fabrique pas de
     champ que le serveur ne remplit pas. Elle renvoie en revanche, depuis le
     passage a la table « token_usage », le detail de la consommation :
     « tokens » porte un compteur d'appels (nb_appels) que la liste n'a pas, et
     « tokens_par_feature » ventile le total entre les fonctionnalites qui
     appellent le modele.

       compte  = { id_user, nom_user, prenom_user, email_user, userName_user,
                   role_user, creation_date, tracked_count,
                   conversations_count (liste seulement),
                   tokens: { prompt, output, total } partout,
                           + nb_appels sur la fiche seulement,
                   tokens_par_feature: [ { feature, total, nb_appels } ]
                           (fiche seulement ; peut etre vide) }
       tracked = { id_up, status, titre_proc_fr, titre_proc_ar,
                   administration: { nom_administration_fr,
                                     nom_administration_ar } | null }
                 « status » vaut « en_cours » ou « termine ». */

  /* Le bloc « tokens » d'un compte : { prompt, output, total }. Un compte qui
     n'a jamais rien demandé le reçoit à zéro plutôt qu'absent, mais on ne s'y
     fie pas — une ancienne version du backend ne l'envoie pas du tout, et
     l'écran doit alors afficher « 0 token », pas « NaN ».

     Le total est recalculé à partir des deux moitiés quand le serveur ne le
     donne pas : c'est la seule valeur affichée sur la carte. */
  function normalizeTokens(raw) {
    var tokens = raw && typeof raw === 'object' ? raw : {};
    var prompt = Number(firstDefined(tokens,
      ['prompt', 'prompt_tokens', 'promptTokens', 'input'], 0)) || 0;
    var output = Number(firstDefined(tokens,
      ['output', 'output_tokens', 'outputTokens', 'completion'], 0)) || 0;
    var total = firstDefined(tokens, ['total', 'total_tokens', 'totalTokens'], null);

    /* « nb_appels » compte desormais TOUS les appels au modele — assistant,
       extraction de documents, recherche de bureaux — la ou « nb_reponses »
       ne comptait que les reponses de discussion. L'ancien nom reste lu en
       repli : une reponse servie par une version precedente du backend doit
       afficher son compteur, pas un zero. */
    var calls = firstDefined(tokens,
      ['nb_appels', 'nbAppels', 'calls', 'nb_reponses', 'nbReponses'], 0);

    return {
      promptTokens: prompt,
      outputTokens: output,
      totalTokens: total === null ? prompt + output : (Number(total) || 0),
      calls: Number(calls) || 0
    };
  }

  /* Une ligne de la repartition par fonctionnalite. « feature » est une cle
     technique (chat, extraction, agent) : c'est l'ecran qui la traduit, le
     normaliseur ne fait que la transmettre — une cle inconnue doit arriver
     intacte jusqu'a l'affichage, qui saura la montrer telle quelle. */
  function normalizeTokenFeature(raw) {
    raw = raw || {};
    var tokens = normalizeTokens(raw);
    return {
      feature: String(firstDefined(raw, ['feature', 'fonctionnalite', 'key'], '')),
      total: tokens.totalTokens,
      calls: tokens.calls
    };
  }

  function normalizeUserSummary(raw) {
    raw = raw || {};
    var trackedCount = firstDefined(raw,
      ['tracked_count', 'trackedCount', 'procedures_count', 'nb_procedures'], 0);
    var conversationsCount = firstDefined(raw,
      ['conversations_count', 'conversationsCount', 'discussions_count'], 0);
    var tokens = normalizeTokens(raw.tokens || raw.jetons);

    return {
      id: String(firstDefined(raw, ['id_user', 'id', 'user_id', 'uuid'], '')),
      firstName: String(firstDefined(raw, ['prenom_user', 'prenom', 'first_name'], '')),
      lastName: String(firstDefined(raw, ['nom_user', 'nom', 'last_name'], '')),
      username: String(firstDefined(raw,
        ['userName_user', 'userName', 'username', 'user_name'], '')),
      email: String(firstDefined(raw, ['email_user', 'email'], '')),
      role: normalizeRole(firstDefined(raw, ['role_user', 'role'], 'citizen')),
      createdAt: firstDefined(raw,
        ['creation_date', 'created_at', 'createdAt', 'date_creation'], null),
      trackedCount: Number(trackedCount) || 0,
      conversationsCount: Number(conversationsCount) || 0,
      promptTokens: tokens.promptTokens,
      outputTokens: tokens.outputTokens,
      totalTokens: tokens.totalTokens
    };
  }

  /* --- Consommation de jetons --------------------------------------------

     GET /admin/tokens/daily?days=30&top=10 -> { days, series }, reserve aux
     administrateurs comme le reste de la console.

       serie = { id_user, userName, total, points }
       point = { date: 'AAAA-MM-JJ', prompt, output, total }

     Deux garanties du serveur sur lesquelles l'ecran s'appuie, et qu'on ne
     rejoue donc pas ici : « series » est DEJA trie, du plus gros consommateur
     au plus petit, et chaque serie porte un point par jour de la periode,
     zeros compris. Pas de trou a boucher, pas de tri a refaire — l'ordre recu
     est celui qui fixe les couleurs du graphique. */

  function normalizeTokenPoint(raw) {
    raw = raw || {};
    var tokens = normalizeTokens(raw);
    return {
      date: String(firstDefined(raw, ['date', 'day', 'jour'], '')),
      prompt: tokens.promptTokens,
      output: tokens.outputTokens,
      total: tokens.totalTokens
    };
  }

  function normalizeTokenSeries(raw) {
    raw = raw || {};
    var points = firstDefined(raw, ['points', 'daily', 'jours'], null);
    var list = (Array.isArray(points) ? points : []).map(normalizeTokenPoint);
    var total = firstDefined(raw, ['total', 'total_tokens', 'totalTokens'], null);

    return {
      id: String(firstDefined(raw, ['id_user', 'id', 'user_id', 'uuid'], '')),
      username: String(firstDefined(raw,
        ['userName', 'userName_user', 'username', 'user_name'], '')),
      // A defaut de total annonce, la somme des points : les deux doivent
      // coincider cote serveur, c'est la somme qui sert de repli.
      total: total === null
        ? list.reduce(function (sum, point) { return sum + point.total; }, 0)
        : (Number(total) || 0),
      points: list
    };
  }

  /* Une procedure suivie, vue depuis la fiche d'un compte : le strict
     necessaire pour la lister. C'est une autre forme que /citizen/tracked —
     ni pieces ni etapes — d'ou un normaliseur distinct. */
  function normalizeUserTracked(raw) {
    raw = raw || {};
    return {
      id: String(firstDefined(raw, ['id_up', 'id_user_procedure', 'id'], '')),
      status: String(firstDefined(raw, ['status', 'statut', 'etat'], '')),
      procedureTitle: pick(raw, 'titre_proc') ||
        String(firstDefined(raw,
          ['procedure_title', 'title', 'proc_title'], 'Procédure sans titre')),
      // Souvent nulle : l'ecran le dit plutot que de laisser une ligne vide.
      administration: normalizeTrackedAdministration(raw)
    };
  }

  function normalizeUserDetail(raw) {
    raw = raw || {};
    var summary = normalizeUserSummary(raw);
    var list = firstDefined(raw, ['tracked_procs', 'tracked', 'procedures'], null);
    var tokens = normalizeTokens(raw.tokens || raw.jetons);
    /* Tableau vide pour un compte qui n'a jamais rien declenche, et parfois
       une seule fonctionnalite sur les trois : l'ecran ne doit compter sur
       aucune ligne en particulier. */
    var features = firstDefined(raw,
      ['tokens_par_feature', 'tokensParFeature', 'tokensByFeature'], null);

    return {
      id: summary.id,
      firstName: summary.firstName,
      lastName: summary.lastName,
      username: summary.username,
      email: summary.email,
      role: summary.role,
      createdAt: summary.createdAt,
      trackedCount: summary.trackedCount,
      tracked: (Array.isArray(list) ? list : []).map(normalizeUserTracked),
      promptTokens: tokens.promptTokens,
      outputTokens: tokens.outputTokens,
      totalTokens: tokens.totalTokens,
      tokenCalls: tokens.calls,
      tokensByFeature: (Array.isArray(features) ? features : [])
        .map(normalizeTokenFeature)
    };
  }

  App.api = App.api || {};

  /* --- Points d'entrée ---------------------------------------------------- */

  var api = {
    normalizeProcedure: normalizeProcedure,
    serializeProcedure: serializeProcedure,

    /* Normaliseurs internes, exposes pour les tests : ils traduisent les
       reponses du backend et c'est la qu'une migration de champs se casse en
       premier. Aucun ecran ne doit les appeler — ils recoivent du brut. */
    __test: {
      mapStoredProcedure: mapStoredProcedure,
      normalizeAdministration: normalizeAdministration,
      normalizeSource: normalizeSource,
      normalizeTracked: normalizeTracked,
      normalizeUpdatedPiece: normalizeUpdatedPiece,
      normalizeNearby: normalizeNearby,
      normalizeUserTracked: normalizeUserTracked,
      pickStatLabel: pickStatLabel,
      describeHttpError: describeHttpError,
      validationFields: validationFields
    },

    listDocuments: function () {
      var promise = config.USE_MOCK ? App.mock.listDocuments() : request('/admin/documents');
      return promise.then(function (payload) {
        var list = Array.isArray(payload) ? payload
          : (payload && (payload.documents || payload.items || payload.results)) || [];
        return list.map(normalizeDocument);
      });
    },

    // fields : { file, titre, url_source }
    uploadDocument: function (fields) {
      var form = new FormData();
      form.append('file', fields.file);
      form.append('titre', fields.titre || '');
      if (fields.url_source) form.append('url_source', fields.url_source);
      if (config.USE_MOCK) return App.mock.uploadDocument(form);
      return request('/admin/documents', { method: 'POST', body: form });
    },

    deleteDocument: function (id) {
      if (config.USE_MOCK) return App.mock.deleteDocument(id);
      return request('/admin/documents/' + encodeURIComponent(id), { method: 'DELETE' });
    },

    // fields : { file, source } — renvoie l'identifiant de l'extraction créée.
    importJson: function (fields) {
      var form = new FormData();
      form.append('file', fields.file);
      if (fields.source) form.append('source', fields.source);
      var promise = config.USE_MOCK
        ? App.mock.importJson(form)
        : request('/admin/imports', { method: 'POST', body: form });
      return promise.then(function (payload) {
        var id = payload && (payload.extraction_id || payload.id || payload.extractionId);
        if (id === undefined || id === null || id === '') {
          throw new Error('Import accepté mais le serveur n\'a pas renvoyé d\'identifiant d\'extraction.');
        }
        return String(id);
      });
    },

    getExtraction: function (id) {
      var promise = config.USE_MOCK ? App.mock.getExtraction(id) : request('/admin/extractions/' + encodeURIComponent(id));
      return promise.then(function (payload) { return normalizeExtraction(payload, id); });
    },

    saveExtraction: function (id, procedures) {
      var body = procedures.map(serializeProcedure);
      if (config.USE_MOCK) return App.mock.saveExtraction(id, body);
      // Le backend attend un objet { payload: [...] }, pas un tableau nu.
      return request('/admin/extractions/' + encodeURIComponent(id), {
        method: 'PUT',
        json: { payload: body }
      });
    },

    approveExtraction: function (id) {
      if (config.USE_MOCK) return App.mock.approveExtraction(id);
      return request('/admin/extractions/' + encodeURIComponent(id) + '/approve', { method: 'POST' });
    },

    /* --- Authentification ------------------------------------------------

       Le jeton n'apparait nulle part ici : le serveur le pose dans un cookie
       HttpOnly a la connexion, le navigateur le renvoie seul (voir
       « credentials: include » dans request()), et seul POST /auth/logout peut
       l'effacer. Ces fonctions ne manipulent que des identites. */

    /* Verification de session, appelee une fois au demarrage. Un 401 est une
       reponse attendue — « personne n'est connecte » — et non une expiration :
       allowUnauthorized empeche la redirection automatique, qui bouclerait sur
       l'ecran de connexion. */
    getMe: function () {
      if (config.USE_MOCK) return App.mock.getMe().then(normalizeUser);
      return request('/citizen/me', { allowUnauthorized: true }).then(normalizeUser);
    },

    /* credentials : { userName, password }. Le mot de passe ne sort pas de cet
       objet : il part dans le corps de la requete et n'est ni conserve ni
       journalise. */
    login: function (credentials) {
      var body = {
        userName: credentials.userName,
        password: credentials.password
      };
      // Ici le 401 est le refus des identifiants, montre sur le formulaire.
      var promise = config.USE_MOCK
        ? App.mock.login(body)
        : request('/auth/login', { method: 'POST', json: body, allowUnauthorized: true });
      return promise.then(normalizeUser);
    },

    /* fields : { nom_user, prenom_user, userName, email_user, phone_user,
       password }. Le backend ne cree que des citoyens — il n'y a pas de champ
       « role » a envoyer. Un 409 (identifiant ou courriel deja pris) remonte
       avec son code, l'ecran le pose sur le champ concerne. */
    register: function (fields) {
      var body = {
        nom_user: fields.nom_user,
        prenom_user: fields.prenom_user,
        userName: fields.userName,
        email_user: fields.email_user,
        phone_user: fields.phone_user || null,
        password: fields.password
      };
      if (config.USE_MOCK) return App.mock.register(body);
      return request('/auth/register', { method: 'POST', json: body });
    },

    /* Statistiques du tableau de bord. Voir le commentaire de deriveStats pour
       la strategie de repli quand /admin/stats n'existe pas. */
    getStats: function () {
      if (config.USE_MOCK) {
        return App.mock.getStats().then(function (stats) {
          if (!stats.weekly && stats.daily) stats.weekly = weeklyBuckets(stats.daily);
          return stats;
        });
      }
      return request('/admin/stats').then(function (payload) {
        payload = payload || {};
        payload.partial = false;
        /* byAdministration arrive en { label, label_ar, value }, « label »
           etant le francais. Le graphique n'attend qu'un libelle : on choisit
           la langue ici plutot que dans charts.js, qui ne doit rien savoir du
           bilinguisme. */
        if (Array.isArray(payload.byAdministration)) {
          payload.byAdministration = payload.byAdministration.map(pickStatLabel);
        }
        if (!payload.weekly && payload.daily) payload.weekly = weeklyBuckets(payload.daily);
        return payload;
      }, function () {
        return api.listDocuments().then(deriveStats);
      });
    },

    /* Toutes les procedures, tous fichiers confondus — ecran « Procedures ».
       Le backend renvoie la forme « base de donnees » : voir mapStoredProcedure.
       Le filtrage reste fait cote client ; les parametres proc_title /
       proc_admin_name ne sont pas encore utilises. */
    listProcedures: function () {
      if (config.USE_MOCK) return App.mock.listProcedures();
      return request('/admin/procedures').then(function (payload) {
        var list = Array.isArray(payload) ? payload
          : (payload && (payload.procedures || payload.items || payload.results)) || [];
        /* mapStoredProcedure rend deja des chaines pretes a afficher : on ne
           repasse PAS par normalizeProcedure, qui fabrique les paires { fr, ar }
           de l'editeur — cet ecran ne fait que lire. */
        return list.map(function (raw, index) {
          var procedure = mapStoredProcedure(raw);
          // Rang dans la liste : sert de clé de dépliage quand le backend
          // n'expose pas de position dans le fichier d'origine.
          if (procedure.index === undefined || procedure.index === null) procedure.index = index;
          return procedure;
        });
      });
    },

    /* Marque une procédure obsolète — PATCH /admin/procedures/{id}/obsolete,
       sans corps. La ligne est conservée : c'est la voie normale quand une
       administration supprime une démarche, la suppression dure restant
       réservée aux procédures extraites par erreur.
       La réponse dit combien de citoyens suivent la procédure ; on la
       normalise en « affectedUsers » pour que l'écran n'ait pas à connaître
       le nom du champ. */
    markProcedureObsolete: function (id) {
      if (id === null || id === undefined || id === '') {
        return Promise.reject(new Error(
          'Cette procédure n\'a pas d\'identifiant : /admin/procedures doit renvoyer un champ « id ».'
        ));
      }
      var promise = config.USE_MOCK
        ? App.mock.markProcedureObsolete(id)
        : request('/admin/procedures/' + encodeURIComponent(id) + '/obsolete',
          { method: 'PATCH' });
      return promise.then(function (payload) {
        var count = payload
          ? firstDefined(payload, ['affected_users', 'affectedUsers', 'users'], 0) : 0;
        return { affectedUsers: Number(count) || 0 };
      });
    },

    /* Supprime une procédure — définitivement, et seulement pour celles
       extraites par erreur. Le backend refuse par un 409 tant qu'un citoyen
       la suit ; l'écran affiche alors son message sans proposer de forcer.
       Le backend est seul maître du fichier JSON : on ne réécrit pas
       l'extraction côté client. */
    deleteProcedure: function (id) {
      if (id === null || id === undefined || id === '') {
        return Promise.reject(new Error(
          'Cette procédure n\'a pas d\'identifiant : /admin/procedures doit renvoyer un champ « id ».'
        ));
      }
      var promise = config.USE_MOCK
        ? App.mock.deleteProcedure(id)
        : request('/admin/procedures/' + encodeURIComponent(id), { method: 'DELETE' });
      /* La reponse porte maintenant « deleted_fr » / « deleted_ar » et
         « administration_fr » / « administration_ar » la ou elle donnait
         « deleted » et « administration ». On la ramene a ce que l'ecran
         affiche : un titre et une administration, dans la langue courante. */
      return promise.then(function (payload) {
        payload = payload || {};
        return {
          deleted: pick(payload, 'deleted') || String(payload.deleted || ''),
          administration: pick(payload, 'administration') ||
            administrationName(payload.administration),
          etapes: Number(payload.etapes) || 0,
          pieces: Number(payload.pieces) || 0
        };
      });
    },

    /* Les administrations proprietaires des procedures — ecran
       « Administrations ». Le backend renvoie deja la liste triee par nom :
       on ne retrie pas cote client. */
    listAdministrations: function () {
      var promise = config.USE_MOCK ? App.mock.listAdministrations() : request('/admin/administrations');
      return promise.then(function (payload) {
        var list = Array.isArray(payload) ? payload
          : (payload && (payload.administrations || payload.items || payload.results)) || [];
        return list.map(normalizeAdministration);
      });
    },

    /* Remplacement complet : le backend attend toujours les trois champs, meme
       vides. Il n'y a ni creation ni suppression — une administration nait de
       l'import d'une procedure.
       En cas de doublon de nom le serveur repond 409 ; le message est celui du
       « detail » FastAPI et l'ecran l'affiche sur le champ « Nom ». */
    saveAdministration: function (id, data) {
      if (id === null || id === undefined || id === '') {
        return Promise.reject(new Error(
          'Cette administration n\'a pas d\'identifiant : /admin/administrations doit renvoyer un champ « id_administration ».'
        ));
      }
      /* Les deux noms partent ensemble, toujours : le backend remplace la
         ligne entiere, et n'envoyer que la langue affichee effacerait
         l'autre. */
      var body = {
        nom_administration_fr: String((data && data.nameFr) || '').trim(),
        nom_administration_ar: String((data && data.nameAr) || '').trim(),
        addr_administration: String((data && data.address) || '').trim(),
        url_administration: String((data && data.url) || '').trim()
      };
      var promise = config.USE_MOCK
        ? App.mock.saveAdministration(id, body)
        : request('/admin/administrations/' + encodeURIComponent(id), { method: 'PUT', json: body });
      return promise.then(function (payload) {
        // Le serveur renvoie l'administration mise a jour ; s'il se tait on
        // retombe sur ce qu'on vient d'envoyer pour rafraichir la ligne.
        return normalizeAdministration(payload || body);
      });
    },

    /* --- Comptes -----------------------------------------------------------
       Voir le contrat détaillé plus haut, au-dessus des normaliseurs. Les deux
       appels sont réservés aux administrateurs : le backend répond 403 aux
       autres, et le routeur n'y mène pas. */

    /* Le serveur trie déjà, le plus récent en tête : on garde son ordre. */
    listUsers: function () {
      var promise = config.USE_MOCK ? App.mock.listUsers() : request('/admin/users');
      return promise.then(function (payload) {
        var list = Array.isArray(payload) ? payload
          : (payload && (payload.users || payload.items || payload.results)) || [];
        return list.map(normalizeUserSummary);
      });
    },

    getUser: function (id) {
      if (id === null || id === undefined || id === '') {
        return Promise.reject(new Error(
          'Aucun identifiant de compte : impossible d\'ouvrir cette fiche.'
        ));
      }
      var promise = config.USE_MOCK
        ? App.mock.getUser(id)
        : request('/admin/users/' + encodeURIComponent(id));
      return promise.then(normalizeUserDetail);
    },

    /* Consommation quotidienne des « top » plus gros consommateurs sur les
       « days » derniers jours. Le serveur trie et complete les jours vides :
       on garde son ordre et ses points tels quels. */
    getTokensDaily: function (days, top) {
      var params = { days: Number(days) || 30, top: Number(top) || 10 };
      var promise = config.USE_MOCK
        ? App.mock.getTokensDaily(params)
        : request('/admin/tokens/daily' + queryString(params));

      return promise.then(function (payload) {
        payload = payload && typeof payload === 'object' ? payload : {};
        var list = Array.isArray(payload) ? payload
          : (payload.series || payload.items || payload.results) || [];
        return {
          days: Number(firstDefined(payload, ['days', 'jours'], params.days)) || params.days,
          series: list.map(normalizeTokenSeries)
        };
      });
    },

    /* --- Journal d'activité ------------------------------------------------
       GET /admin/logs, réservé aux administrateurs. Les filtres sont
       facultatifs : « action » et « user_id » sont des égalités strictes,
       « limit » vaut 100 côté serveur si on ne dit rien.
       Le serveur trie de la plus récente à la plus ancienne : on garde son
       ordre, c'est celui dans lequel un journal se lit. */
    listLogs: function (filters) {
      var promise = config.USE_MOCK
        ? App.mock.listLogs(filters || {})
        : request('/admin/logs' + queryString(filters));
      return promise.then(function (payload) {
        var list = Array.isArray(payload) ? payload
          : (payload && (payload.logs || payload.items || payload.results)) || [];
        return list.map(normalizeLog);
      });
    },

    /* --- Espace citoyen : assistant --------------------------------------
       Voir le contrat détaillé plus haut, au-dessus des normaliseurs. */

    listConversations: function () {
      var promise = config.USE_MOCK
        ? App.mock.listConversations()
        : request('/citizen/conversations');
      return promise.then(function (payload) {
        var list = Array.isArray(payload) ? payload
          : (payload && (payload.conversations || payload.items || payload.results)) || [];
        return list.map(normalizeConversation).sort(function (a, b) {
          // Plus récente en tête : le serveur n'est pas tenu de trier.
          return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
        });
      });
    },

    getConversation: function (id) {
      var promise = config.USE_MOCK
        ? App.mock.getConversation(id)
        : request('/citizen/conversations/' + encodeURIComponent(id));
      return promise.then(function (payload) {
        var conversation = normalizeConversation(payload);
        if (!conversation.messages) conversation.messages = [];
        return conversation;
      });
    },

    /* conversationId à null : la question ouvre une nouvelle discussion, et
       c'est le serveur qui lui donne son identifiant. Dans les deux cas on
       renvoie la même chose — { conversationId, title, message } — pour que
       l'écran n'ait pas deux chemins de rendu. */
    sendMessage: function (conversationId, question) {
      var promise;
      if (config.USE_MOCK) {
        promise = App.mock.sendMessage(conversationId, question);
      } else if (conversationId) {
        promise = request(
          '/citizen/conversations/' + encodeURIComponent(conversationId) + '/messages',
          { method: 'POST', json: { question: question } }
        );
      } else {
        promise = request('/citizen/conversations',
          { method: 'POST', json: { question: question } });
      }

      return promise.then(function (payload) {
        payload = payload || {};

        // Réponse « discussion complète » (création) : on prend le dernier
        // message, qui est la réponse à la question qu'on vient d'envoyer.
        if (Array.isArray(payload.messages)) {
          var conversation = normalizeConversation(payload);
          var answers = conversation.messages.filter(function (message) {
            return message.role === 'assistant';
          });
          return {
            conversationId: conversation.id,
            title: conversation.title,
            message: answers[answers.length - 1] || null
          };
        }

        var id = firstDefined(payload,
          ['conversation_id', 'conversationId', 'id'], conversationId);
        if (id === null || id === undefined || id === '') {
          throw new Error(
            'Réponse acceptée mais le serveur n\'a pas renvoyé d\'identifiant de discussion.'
          );
        }
        // /ask pose « lang » a plat, a cote de « answer » ; si la reponse est
        // enveloppee dans « message » sans sa propre langue, on la reprend la.
        var message = normalizeMessage(payload.message || payload);
        if (!message.lang) message.lang = normalizeLang(payload.lang);
        return {
          conversationId: String(id),
          title: payload.title || null,
          message: message
        };
      });
    },

    /* Supprime une discussion et tous ses messages. Le serveur répond 204 :
       il n'y a rien à normaliser, seul l'aboutissement compte. */
    deleteConversation: function (id) {
      if (id === null || id === undefined || id === '') {
        return Promise.reject(new Error(
          'Cette discussion n\'a pas d\'identifiant : impossible de la supprimer.'
        ));
      }
      if (config.USE_MOCK) return App.mock.deleteConversation(id);
      return request('/citizen/conversations/' + encodeURIComponent(id), { method: 'DELETE' });
    },

    /* --- Espace citoyen : suivi des procédures ---------------------------- */

    listTracked: function () {
      var promise = config.USE_MOCK ? App.mock.listTracked() : request('/citizen/tracked');
      return promise.then(function (payload) {
        var list = Array.isArray(payload) ? payload
          : (payload && (payload.tracked || payload.items || payload.results)) || [];
        return list.map(normalizeTracked);
      });
    },

    /* « lang » : la langue dans laquelle la procédure sera affichée dans
       « Mes procédures » — celle de la réponse d'où on la suit. Sans
       précision, la langue de l'interface. */
    trackProcedure: function (procedureId, lang) {
      if (procedureId === null || procedureId === undefined || procedureId === '') {
        return Promise.reject(new Error(
          'Cette source n\'a pas d\'identifiant de procédure : impossible de la suivre.'
        ));
      }
      lang = App.helpers.contentLang(lang);
      var promise = config.USE_MOCK
        ? App.mock.trackProcedure(procedureId, lang)
        : request('/citizen/tracked',
            { method: 'POST', json: { id_procedure: procedureId, lang: lang } });
      return promise.then(normalizeTracked);
    },

    /* Cherche les bureaux de cette administration autour d'un point. L'appel
       est long — géocodage inverse, puis recherche web, puis rédaction : cinq à
       quinze secondes. L'écran appelant doit donc dire l'attente, pas seulement
       la faire tourner.

       404 administration inconnue, 502 localisation non reconnue : les deux
       remontent avec le message du serveur, il est plus précis que ce qu'on
       inventerait ici. */
    findNearbyOffices: function (adminId, lat, lon) {
      if (adminId === null || adminId === undefined || adminId === '') {
        return Promise.reject(new Error(
          'Cette procédure n\'indique aucune administration : impossible de ' +
          'chercher un bureau.'
        ));
      }
      if (typeof lat !== 'number' || typeof lon !== 'number' ||
          isNaN(lat) || isNaN(lon)) {
        return Promise.reject(new Error('Coordonnées manquantes ou invalides.'));
      }

      var promise = config.USE_MOCK
        ? App.mock.findNearbyOffices(adminId, lat, lon)
        : request('/citizen/administrations/' + encodeURIComponent(adminId) +
            '/nearby' + queryString({ lat: lat, lon: lon }));
      return promise.then(normalizeNearby);
    },

    untrackProcedure: function (trackingId) {
      if (config.USE_MOCK) return App.mock.untrackProcedure(trackingId);
      return request('/citizen/tracked/' + encodeURIComponent(trackingId), { method: 'DELETE' });
    },

    /* Coche une pièce et/ou enregistre sa note. Le serveur renvoie le document
       mis à jour : c'est lui qui fait foi sur la case, l'écran s'y réaligne
       après coup (et revient en arrière si l'appel échoue).

       Le suivi n'est pas dans le chemin — « id_upd » désigne déjà la ligne —
       mais il reste en paramètre pour le mode démonstration, qui cherche la
       pièce à l'intérieur du suivi. */
    updateTrackedPiece: function (trackingId, pieceId, changes) {
      var body = {};      // corps envoyé au serveur
      var demo = {};      // mêmes valeurs, aux noms attendus par le mode démonstration
      if (changes && changes.checked !== undefined) {
        body.est_coche = changes.checked === true;
        demo.checked = changes.checked === true;
      }
      if (changes && changes.note !== undefined) {
        body.note = String(changes.note);
        demo.note = String(changes.note);
      }

      var promise = config.USE_MOCK
        ? App.mock.updateTrackedPiece(trackingId, pieceId, demo)
        : request('/citizen/tracked/documents/' + encodeURIComponent(pieceId),
            { method: 'PATCH', json: body });
      return promise.then(function (payload) {
        return normalizeUpdatedPiece(payload, pieceId);
      });
    },

    /* Ferme la session cote serveur. Un cookie HttpOnly ne peut pas etre efface
       par le JavaScript de la page : sans cet appel, le jeton resterait valide.
       L'appelant vide ensuite App.auth et repart sur l'ecran de connexion.
       allowUnauthorized : se deconnecter d'une session deja expiree n'a pas a
       declencher le message « votre session a expire ». */
    logout: function () {
      if (config.USE_MOCK) return App.mock.logout();
      return request('/auth/logout', { method: 'POST', allowUnauthorized: true });
    }
  };

  App.api = api;
})(window);
