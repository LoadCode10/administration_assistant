/* Backend factice en mémoire.
   Actif seulement si App.config.USE_MOCK est true — sert à ouvrir index.html
   sans FastAPI pour vérifier l'interface. Aucune donnée n'est persistée. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});

  var nextId = 100;
  var extractions = {};
  var documents = [];

  /* Les administrations, telles que les renverrait GET /admin/administrations :
     deja triees par nom. L'adresse et le site manquent souvent — c'est
     precisement le trou que l'ecran « Administrations » sert a combler.
     « CNSS » et « C.N.S.S. » sont volontairement presque homonymes : c'est le
     cas qui declenche le 409 quand on renomme l'une en l'autre. */
  var administrations = [
    {
      id_administration: 'a1',
      nom_administration: 'Agence urbaine de Casablanca',
      addr_administration: null,
      url_administration: null,
      procedure_count: 4
    },
    {
      id_administration: 'a2',
      nom_administration: 'C.N.S.S.',
      addr_administration: null,
      url_administration: null,
      procedure_count: 1
    },
    {
      id_administration: 'a3',
      nom_administration: 'Centre régional d\'investissement',
      addr_administration: '12 rue Al Abtal, Hay Riad, Rabat',
      url_administration: 'https://cri.ma',
      procedure_count: 8
    },
    {
      id_administration: 'a4',
      nom_administration: 'CNSS',
      addr_administration: 'Boulevard Abdelmoumen, Casablanca',
      url_administration: 'https://www.cnss.ma',
      procedure_count: 6
    },
    {
      id_administration: 'a5',
      nom_administration: 'NARSA',
      addr_administration: null,
      url_administration: null,
      procedure_count: 3
    }
  ];

  /* --- Comptes, tels que les renverrait GET /admin/users -------------------

     Deja tries, le plus recent inscrit en tete : c'est le serveur qui trie,
     l'ecran garde son ordre. Le jeu d'essai couvre les cas qui font bouger
     l'affichage — un administrateur (pastille distincte), un compte sans
     aucune procedure suivie (etat vide de la fiche), un compte qui en suit
     plusieurs a des statuts differents, et deux inscriptions recentes pour
     que la date s'ecrive en relatif.

     « u1 » et « u2 » sont les deux comptes de connexion declares plus haut :
     se voir soi-meme dans la liste evite de croire qu'elle est incomplete. */
  var users = [
    {
      id_user: 'u6',
      nom_user: 'Alaoui',
      prenom_user: 'Yassine',
      email_user: 'yassine.alaoui@example.ma',
      userName_user: 'yalaoui',
      role_user: 'citizen',
      creation_date: hoursAgo(5),
      conversations_count: 1,
      tracked_procs: []
    },
    {
      id_user: 'u5',
      nom_user: 'Ouazzani',
      prenom_user: 'Nadia',
      email_user: 'nadia.ouazzani@example.ma',
      userName_user: 'nouazzani',
      role_user: 'citizen',
      creation_date: hoursAgo(52),
      conversations_count: 4,
      tracked_procs: [
        {
          id_up: 'up51',
          status: 'en_cours',
          titre_proc: 'Création d\'une SARL',
          administration: 'Centre régional d\'investissement'
        }
      ]
    },
    {
      id_user: 'u4',
      nom_user: 'Benjelloun',
      prenom_user: 'Karim',
      email_user: 'karim.benjelloun@example.ma',
      userName_user: 'kbenjelloun',
      role_user: 'admin',
      creation_date: '2026-07-14T09:12:03',
      conversations_count: 0,
      tracked_procs: []
    },
    {
      id_user: 'u3',
      nom_user: 'Idrissi',
      prenom_user: 'Fatima Zahra',
      email_user: 'fz.idrissi@example.ma',
      userName_user: 'fzidrissi',
      role_user: 'citizen',
      creation_date: '2026-06-02T18:44:21',
      conversations_count: 9,
      // Plusieurs suivis, statuts melanges, et une administration nulle :
      // c'est la fiche qui exerce tout l'ecran de detail d'un coup.
      tracked_procs: [
        {
          id_up: 'up31',
          status: 'termine',
          titre_proc: 'Demande d\'un extrait d\'acte de naissance',
          administration: 'Bureau d\'état civil'
        },
        {
          id_up: 'up32',
          status: 'en_cours',
          titre_proc: 'Immatriculation d\'un salarié à la CNSS',
          administration: 'CNSS'
        },
        {
          id_up: 'up33',
          status: 'en_cours',
          titre_proc: 'Renouvellement du permis de conduire',
          administration: null
        },
        {
          id_up: 'up34',
          status: 'termine',
          titre_proc: 'Autorisation de construire',
          administration: 'Agence urbaine de Casablanca'
        }
      ]
    },
    {
      id_user: 'u2',
      nom_user: 'Bennani',
      prenom_user: 'Salma',
      email_user: 'salma.bennani@example.ma',
      userName_user: 'citoyen',
      role_user: 'citizen',
      creation_date: '2026-04-21T11:05:00',
      conversations_count: 3,
      tracked_procs: [
        {
          id_up: 'up21',
          status: 'en_cours',
          titre_proc: 'Création d\'une SARL',
          administration: 'Centre régional d\'investissement'
        }
      ]
    },
    {
      id_user: 'u1',
      nom_user: 'Hamza',
      prenom_user: 'Mehdi',
      email_user: 'mehdihamza322@gmail.com',
      userName_user: 'admin',
      role_user: 'admin',
      creation_date: '2026-01-09T08:30:00',
      conversations_count: 0,
      tracked_procs: []
    }
  ];

  var activity = {};   // { 'AAAA-MM-JJ': nombre de documents importes }

  /* --- Comptes et session factices ---------------------------------------

     DIVERGENCE ASSUMEE AVEC LE FLUX REEL. En vrai, le jeton est un cookie
     HttpOnly pose par le serveur : le frontend ne le voit jamais et la session
     survit a un rechargement de page. Ici, rien ne peut poser de cookie — on
     retient donc simplement, en memoire, quel compte est connecte. Trois
     consequences a garder en tete en relisant l'interface en mode
     demonstration :

       - un rechargement (F5) deconnecte, alors qu'il ne devrait pas ;
       - le cote serveur ne verifie rien : « session » ci-dessous EST la
         verite, alors qu'en reel c'est le cookie qui l'est ;
       - GET /citizen/me rejoue quand meme le 401 quand personne n'est
         connecte, parce que c'est ce que le routeur et App.auth lisent.

     Deux comptes sont amorces, un par role, pour que les deux tableaux de bord
     soient relisibles. Les mots de passe ne sont evidemment que des mots de
     passe de demonstration.

       admin   / demo1234   -> console d'administration
       citoyen / demo1234   -> espace citoyen */
  var accounts = [
    {
      id_user: 'u1',
      userName: 'admin',
      password: 'demo1234',
      nom_user: 'Hamza',
      prenom_user: 'Mehdi',
      email_user: 'mehdihamza322@gmail.com',
      phone_user: null,
      role: 'admin'
    },
    {
      id_user: 'u2',
      userName: 'citoyen',
      password: 'demo1234',
      nom_user: 'Bennani',
      prenom_user: 'Salma',
      email_user: 'salma.bennani@example.ma',
      phone_user: '0612345678',
      role: 'citizen'
    }
  ];

  // Le compte connecte, ou null. Tient lieu de cookie : voir ci-dessus.
  var session = null;

  // L'identite telle que la renvoie le backend : sans le mot de passe.
  function publicUser(account) {
    return {
      id_user: account.id_user,
      nom_user: account.nom_user,
      prenom_user: account.prenom_user,
      email_user: account.email_user,
      role: account.role
    };
  }

  function findAccount(key, value) {
    var needle = String(value === null || value === undefined ? '' : value).toLowerCase();
    return accounts.filter(function (account) {
      return String(account[key]).toLowerCase() === needle;
    })[0] || null;
  }

  function dayKey(date) {
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }

  /* Historique sur exactement 12 semaines — la meme fenetre que l'aire du
     tableau de bord, pour que la tuile « Documents traites » et le graphique
     donnent le meme total au lieu de deux chiffres qui se contredisent.
     Generateur congruentiel a graine fixe : deux chargements donnent la meme
     image, sinon impossible de comparer deux captures d'ecran. */
  function seedActivity() {
    var rng = 20260831;
    function next() {
      rng = (rng * 1103515245 + 12345) % 2147483648;
      return rng / 2147483648;
    }

    var monday = new Date();
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    // Debut de la 12e semaine en arriere, lundi.
    var start = new Date(monday);
    start.setDate(start.getDate() - 11 * 7);

    var today = new Date();
    today.setHours(0, 0, 0, 0);

    for (var day = new Date(start); day <= today; day.setDate(day.getDate() + 1)) {
      var weekday = day.getDay();
      // Creux le week-end : une console d'administration suit les jours ouvres.
      var base = (weekday === 0 || weekday === 6) ? 0.18 : 1.0;
      var draw = next();
      var count = draw < (0.30 / base) ? 0 : Math.round(draw * 6 * base);
      if (count > 0) activity[dayKey(day)] = count;
    }
  }

  /* Jeu d'essai trilingue.

     Le backend ne garantit pas la langue du contenu : un document source peut
     être arabe, français ou anglais, et l'administrateur peut saisir des
     notations arabes dans un dossier par ailleurs français. Les extractions
     ci-dessous couvrent les quatre cas, y compris le mélange à l'intérieur
     d'une même procédure (titre arabe, administration française, frais en
     chiffres latins). */
  /* Recueil volumineux : donne du relief au classement par administration
     (sinon chaque administration n'a qu'une procedure et toutes les barres du
     tableau de bord sortent identiques), et fait passer l'editeur au-dessus de
     EDITOR_PAGE_SIZE pour exercer sa pagination. */
  function seedBulk() {
    var spread = [
      ['Bureau d\'état civil', 6, 'Extrait d\'acte'],
      ['Centre régional d\'investissement', 5, 'Formalité entreprise'],
      ['مكتب الحالة المدنية', 4, 'وثيقة إدارية'],
      ['Tribunal de première instance', 3, 'Requête judiciaire'],
      ['الجماعة الحضرية / Commune urbaine', 3, 'Autorisation communale'],
      ['Autorité locale', 2, 'Attestation locale'],
      ['NARSA', 1, 'Titre de conduite']
    ];

    var procedures = [];
    spread.forEach(function (entry) {
      var administration = entry[0], count = entry[1], stem = entry[2];
      for (var n = 1; n <= count; n++) {
        procedures.push({
          proc_title: stem + ' — dossier type n° ' + n,
          proc_description: null,
          proc_administration: [administration],
          proc_pieces: ['Copie de la CIN'].concat(
            n % 2 ? ['Formulaire de demande'] : ['Timbre fiscal', 'Justificatif de domicile']),
          proc_steps: ['Déposer le dossier'].concat(n % 3 ? [] : ['Retirer le récépissé']),
          proc_law: [],
          fee: n % 2 ? null : (20 * n) + ' DH',
          proc_delai: null,
          // Un dossier sur quatre est perime : de quoi voir le filtre
          // « afficher les obsoletes » agir sur une liste longue.
          statut_proc: n % 4 === 0 ? 'obsolete' : 'active',
          date_obsolete: n % 4 === 0 ? hoursAgo(24 * (3 * n + 2)) : null
        });
      }
    });

    extractions['bulk1'] = {
      filename: 'extraction_recueil_administratif.json',
      procedures: procedures
    };
    return procedures.length;
  }

  function seed() {
    seedActivity();


    /* --- Français : cas de référence -------------------------------------- */
    extractions['e1'] = {
      filename: 'extraction_formalites.json',
      procedures: [
        {
          proc_title: 'Création d\'une SARL',
          proc_description: 'Formalités de constitution d\'une société à responsabilité limitée.',
          proc_administration: ['Centre régional d\'investissement'],
          proc_pieces: ['Certificat négatif', 'Statuts signés', 'Copie de la CIN des associés'],
          proc_steps: ['Obtenir le certificat négatif', 'Déposer les statuts', 'Immatriculer au registre du commerce'],
          proc_law: ['Loi n° 5-96 sur la société à responsabilité limitée'],
          fee: '350 DH',
          proc_delai: '5 jours'
        }
      ]
    };

    /* --- Français avec champs manquants ----------------------------------- */
    extractions['e2'] = {
      filename: 'extraction_etat_civil.json',
      procedures: [
        {
          proc_title: 'Demande d\'extrait d\'acte de naissance',
          proc_description: 'Obtenir une copie officielle de l\'acte de naissance.',
          proc_administration: ['Bureau d\'état civil'],
          proc_pieces: ['Copie de la carte nationale d\'identité', 'Informations d\'état civil'],
          proc_steps: ['Se présenter au bureau d\'état civil du lieu de naissance'],
          proc_law: ['Loi n° 37-99 relative à l\'état civil'],
          fee: null,
          proc_delai: null
        },
        {
          proc_title: 'Demande de fiche anthropométrique',
          proc_description: null,
          proc_administration: ['Tribunal de première instance'],
          proc_pieces: ['Copie de la CIN', 'Timbre fiscal', 'Formulaire de demande'],
          proc_steps: ['Retirer le formulaire', 'Déposer le dossier'],
          proc_law: [],
          fee: '20 DH',
          proc_delai: null
        },
        {
          proc_title: 'Certificat de résidence',
          statut_proc: 'active',
          proc_administration: ['Autorité locale'],
          proc_pieces: ['Copie de la CIN', 'Justificatif de domicile'],
          proc_steps: ['Se présenter au caïdat'],
          fee: null
        },
        {
          proc_title: 'Légalisation de signature',
          // Demarche supprimee par l'administration : la ligne reste, marquee.
          statut_proc: 'obsolete',
          date_obsolete: hoursAgo(24 * 12),
          proc_administration: [],
          proc_pieces: ['Document à légaliser', 'Copie de la CIN'],
          proc_steps: ['Se présenter à l\'arrondissement'],
          fee: null
        }
      ]
    };

    /* --- Arabe intégral (RTL) ---------------------------------------------
       Vérifie : titres repliés et leur ellipsis, listes numérotées, champ
       « administration » manquant sous un titre arabe, et surtout la vue
       « JSON brut » qui doit rester structurée de gauche à droite. */
    extractions['ar1'] = {
      filename: 'استخراج_الحالة_المدنية.json',
      procedures: [
        {
          proc_title: 'طلب نسخة من رسم الولادة',
          proc_description: 'الحصول على نسخة رسمية من رسم الولادة من مكتب الحالة المدنية.',
          proc_administration: ['مكتب الحالة المدنية'],
          proc_pieces: ['نسخة من البطاقة الوطنية للتعريف', 'معلومات الحالة المدنية للمعني بالأمر'],
          proc_steps: [
            'التوجه إلى مكتب الحالة المدنية لمكان الازدياد',
            'ملء مطبوع الطلب وتقديمه للموظف المختص',
            'أداء الرسوم وسحب النسخة'
          ],
          proc_law: ['القانون رقم 37.99 المتعلق بالحالة المدنية'],
          fee: '20 درهم',
          proc_delai: 'يوم واحد'
        },
        {
          proc_title: 'شهادة السكنى',
          proc_description: 'إثبات محل الإقامة لدى السلطة المحلية.',
          proc_administration: ['السلطة المحلية (القيادة)'],
          proc_pieces: ['نسخة من البطاقة الوطنية', 'شهادة شاهدين من الحي'],
          proc_steps: ['التوجه إلى مقر القيادة', 'الإدلاء بالشهود وتوقيع المطبوع'],
          proc_law: [],
          fee: null,
          proc_delai: '48 ساعة'
        },
        {
          // Administration vide : l'avertissement français doit s'afficher
          // proprement sous un champ arabe.
          proc_title: 'تصحيح خطأ في رسم الولادة',
          proc_description: null,
          proc_administration: [],
          proc_pieces: ['رسم الولادة الأصلي', 'الوثائق المثبتة للتصحيح'],
          proc_steps: ['تقديم طلب إلى المحكمة الابتدائية'],
          proc_law: ['القانون رقم 37.99'],
          fee: null,
          proc_delai: null
        }
      ]
    };

    /* --- Mélange à l'intérieur d'une même procédure ------------------------
       Le cas le plus exigeant : le sens de lecture change d'un champ à l'autre,
       et parfois d'un élément de liste au suivant. C'est ce que produit un
       administrateur qui annote en arabe un dossier tenu en français. Sans
       isolation bidirectionnelle, la ponctuation part à la mauvaise extrémité. */
    extractions['mx1'] = {
      filename: 'extraction_mixte_urbanisme.json',
      procedures: [
        {
          proc_title: 'رخصة البناء — Permis de construire',
          proc_description: 'Dossier déposé auprès de la commune. المسطرة تستغرق شهرا واحدا.',
          proc_administration: ['الجماعة الحضرية / Commune urbaine'],
          proc_pieces: [
            'Plan architectural visé par l\'architecte',
            'نسخة من التصميم الطبوغرافي',
            'Titre foncier (شهادة الملكية)',
            'Copie de la CIN'
          ],
          proc_steps: [
            'إيداع الملف لدى شباك الجماعة',
            'Passage en commission technique',
            'سحب الرخصة بعد الموافقة'
          ],
          proc_law: [
            'Loi n° 12-90 relative à l\'urbanisme',
            'القانون رقم 12.90 المتعلق بالتعمير'
          ],
          fee: '1 200 DH (1200 درهم)',
          proc_delai: 'شهر واحد (30 jours)'
        },
        {
          // Titre latin mais contenu arabe : chaque champ doit résoudre son
          // sens séparément, et non une fois pour toute la procédure.
          proc_title: 'Certificat négatif',
          proc_description: 'الشهادة السلبية لحجز اسم الشركة.',
          proc_administration: ['OMPIC'],
          proc_pieces: ['نسخة من البطاقة الوطنية', 'Trois propositions de dénomination'],
          proc_steps: ['Dépôt en ligne sur directinfo.ma', 'أداء الرسوم إلكترونيا'],
          proc_law: [],
          fee: '230 DH',
          proc_delai: '24 h'
        }
      ]
    };

    /* --- Anglais ----------------------------------------------------------- */
    extractions['en1'] = {
      filename: 'business_registration_en.json',
      procedures: [
        {
          proc_title: 'Register a branch office of a foreign company',
          proc_description: 'Registration of a branch for a company incorporated abroad.',
          proc_administration: ['Regional Investment Centre'],
          proc_pieces: [
            'Certified copy of the parent company statutes',
            'Board resolution appointing the branch manager',
            'Proof of a registered address in Morocco'
          ],
          proc_steps: [
            'File the negative certificate request',
            'Register with the Commercial Court',
            'Publish the incorporation notice in a legal gazette'
          ],
          proc_law: ['Law No. 15-95 forming the Commercial Code'],
          fee: 'MAD 1,000',
          proc_delai: '10 working days'
        }
      ]
    };

    var bulkCount = seedBulk();

    documents = [
      {
        id: 'd1', kind: 'document', filename: 'formalites_entreprise.txt',
        created_at: '2026-08-28T09:12:00Z', status: 'published',
        extraction_id: 'e1', extraction_filename: 'extraction_formalites.json',
        procedure_count: 1
      },
      {
        id: 'd2', kind: 'document', filename: 'etat_civil_2026.pdf',
        created_at: '2026-08-30T08:40:00Z', status: 'pending_review',
        extraction_id: 'e2', extraction_filename: 'extraction_etat_civil.json',
        procedure_count: 4
      },
      {
        // Nom de fichier arabe : rendu RTL dans la liste, dans le lien de
        // retour de l'éditeur, et dans la ligne du fichier JSON associé.
        id: 'd5', kind: 'document', filename: 'الحالة_المدنية_2026.pdf',
        created_at: '2026-08-31T07:15:00Z', status: 'pending_review',
        extraction_id: 'ar1', extraction_filename: 'استخراج_الحالة_المدنية.json',
        procedure_count: 3
      },
      {
        // Titre arabe porté par un nom de fichier latin — cas fréquent.
        id: 'd6', kind: 'document', filename: 'permis_construire_2026.pdf',
        titre: 'رخصة البناء — dossier communal',
        created_at: '2026-08-31T06:05:00Z', status: 'pending_review',
        extraction_id: 'mx1', extraction_filename: 'extraction_mixte_urbanisme.json',
        procedure_count: 2
      },
      {
        id: 'i7', kind: 'import', filename: 'business_registration_en.json',
        created_at: '2026-08-29T11:30:00Z', status: 'published',
        extraction_id: 'en1', extraction_filename: 'business_registration_en.json',
        procedure_count: 1
      },
      {
        id: 'd3', kind: 'document', filename: 'permis_conduire.pdf',
        created_at: '2026-08-30T10:02:00Z', status: 'extracting',
        extraction_id: null, extraction_filename: null, procedure_count: 0
      },
      {
        // Message d'erreur renvoyé en arabe par le backend.
        id: 'd8', kind: 'document', filename: 'الجمارك_2025.pdf',
        created_at: '2026-08-27T16:20:00Z', status: 'failed',
        error: 'تعذرت قراءة الوثيقة: ملف PDF ممسوح ضوئيا بدون طبقة نصية.',
        extraction_id: null, extraction_filename: null, procedure_count: 0
      },
      {
        // Volumineux : 24 procedures, au-dela de EDITOR_PAGE_SIZE (20).
        id: 'd9', kind: 'document', filename: 'recueil_administratif_2026.pdf',
        titre: 'Recueil des formalités courantes',
        created_at: '2026-08-26T09:00:00Z', status: 'pending_review',
        extraction_id: 'bulk1',
        extraction_filename: 'extraction_recueil_administratif.json',
        procedure_count: bulkCount
      },
      {
        id: 'd4', kind: 'document', filename: 'douanes_2025.pdf',
        created_at: '2026-08-27T16:20:00Z', status: 'failed',
        error: 'Le document est illisible (PDF scanné sans texte).',
        extraction_id: null, extraction_filename: null, procedure_count: 0
      }
    ];

    // L'extraction du document 3 « se termine » au bout de 12 secondes.
    setTimeout(function () {
      var doc = documents.filter(function (d) { return d.id === 'd3'; })[0];
      if (!doc || doc.status !== 'extracting') return;
      extractions['e3'] = {
        filename: 'extraction_permis_conduire.json',
        procedures: [{
          proc_title: 'Renouvellement du permis de conduire',
          proc_description: 'Renouveler un permis arrivé à expiration.',
          proc_administration: ['NARSA'],
          proc_pieces: ['Ancien permis', 'Copie de la CIN', 'Photo d\'identité'],
          proc_steps: ['Prendre rendez-vous en ligne', 'Déposer le dossier'],
          proc_law: [],
          fee: '120 DH', proc_delai: '15 jours'
        }]
      };
      doc.status = 'pending_review';
      doc.extraction_id = 'e3';
      doc.extraction_filename = 'extraction_permis_conduire.json';
      doc.procedure_count = 1;
    }, 12000);
  }

  /* ===========================================================================
     ESPACE CITOYEN — assistant et suivi

     Aucun de ces points d'entree n'existe encore cote FastAPI : ce qui suit est
     la seule implementation disponible, et c'est elle qui sert a construire et
     relire les deux ecrans citoyens. Le contrat rejoue est celui documente dans
     api.js, au-dessus des normaliseurs.
     =========================================================================== */

  var conversations = [];   // { id, title, updated_at, messages: [...] }
  var tracked = [];         // suivis, forme /citizen/tracked
  var nextCitizenId = 1;

  /* Retrouve une procedure par l'identifiant factice « extractionId:index »
     que listProcedures fabrique — les sources de l'assistant pointent sur de
     vraies procedures du jeu d'essai, pas sur des titres inventes. */
  function findProcedure(procedureId) {
    var parts = String(procedureId).split(':');
    var extraction = extractions[parts[0]];
    var index = Number(parts[1]);
    if (!extraction || isNaN(index)) return null;
    var procedure = extraction.procedures[index];
    return procedure ? { id: String(procedureId), procedure: procedure } : null;
  }

  function sourceOf(procedureId) {
    var found = findProcedure(procedureId);
    if (!found) return null;
    return {
      procedure_id: found.id,
      procedure_title: found.procedure.proc_title,
      administration: (found.procedure.proc_administration || [])[0] || ''
    };
  }

  function sourcesOf(ids) {
    return ids.map(sourceOf).filter(function (source) { return source; });
  }

  /* Reponses pretes a l'emploi. La langue suit celle de la question : c'est le
     cas reel — le meme assistant repond en arabe a une question arabe — et
     c'est ce qui exerce le dir="auto" pose sur les bulles. */
  var ANSWERS = {
    fr: 'Pour cette démarche, vous devez réunir les pièces listées ci-dessous puis ' +
      'vous présenter au guichet de l\'administration concernée. Le dossier est ' +
      'instruit sur place ; le délai courant est de quelques jours ouvrables. ' +
      'Les procédures ci-dessous correspondent à votre question — vous pouvez en ' +
      'suivre une pour cocher les pièces au fur et à mesure.',
    ar: 'للقيام بهذه المسطرة، عليك تجميع الوثائق المطلوبة أدناه ثم التوجه إلى شباك ' +
      'الإدارة المعنية. تتم دراسة الملف في عين المكان، والأجل المعتاد هو بضعة أيام ' +
      'عمل. المساطر المذكورة أسفله تتعلق بسؤالك، ويمكنك متابعة إحداها لتتبع الوثائق ' +
      'واحدة تلو الأخرى.',
    en: 'For this procedure you need to gather the documents listed below and then ' +
      'go to the counter of the relevant administration. The file is reviewed on ' +
      'the spot; the usual processing time is a few working days. The procedures ' +
      'below match your question — you can track one to tick off the documents as ' +
      'you collect them.'
  };

  var ENGLISH_HINTS = /\b(the|how|what|where|register|company|document|need|apply)\b/i;

  function answerLanguage(question) {
    // Un seul caractere arabe suffit : une question arabe n'est jamais ecrite
    // en caracteres latins.
    if (/[؀-ۿ]/.test(question)) return 'ar';
    if (ENGLISH_HINTS.test(question) && !/[àâçéèêëîïôûùüÿœ]/i.test(question)) return 'en';
    return 'fr';
  }

  /* Sources choisies d'apres quelques mots-cles de la question. Une recherche
     factice, mais qui rend la liste credible : demander « SARL » ne doit pas
     renvoyer l'acte de naissance. */
  var TOPICS = [
    { keys: /soci|sarl|entrepr|company|business|شركة/i, sources: ['e1:0', 'en1:0', 'mx1:1'] },
    { keys: /naissan|acte|état civil|etat civil|ولادة|الحالة المدنية/i, sources: ['e2:0', 'ar1:0'] },
    { keys: /construir|urbanis|permis|بناء|رخصة/i, sources: ['mx1:0'] },
    { keys: /résidence|residence|domicile|سكنى/i, sources: ['e2:2', 'ar1:1'] }
  ];

  function pickSources(question) {
    for (var i = 0; i < TOPICS.length; i++) {
      if (TOPICS[i].keys.test(question)) return sourcesOf(TOPICS[i].sources);
    }
    return sourcesOf(['e1:0', 'e2:0']);
  }

  function citizenMessage(role, content, sources) {
    return {
      id: 'm' + (nextCitizenId++),
      role: role,
      content: content,
      created_at: new Date().toISOString(),
      sources: sources || []
    };
  }

  function conversationSummary(conversation) {
    return {
      id: conversation.id,
      title: conversation.title,
      updated_at: conversation.updated_at
    };
  }

  function hoursAgo(hours) {
    return new Date(Date.now() - hours * 3600 * 1000).toISOString();
  }

  /* Un historique deja fourni : sans lui la colonne des discussions s'ouvre
     vide et on ne voit ni le classement par date ni la troncature des titres. */
  function seedCitizen() {
    var q1 = 'Quels documents faut-il pour créer une SARL au Maroc, et combien de temps cela prend-il ?';
    var q2 = 'ما هي الوثائق المطلوبة للحصول على نسخة من رسم الولادة؟';
    var q3 = 'How do I register a branch office of a foreign company?';

    conversations = [
      {
        id: 'c1', title: q1, updated_at: hoursAgo(2),
        messages: [
          { id: 'm901', role: 'user', content: q1, created_at: hoursAgo(2), sources: [] },
          { id: 'm902', role: 'assistant', content: ANSWERS.fr,
            created_at: hoursAgo(2), sources: sourcesOf(['e1:0', 'en1:0']) }
        ]
      },
      {
        id: 'c2', title: q2, updated_at: hoursAgo(30),
        messages: [
          { id: 'm903', role: 'user', content: q2, created_at: hoursAgo(30), sources: [] },
          { id: 'm904', role: 'assistant', content: ANSWERS.ar,
            created_at: hoursAgo(30), sources: sourcesOf(['ar1:0', 'e2:0']) }
        ]
      },
      {
        id: 'c3', title: q3, updated_at: hoursAgo(24 * 9),
        messages: [
          { id: 'm905', role: 'user', content: q3, created_at: hoursAgo(24 * 9), sources: [] },
          { id: 'm906', role: 'assistant', content: ANSWERS.en,
            created_at: hoursAgo(24 * 9), sources: sourcesOf(['en1:0']) }
        ]
      }
    ];

    // Un suivi deja commence, une piece cochee : la barre de progression n'est
    // ni a 0 % ni a 100 % au premier chargement.
    var started = buildTracked('e1:0');
    if (started) {
      started.created_at = hoursAgo(48);
      if (started.pieces[0]) {
        started.pieces[0].checked = true;
        started.pieces[0].note = 'Retiré au CRI le 3 septembre.';
      }
      tracked = [started];
    }
  }

  function buildTracked(procedureId) {
    var found = findProcedure(procedureId);
    if (!found) return null;
    var procedure = found.procedure;
    return {
      id: 't' + (nextCitizenId++),
      procedure_id: found.id,
      procedure_title: procedure.proc_title,
      administration: (procedure.proc_administration || [])[0] || '',
      created_at: new Date().toISOString(),
      pieces: (procedure.proc_pieces || []).map(function (label, index) {
        return { id: 'p' + index, label: label, checked: false, note: '' };
      }),
      steps: (procedure.proc_steps || []).map(function (label, index) {
        return { order: index + 1, label: label };
      })
    };
  }

  /* Combien de citoyens suivent une procedure : le vrai backend le lit en
     base, ici c'est la liste des suivis qui fait foi. */
  function trackersOf(procedureId) {
    return tracked.filter(function (item) {
      return String(item.procedure_id) === String(procedureId);
    }).length;
  }

  function findTracked(id) {
    return tracked.filter(function (item) { return String(item.id) === String(id); })[0] || null;
  }

  /* Meme forme d'erreur que celle levee par request() dans api.js : un message
     lisible et le code HTTP, pour que les ecrans se comportent pareil en mode
     demonstration et en mode reel. */
  function httpFailure(status, detail) {
    var error = new Error(detail);
    error.status = status;
    return error;
  }

  function delay(value, ms) {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(value); }, ms === undefined ? 350 : ms);
    });
  }

  /* --- Journal d'activite --------------------------------------------------

     Rejoue GET /admin/logs. Les entrees sont fabriquees une fois, puis triees
     de la plus recente a la plus ancienne. Elles couvrent les dix actions du
     contrat : c'est ce jeu qui exerce les trois teintes de pastille, l'acteur
     absent, les deux roles et l'etalement des dates sur une semaine. */

  var logs = [];

  var UA = {
    chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0',
    safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    mobile: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    // Une tentative automatisee : le journal doit rester lisible meme quand
    // l'agent n'est pas un navigateur.
    curl: 'curl/8.4.0'
  };

  function seedLogs() {
    var nextLogId = 1;

    /* Les acteurs viennent du jeu de comptes « users » : le filtre par
       utilisateur porte ainsi sur les memes personnes que l'ecran
       « Utilisateurs », et les roles sont les leurs. */
    function actor(username) {
      var found = users.filter(function (item) {
        return item.userName_user === username;
      })[0];
      if (!found) return null;
      return {
        id_user: found.id_user,
        userName: found.userName_user,
        role: found.role_user
      };
    }

    /* hours : anciennete en heures. « who » est nul pour les tentatives
       refusees — personne n'etait authentifie, et c'est tout le propos de
       l'entree. */
    function entry(hours, action, who, fields) {
      var person = who ? actor(who) : null;
      logs.push({
        id_log: 'log-' + (nextLogId++),
        action: action,
        entity_type: fields.entity_type || null,
        entity_id: fields.entity_id || null,
        detail: fields.detail || null,
        ip_address: fields.ip || '127.0.0.1',
        user_agent: fields.ua || UA.chrome,
        method: fields.method || 'POST',
        path: fields.path || '/',
        date_log: hoursAgo(hours),
        // Fige le role au moment de l'action : c'est celui-la qui fait foi.
        user_role: person ? person.role : null,
        user: person
      });
    }

    entry(1, 'mark_obsolete', 'admin', {
      entity_type: 'procedure', entity_id: 'p-3120',
      detail: 'Légalisation de signature — 1 citoyen concerné',
      method: 'PATCH', path: '/admin/procedures/p-3120/obsolete'
    });
    entry(2, 'update_administration', 'admin', {
      entity_type: 'administration', entity_id: 'a-12',
      detail: 'Centre régional d\'investissement — adresse renseignée',
      method: 'PUT', path: '/admin/administrations/a-12'
    });
    entry(3, 'login', 'admin', {
      entity_type: 'user', detail: 'Connexion réussie', path: '/auth/login'
    });
    entry(4, 'login_failed', null, {
      detail: 'Identifiant « admin » — mot de passe incorrect',
      ip: '196.64.208.17', ua: UA.curl, path: '/auth/login'
    });
    entry(4.2, 'login_failed', null, {
      detail: 'Identifiant « root » — compte inexistant',
      ip: '196.64.208.17', ua: UA.curl, path: '/auth/login'
    });
    entry(6, 'approve_extraction', 'admin', {
      entity_type: 'extraction', entity_id: 'e1',
      detail: 'extraction_formalites.json — 1 procédure publiée',
      path: '/admin/extractions/e1/approve'
    });
    entry(9, 'delete_procedure', 'admin', {
      entity_type: 'procedure', entity_id: 'p-2044',
      detail: 'Création d\'une SARL — 10 étapes supprimées',
      method: 'DELETE', path: '/admin/procedures/p-2044'
    });
    entry(11, 'register', 'yalaoui', {
      entity_type: 'user', detail: 'Nouveau compte citoyen',
      ua: UA.mobile, path: '/auth/register'
    });
    entry(12, 'login', 'yalaoui', {
      entity_type: 'user', detail: 'Connexion réussie',
      ua: UA.mobile, path: '/auth/login'
    });
    entry(26, 'delete_document', 'admin', {
      entity_type: 'document', entity_id: 'd-8',
      detail: 'guide_urbanisme.pdf — import et extraction effacés',
      method: 'DELETE', path: '/admin/documents/d-8'
    });
    entry(28, 'register_failed', null, {
      detail: 'Courriel « yassine.alaoui@example.ma » — déjà inscrit',
      ip: '105.158.44.2', ua: UA.firefox, path: '/auth/register'
    });
    entry(30, 'update_administration', 'admin', {
      entity_type: 'administration', entity_id: 'a-4',
      detail: 'Bureau d\'état civil — site web corrigé',
      method: 'PUT', path: '/admin/administrations/a-4'
    });
    entry(33, 'login', 'kbenjelloun', {
      entity_type: 'user', detail: 'Connexion réussie',
      ua: UA.safari, path: '/auth/login'
    });
    entry(50, 'delete_import_extraction', 'admin', {
      entity_type: 'extraction', entity_id: 'imp-2',
      detail: 'collage_json_2026-09-02 — 4 procédures supprimées',
      method: 'DELETE', path: '/admin/imports/imp-2'
    });
    entry(52, 'approve_extraction', 'admin', {
      entity_type: 'extraction', entity_id: 'ar1',
      detail: 'extraction_etat_civil_ar.json — 3 procédures publiées',
      path: '/admin/extractions/ar1/approve'
    });
    entry(55, 'mark_obsolete', 'admin', {
      entity_type: 'procedure', entity_id: 'p-1180',
      detail: 'Autorisation de voirie — 4 citoyens concernés',
      method: 'PATCH', path: '/admin/procedures/p-1180/obsolete'
    });
    entry(72, 'register', 'kbenjelloun', {
      entity_type: 'user', detail: 'Nouveau compte citoyen',
      ua: UA.safari, path: '/auth/register'
    });
    entry(74, 'login_failed', null, {
      detail: 'Identifiant « kbenjelloun » — mot de passe incorrect',
      ip: '41.248.19.90', ua: UA.safari, path: '/auth/login'
    });
    entry(96, 'delete_procedure', 'admin', {
      entity_type: 'procedure', entity_id: 'p-1902',
      detail: 'Demande de fiche anthropométrique — extraite par erreur',
      method: 'DELETE', path: '/admin/procedures/p-1902'
    });
    entry(120, 'delete_document', 'admin', {
      entity_type: 'document', entity_id: 'd-3',
      detail: 'brouillon_scanne.pdf — extraction en échec',
      method: 'DELETE', path: '/admin/documents/d-3'
    });
    entry(140, 'register_failed', null, {
      detail: 'Identifiant « fzidrissi » — déjà pris',
      ip: '160.176.3.77', ua: UA.chrome, path: '/auth/register'
    });
    entry(168, 'login', 'admin', {
      entity_type: 'user', detail: 'Connexion réussie', path: '/auth/login'
    });

    // Le serveur trie du plus recent au plus ancien : on fige cet ordre ici,
    // l'ecran ne retrie pas.
    logs.sort(function (a, b) {
      return new Date(b.date_log).getTime() - new Date(a.date_log).getTime();
    });
  }

  App.mock = {
    init: function () {
      if (documents.length) return;
      seed();
      // Apres seed() : les suivis et les sources citent des procedures des
      // extractions du jeu d'essai.
      seedCitizen();
      seedLogs();
    },

    listDocuments: function () {
      return delay(JSON.parse(JSON.stringify(documents)));
    },

    uploadDocument: function (formData) {
      var file = formData.get('file');
      var id = 'd' + (nextId++);
      var extractionId = 'e' + nextId;
      documents.unshift({
        id: id, kind: 'document',
        filename: file ? file.name : 'document.pdf',
        created_at: new Date().toISOString(),
        status: 'extracting',
        extraction_id: null, extraction_filename: null, procedure_count: 0
      });
      setTimeout(function () {
        var doc = documents.filter(function (d) { return d.id === id; })[0];
        if (!doc) return;
        extractions[extractionId] = {
          filename: 'extraction_' + String(doc.filename).replace(/\.[^.]+$/, '') + '.json',
          procedures: [{
            proc_title: 'Procédure extraite de ' + doc.filename,
            proc_description: null,
            proc_administration: ['Administration à compléter'],
            proc_pieces: [], proc_steps: [], proc_law: [],
            fee: null, proc_delai: null
          }]
        };
        doc.status = 'pending_review';
        doc.extraction_id = extractionId;
        doc.extraction_filename = extractions[extractionId].filename;
        doc.procedure_count = 1;
      }, 9000);
      return delay({ id: id }, 600);
    },

    importJson: function (formData) {
      var file = formData.get('file');
      var id = 'i' + (nextId++);
      var extractionId = 'e' + nextId;
      return App.helpers.readFileAsText(file).then(function (text) {
        var procedures = JSON.parse(text);
        extractions[extractionId] = { filename: file.name, procedures: procedures };
        documents.unshift({
          id: id, kind: 'import',
          filename: file.name,
          created_at: new Date().toISOString(),
          status: 'pending_review',
          extraction_id: extractionId,
          extraction_filename: file.name,
          procedure_count: procedures.length
        });
        return delay({ id: extractionId, extraction_id: extractionId }, 500);
      });
    },

    deleteDocument: function (id) {
      var index = -1;
      documents.forEach(function (doc, i) { if (String(doc.id) === String(id)) index = i; });
      if (index === -1) return Promise.reject(new Error('Document introuvable (' + id + ').'));
      var removed = documents.splice(index, 1)[0];
      if (removed.extraction_id) delete extractions[removed.extraction_id];
      return delay({ ok: true }, 400);
    },

    getExtraction: function (id) {
      var found = extractions[id];
      if (!found) return Promise.reject(new Error('Extraction introuvable (' + id + ').'));
      return delay(JSON.parse(JSON.stringify(found)));
    },

    saveExtraction: function (id, procedures) {
      if (!extractions[id]) return Promise.reject(new Error('Extraction introuvable.'));
      extractions[id].procedures = JSON.parse(JSON.stringify(procedures));
      documents.forEach(function (doc) {
        if (doc.extraction_id === id) doc.procedure_count = procedures.length;
      });
      return delay({ ok: true }, 500);
    },

    approveExtraction: function (id) {
      documents.forEach(function (doc) {
        if (doc.extraction_id === id) doc.status = 'published';
      });
      return delay({ ok: true }, 1400);
    },

    /* --- Authentification -------------------------------------------------
       Voir le bloc « Comptes et session factices » en haut du fichier : il n'y
       a pas de cookie ici, seulement la variable « session ». */

    /* Rejoue GET /citizen/me : l'identite du compte connecte, ou un 401 — la
       reponse que App.auth traduit par « personne n'est connecte ». */
    getMe: function () {
      if (!session) {
        return delay(null, 120).then(function () {
          throw httpFailure(401, 'Non authentifie.');
        });
      }
      return delay(publicUser(session), 120);
    },

    /* Rejoue POST /auth/login. En reel, c'est ici que le serveur pose le
       cookie ; ici on se contente d'ouvrir la session en memoire. Le mot de
       passe est compare puis oublie : il n'est ni retenu ni journalise. */
    login: function (credentials) {
      var account = findAccount('userName', credentials.userName);
      if (!account || account.password !== credentials.password) {
        return delay(null, 400).then(function () {
          throw httpFailure(401, 'Identifiants incorrects');
        });
      }
      session = account;
      return delay({ user: publicUser(account) }, 400);
    },

    /* Rejoue POST /auth/register, y compris le 409 sur un identifiant ou un
       courriel deja pris — c'est ce couple message + code que l'ecran lit pour
       poser l'erreur sur le bon champ. Le compte cree est toujours citoyen, et
       la session n'est PAS ouverte : il faut se connecter ensuite, comme en
       reel. */
    register: function (fields) {
      if (findAccount('userName', fields.userName)) {
        return delay(null, 400).then(function () {
          throw httpFailure(409, "Ce nom d'utilisateur est deja pris.");
        });
      }
      if (findAccount('email_user', fields.email_user)) {
        return delay(null, 400).then(function () {
          throw httpFailure(409, 'Cette adresse electronique est deja utilisee.');
        });
      }
      var account = {
        id_user: 'u' + (nextId++),
        userName: fields.userName,
        password: fields.password,
        nom_user: fields.nom_user,
        prenom_user: fields.prenom_user,
        email_user: fields.email_user,
        phone_user: fields.phone_user || null,
        role: 'citizen'
      };
      accounts.push(account);
      return delay({ message: 'Compte cree.', id_user: account.id_user }, 400);
    },

    /* Toutes les procedures a plat, avec le fichier dont elles proviennent. */
    listProcedures: function () {
      var out = [];
      Object.keys(extractions).forEach(function (extractionId) {
        var extraction = extractions[extractionId];

        extraction.procedures.forEach(function (procedure, index) {
          var copy = JSON.parse(JSON.stringify(procedure));
          // Identifiant stable factice : le vrai backend renvoie le sien.
          copy.id = extractionId + ':' + index;
          copy.extractionId = extractionId;
          copy.extractionName = extraction.filename;
          copy.index = index;
          /* Meme forme que mapStoredProcedure cote api.js : le statut d'une
             procedure dit si elle est encore en vigueur, pas ou en est son
             fichier d'origine. */
          copy.status = procedure.statut_proc === 'obsolete' ? 'obsolete' : 'active';
          copy.obsoleteAt = procedure.date_obsolete || null;
          out.push(copy);
        });
      });
      return delay(out, 400);
    },

    /* Rejoue PATCH /admin/procedures/{id}/obsolete : la ligne reste, seul son
       statut change, et la reponse dit combien de citoyens la suivent —
       c'est ce nombre que l'ecran annonce dans son message. */
    markProcedureObsolete: function (id) {
      var found = findProcedure(id);
      if (!found) {
        return delay(null, 300).then(function () {
          throw httpFailure(404, 'Procédure introuvable (' + id + ').');
        });
      }
      found.procedure.statut_proc = 'obsolete';
      found.procedure.date_obsolete = new Date().toISOString();
      return delay({ affected_users: trackersOf(id) }, 500);
    },

    /* id factice « extractionId:index » — voir listProcedures.
       Le vrai backend refuse la suppression tant qu'un citoyen suit la
       procedure : on rejoue ce 409, message compris. */
    deleteProcedure: function (id) {
      var parts = String(id).split(':');
      var extraction = extractions[parts[0]];
      var index = Number(parts[1]);
      if (!extraction || isNaN(index) || !extraction.procedures[index]) {
        return Promise.reject(new Error('Procédure introuvable (' + id + ').'));
      }
      var trackers = trackersOf(id);
      if (trackers) {
        return delay(null, 300).then(function () {
          throw httpFailure(409, trackers + ' citoyen(s) suivent cette procédure.');
        });
      }
      extraction.procedures.splice(index, 1);
      documents.forEach(function (doc) {
        if (doc.extraction_id === parts[0]) doc.procedure_count = extraction.procedures.length;
      });
      return delay({ ok: true }, 400);
    },

    /* Rejoue POST /auth/logout. En reel le serveur efface le cookie ; ici il
       suffit d'oublier le compte connecte. */
    logout: function () {
      session = null;
      return delay({ ok: true }, 300);
    },

    listAdministrations: function () {
      return delay(JSON.parse(JSON.stringify(administrations)));
    },

    /* Remplacement complet, comme PUT /admin/administrations/{id} : on rejoue
       les deux erreurs du contrat, 404 et 409, avec le champ « detail » de
       FastAPI et le code HTTP porte par l'erreur — c'est ce couple que
       l'ecran lit pour afficher le conflit sur le champ « Nom ». */
    saveAdministration: function (id, body) {
      var target = administrations.filter(function (a) {
        return a.id_administration === String(id);
      })[0];
      if (!target) return delay(null, 300).then(function () { throw httpFailure(404, 'Administration introuvable.'); });

      var name = String((body && body.nom_administration) || '').trim();
      var taken = administrations.some(function (a) {
        return a.id_administration !== target.id_administration &&
          a.nom_administration.toLowerCase() === name.toLowerCase();
      });
      if (taken) {
        return delay(null, 300).then(function () {
          throw httpFailure(409, 'Une autre administration porte déjà ce nom');
        });
      }

      target.nom_administration = name;
      // Le backend stocke null, pas la chaine vide : le mock fait pareil pour
      // que l'ecran soit teste sur la forme reellement recue.
      target.addr_administration = String((body && body.addr_administration) || '').trim() || null;
      target.url_administration = String((body && body.url_administration) || '').trim() || null;

      administrations.sort(function (a, b) {
        return a.nom_administration.localeCompare(b.nom_administration, 'fr');
      });
      return delay(JSON.parse(JSON.stringify(target)), 400);
    },

    /* --- Comptes ------------------------------------------------------------

       Rejoue GET /admin/users et GET /admin/users/{id}. Le contrôle du rôle
       n'est pas rejoué ici : le 403 vient du serveur, et en mode démonstration
       c'est le routeur qui interdit déjà l'écran à un citoyen. */

    listUsers: function () {
      // La liste ne porte pas le détail des suivis, seulement leur nombre.
      return delay(users.map(function (user) {
        return {
          id_user: user.id_user,
          nom_user: user.nom_user,
          prenom_user: user.prenom_user,
          email_user: user.email_user,
          userName_user: user.userName_user,
          role_user: user.role_user,
          creation_date: user.creation_date,
          tracked_count: user.tracked_procs.length,
          conversations_count: user.conversations_count
        };
      }), 350);
    },

    /* La fiche ne renvoie ni le nombre de discussions ni le téléphone : le
       mock s'en tient à ce que sert le backend, sinon l'écran serait relu sur
       des champs qui n'arriveront jamais. */
    getUser: function (id) {
      var found = users.filter(function (user) {
        return String(user.id_user) === String(id);
      })[0];
      if (!found) {
        return delay(null, 300).then(function () {
          throw httpFailure(404, 'Compte introuvable (' + id + ').');
        });
      }
      return delay({
        id_user: found.id_user,
        nom_user: found.nom_user,
        prenom_user: found.prenom_user,
        email_user: found.email_user,
        userName_user: found.userName_user,
        role_user: found.role_user,
        creation_date: found.creation_date,
        tracked_count: found.tracked_procs.length,
        tracked_procs: JSON.parse(JSON.stringify(found.tracked_procs))
      }, 300);
    },

    /* --- Espace citoyen : assistant --------------------------------------- */

    listConversations: function () {
      return delay(conversations.map(conversationSummary), 300);
    },

    getConversation: function (id) {
      var found = conversations.filter(function (c) { return String(c.id) === String(id); })[0];
      if (!found) return Promise.reject(new Error('Discussion introuvable (' + id + ').'));
      return delay(JSON.parse(JSON.stringify(found)), 250);
    },

    deleteConversation: function (id) {
      var index = -1;
      conversations.forEach(function (c, i) { if (String(c.id) === String(id)) index = i; });
      if (index === -1) {
        return delay(null, 250).then(function () {
          throw httpFailure(404, 'Discussion introuvable (' + id + ').');
        });
      }
      conversations.splice(index, 1);
      // Le serveur repond 204 : pas de corps, seul l'aboutissement compte.
      return delay(null, 350);
    },

    /* Le vrai assistant interroge un modele : la reponse met plusieurs
       secondes. On le rejoue tel quel — c'est ce delai qui justifie
       l'indicateur de reflexion cote ecran, le raccourcir le rendrait
       invisible et donc intestable. */
    sendMessage: function (conversationId, question) {
      var language = answerLanguage(question);
      var answer = citizenMessage('assistant', ANSWERS[language], pickSources(question));
      var conversation = conversationId
        ? conversations.filter(function (c) { return String(c.id) === String(conversationId); })[0]
        : null;

      if (conversationId && !conversation) {
        return delay(null, 400).then(function () {
          throw httpFailure(404, 'Discussion introuvable (' + conversationId + ').');
        });
      }

      if (!conversation) {
        conversation = {
          id: 'c' + (nextCitizenId++),
          // Le serveur derive le titre de la premiere question ; l'ecran fait
          // la troncature, on garde ici la question entiere.
          title: question,
          updated_at: new Date().toISOString(),
          messages: []
        };
        conversations.unshift(conversation);
      }

      conversation.messages.push(citizenMessage('user', question));
      conversation.messages.push(answer);
      conversation.updated_at = answer.created_at;

      return delay({
        conversation_id: conversation.id,
        title: conversation.title,
        message: JSON.parse(JSON.stringify(answer))
      }, 2600);
    },

    /* Rejoue GET /admin/logs. « action » et « user_id » sont des egalites
       strictes, « limit » vaut 100 par defaut : c'est le contrat du backend,
       et l'ecran s'appuie dessus pour ne pas tout charger. */
    listLogs: function (filters) {
      filters = filters || {};
      var out = logs.filter(function (log) {
        if (filters.action && log.action !== filters.action) return false;
        if (filters.user_id) {
          if (!log.user || String(log.user.id_user) !== String(filters.user_id)) return false;
        }
        return true;
      });
      var limit = Number(filters.limit) || 100;
      return delay(JSON.parse(JSON.stringify(out.slice(0, limit))), 400);
    },

    /* --- Espace citoyen : suivi ------------------------------------------- */

    listTracked: function () {
      return delay(JSON.parse(JSON.stringify(tracked)), 350);
    },

    trackProcedure: function (procedureId) {
      var already = tracked.filter(function (item) {
        return String(item.procedure_id) === String(procedureId);
      })[0];
      // Le backend ne doit pas creer deux suivis pour la meme procedure : il
      // renvoie celui qui existe deja plutot qu'un doublon.
      if (already) return delay(JSON.parse(JSON.stringify(already)), 400);

      var item = buildTracked(procedureId);
      if (!item) {
        return delay(null, 300).then(function () {
          throw httpFailure(404, 'Procédure introuvable (' + procedureId + ').');
        });
      }
      tracked.push(item);
      return delay(JSON.parse(JSON.stringify(item)), 600);
    },

    untrackProcedure: function (trackingId) {
      var index = -1;
      tracked.forEach(function (item, i) { if (String(item.id) === String(trackingId)) index = i; });
      if (index === -1) {
        return delay(null, 300).then(function () {
          throw httpFailure(404, 'Suivi introuvable (' + trackingId + ').');
        });
      }
      tracked.splice(index, 1);
      return delay({ ok: true }, 400);
    },

    /* Coche une piece ou enregistre sa note. La piece dont le libelle contient
       « timbre » echoue volontairement : c'est le cas qui exerce le retour en
       arriere de la case cote ecran, autrement impossible a declencher a la
       main en mode demonstration. */
    updateTrackedPiece: function (trackingId, pieceId, changes) {
      var item = findTracked(trackingId);
      if (!item) {
        return delay(null, 300).then(function () {
          throw httpFailure(404, 'Suivi introuvable (' + trackingId + ').');
        });
      }
      var piece = item.pieces.filter(function (p) { return String(p.id) === String(pieceId); })[0];
      if (!piece) {
        return delay(null, 300).then(function () {
          throw httpFailure(404, 'Pièce introuvable (' + pieceId + ').');
        });
      }
      if (/timbre/i.test(piece.label)) {
        return delay(null, 700).then(function () {
          throw httpFailure(500, 'Enregistrement impossible pour le moment (panne simulée).');
        });
      }

      if (changes && changes.checked !== undefined) piece.checked = changes.checked === true;
      if (changes && changes.note !== undefined) piece.note = String(changes.note);
      return delay(JSON.parse(JSON.stringify(item)), 500);
    },

    getStats: function () {
      var byStatus = { published: 0, review: 0, extracting: 0, failed: 0 };
      var STATUS_TO_BUCKET = {
        published: 'published', pending_review: 'review',
        extracting: 'extracting', failed: 'failed'
      };

      var daily = {};
      Object.keys(activity).forEach(function (key) { daily[key] = activity[key]; });

      documents.forEach(function (doc) {
        var bucket = STATUS_TO_BUCKET[doc.status] || 'review';
        byStatus[bucket] += 1;
        // Les documents du jeu d'essai s'ajoutent a l'historique genere.
        var key = doc.created_at ? doc.created_at.slice(0, 10) : null;
        if (key) daily[key] = (daily[key] || 0) + 1;
      });

      // Repartition par administration + volumes de pieces et d'etapes.
      var byAdministration = {};
      var pieces = 0, steps = 0, procedures = 0;

      Object.keys(extractions).forEach(function (extractionId) {
        extractions[extractionId].procedures.forEach(function (procedure) {
          procedures += 1;
          pieces += (procedure.proc_pieces || []).length;
          steps += (procedure.proc_steps || []).length;
          (procedure.proc_administration || []).forEach(function (name) {
            var label = String(name || '').trim();
            if (!label) return;
            byAdministration[label] = (byAdministration[label] || 0) + 1;
          });
        });
      });

      var administrationList = Object.keys(byAdministration)
        .map(function (label) { return { label: label, value: byAdministration[label] }; })
        .sort(function (a, b) { return b.value - a.value; })
        .slice(0, 7);

      var processed = 0;
      Object.keys(daily).forEach(function (key) { processed += daily[key]; });

      return delay({
        totals: {
          // Volume traite sur la fenetre de 12 semaines — c'est ce que trace
          // l'aire. Le nombre de fiches actuellement en liste est un autre
          // chiffre, affiche par la carte « Documents par statut ».
          documents: processed,
          procedures: procedures,
          pieces: pieces,
          steps: steps,
          administrations: Object.keys(byAdministration).length
        },
        byStatus: byStatus,
        byAdministration: administrationList,
        daily: daily,
        partial: false
      }, 450);
    }
  };
})(window);
