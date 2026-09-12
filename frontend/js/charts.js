/* Graphiques en SVG inline — aucune dépendance réseau, comme le reste de l'app.

   Chaque graphique se dessine à la largeur réelle de son conteneur (et non dans
   un viewBox mis à l'échelle) : le texte reste à 11-12 px nets quelle que soit
   la taille de la fenêtre. Un ResizeObserver redessine au redimensionnement.

   Palette : voir le bloc « Jetons graphiques » dans styles.css. Les valeurs ont
   été validées (bande de clarté, plancher de chroma, séparation daltonienne,
   contraste sur fond blanc) — ne pas les modifier sans revalider. */
(function (global) {
  'use strict';

  var App = global.App || (global.App = {});
  var h = App.helpers;
  var esc = h.esc;

  /* --- Jetons (doivent refléter styles.css) ------------------------------- */

  var INK = {
    primary: '#14171a',
    secondary: '#4a5158',
    muted: '#7b838c',
    grid: '#e6e8eb',
    axis: '#cdd2d7',
    surface: '#ffffff'
  };

  // Rampe séquentielle bleue, une seule teinte, du clair au foncé.
  // Le pas le plus clair tient 2,11:1 sur blanc (plancher ordinal : 2:1).
  var RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#184f95'];
  var ACCENT = '#2a78d6';

  App.charts = App.charts || {};
  App.charts.RAMP = RAMP;
  App.charts.ACCENT = ACCENT;

  /* --- Formatage ---------------------------------------------------------- */

  // Séparateur de milliers français : espace fine insécable.
  function fmt(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
  App.charts.fmt = fmt;

  /* Tronque une etiquette pour l'AFFICHAGE seulement — la donnee garde son nom
     complet, que le jumeau tableau continue d'afficher en entier.
     La coupe porte sur la sequence de caracteres, depuis la fin de la chaine :
     pour un nom arabe cela retire bien la fin logique du nom, quel que soit le
     sens dans lequel il est peint. Rien a faire de particulier pour le RTL. */
  function truncate(text, max) {
    var value = String(text === null || text === undefined ? '' : text);
    return value.length > max ? value.slice(0, max) + '…' : value;
  }
  App.charts.truncate = truncate;

  // Identifiants uniques pour les <clipPath> : deux graphiques peuvent coexister.
  var uid = 0;

  /* --- Géométrie ---------------------------------------------------------- */

  /* Barre horizontale : extrémité arrondie côté valeur, carrée sur la ligne de
     base. Le rayon se réduit si la barre est plus courte que lui. */
  function barPath(x, y, w, hh, r) {
    r = Math.max(0, Math.min(r, w));
    if (w <= 0) return '';
    return 'M' + x + ',' + y +
      'h' + (w - r) +
      'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r +
      'v' + (hh - 2 * r) +
      'a' + r + ',' + r + ' 0 0 1 ' + (-r) + ',' + r +
      'h' + (r - w) + 'z';
  }

  /* Arrondit a 1, 2, 5 ou 10 x 10^n — les seuls pas qui donnent des graduations
     lisibles. */
  function niceNum(value) {
    if (value <= 0) return 1;
    var magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    var scaled = value / magnitude;
    var step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
    return step * magnitude;
  }

  /* Le haut de l'axe doit etre divisible par le nombre de graduations, sinon on
     obtient 0/13/25/38/50 au lieu de 0/10/20/30/40. On arrondit donc le PAS,
     pas le maximum. */
  function niceMax(value, ticks) {
    ticks = ticks || 4;
    if (value <= 0) return ticks;
    // Toutes les mesures ici sont des comptages : on force un pas entier, sinon
    // un maximum de 1 donnerait des graduations 0 / 0,5 / 1 / 1,5 / 2.
    return Math.max(1, niceNum(value / ticks)) * ticks;
  }

  /* --- Socle responsive + infobulle --------------------------------------- */

  /* draw(width) renvoie le markup SVG. On redessine sur redimensionnement et on
     garde de quoi débrancher l'observateur quand l'écran est détruit. */
  function mount(container, draw, onHover) {
    container.classList.add('chart-canvas');
    if (container._chartCleanup) container._chartCleanup();

    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;

    function paint() {
      var width = container.clientWidth;
      if (!width) return;
      container.innerHTML = draw(width);
      container.appendChild(tip);
      if (onHover) onHover(container, container.querySelector('svg'), showTip, hideTip);
    }

    function showTip(html, x, y) {
      tip.innerHTML = html;
      tip.hidden = false;
      // On garde l'infobulle dans le cadre : au-delà du milieu, elle bascule.
      var box = container.getBoundingClientRect();
      var w = tip.offsetWidth;
      var left = Math.max(4, Math.min(x - w / 2, box.width - w - 4));
      tip.style.left = left + 'px';
      tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + 'px';
    }

    function hideTip() { tip.hidden = true; }

    var observer = null;
    if (global.ResizeObserver) {
      var last = 0;
      observer = new ResizeObserver(function () {
        // On ne redessine que si la largeur change réellement.
        if (container.clientWidth && container.clientWidth !== last) {
          last = container.clientWidth;
          paint();
        }
      });
      observer.observe(container);
    }

    container._chartCleanup = function () {
      if (observer) observer.disconnect();
      container._chartCleanup = null;
    };

    paint();
  }

  // Débranche tous les observateurs d'un sous-arbre (appelé au destroy d'écran).
  App.charts.destroyAll = function (root) {
    var nodes = root.querySelectorAll('.chart-canvas');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i]._chartCleanup) nodes[i]._chartCleanup();
    }
  };

  /* --- Barres horizontales -------------------------------------------------
     Une seule série : une seule couleur pour toutes les barres. Colorer chaque
     barre selon sa valeur rejouerait la longueur en teinte — c'est justement
     l'anti-motif « rampe de valeur sur des catégories nominales ». */

  // Longueur maximale d'une etiquette de barre, en caracteres. Au-dela, la
  // colonne de gauche prend le pas sur les barres, qui sont l'information.
  var LABEL_MAX = 28;

  App.charts.barsH = function (container, options) {
    var data = options.data || [];
    var color = options.color || ACCENT;

    function draw(width) {
      if (!data.length) return '<div class="chart-empty">Aucune donnée.</div>';

      var rowH = 32;
      var barH = 18;                       // <= 24 px : jamais toute la bande
      var labelW = Math.min(190, Math.max(110, Math.round(width * 0.34)));
      var valueW = 46;
      var plotW = Math.max(10, width - labelW - valueW - 8);
      var height = data.length * rowH + 4;

      // Les noms d'administration venus des donnees arabes depassent souvent
      // 45 caracteres : peints en entier ils sortent de la colonne et viennent
      // mordre sur les barres. On coupe donc a l'affichage, en se bornant a ce
      // que la colonne peut vraiment tenir — ~6,3 px par caractere a 12 px —
      // sans jamais depasser LABEL_MAX. Un nom latin court n'est pas touche.
      var maxChars = Math.max(12, Math.min(LABEL_MAX, Math.floor((labelW - 12) / 6.3)));

      // Garde-fou : un nom sans espace ni coupe possible ne peut pas deborder
      // de sa colonne. Le SVG n'a pas d'equivalent a overflow/text-overflow,
      // c'est le decoupage qui joue ce role.
      var clipId = 'ct-lbl-' + (++uid);
      var defs = '<defs><clipPath id="' + clipId + '">' +
        '<rect x="0" y="0" width="' + (labelW - 6) + '" height="' + height + '"></rect>' +
        '</clipPath></defs>';

      var max = Math.max.apply(null, data.map(function (d) { return d.value; }));
      max = max > 0 ? max : 1;

      var out = defs;
      data.forEach(function (item, i) {
        var y = i * rowH + 2;
        var w = Math.round((item.value / max) * plotW);
        var barY = y + (rowH - barH) / 2;

        out +=
          // Zone de survol : toute la rangée, bien plus large que la barre.
          '<rect class="hit" x="0" y="' + y + '" width="' + width + '" height="' + rowH + '" ' +
            'fill="transparent" data-i="' + i + '"></rect>' +
          '<text x="' + (labelW - 10) + '" y="' + (y + rowH / 2) + '" ' +
            'text-anchor="end" dominant-baseline="central" class="ct-label" ' +
            'clip-path="url(#' + clipId + ')">' +
            // <title> et non un attribut « title » : en SVG c'est l'element
            // enfant qui donne l'infobulle native du navigateur. Il porte
            // toujours le nom complet, jamais la version coupee.
            '<title>' + esc(item.label) + '</title>' +
            esc(truncate(item.label, maxChars)) + '</text>' +
          '<path d="' + barPath(labelW, barY, w, barH, 4) + '" fill="' + color + '"></path>' +
          // Valeur à la pointe : la lecture ne dépend jamais de l'infobulle.
          '<text x="' + (labelW + w + 8) + '" y="' + (y + rowH / 2) + '" ' +
            'dominant-baseline="central" class="ct-value">' + fmt(item.value) + '</text>';
      });

      return '<svg width="' + width + '" height="' + height + '" ' +
        'role="img" aria-label="' + esc(options.ariaLabel || '') + '">' + out + '</svg>';
    }

    mount(container, draw, function (root, svg, show, hide) {
      h.on(svg, 'mousemove', '.hit', function (event, target) {
        var item = data[Number(target.getAttribute('data-i'))];
        var box = root.getBoundingClientRect();
        show('<strong>' + esc(item.label) + '</strong>' +
             '<span>' + fmt(item.value) + ' ' + esc(options.unit || '') + '</span>',
          event.clientX - box.left, event.clientY - box.top);
      });
      svg.addEventListener('mouseleave', hide);
    });
  };

  /* --- Aire + ligne (évolution) ------------------------------------------- */

  App.charts.area = function (container, options) {
    var points = options.points || [];
    var color = options.color || ACCENT;

    function draw(width) {
      if (points.length < 2) return '<div class="chart-empty">Pas assez de points.</div>';

      var padL = 34, padR = 18, padT = 14, padB = 24;
      var height = options.height || 180;
      var plotW = width - padL - padR;
      var plotH = height - padT - padB;
      var max = niceMax(Math.max.apply(null, points.map(function (p) { return p.value; })));

      function px(i) { return padL + (i / (points.length - 1)) * plotW; }
      function py(v) { return padT + plotH - (v / max) * plotH; }

      // Grille : traits pleins d'un cran au-dessus du fond, jamais pointillés.
      var grid = '';
      for (var t = 0; t <= 4; t++) {
        var value = (max / 4) * t;
        var y = py(value);
        grid += '<line x1="' + padL + '" y1="' + y + '" x2="' + (width - padR) + '" y2="' + y +
            '" stroke="' + (t === 0 ? INK.axis : INK.grid) + '" stroke-width="1"></line>' +
          '<text x="' + (padL - 8) + '" y="' + y + '" text-anchor="end" ' +
            'dominant-baseline="central" class="ct-tick">' + fmt(Math.round(value)) + '</text>';
      }

      var line = points.map(function (p, i) {
        return (i ? 'L' : 'M') + px(i).toFixed(1) + ',' + py(p.value).toFixed(1);
      }).join(' ');
      var areaPath = line + ' L' + px(points.length - 1).toFixed(1) + ',' + py(0) +
        ' L' + px(0).toFixed(1) + ',' + py(0) + ' Z';

      // Étiquettes d'axe espacées pour ne jamais se chevaucher.
      var every = Math.ceil(points.length / Math.max(2, Math.floor(plotW / 64)));
      var xLabels = '';
      points.forEach(function (p, i) {
        if (i % every && i !== points.length - 1) return;
        xLabels += '<text x="' + px(i) + '" y="' + (height - 6) + '" text-anchor="middle" ' +
          'class="ct-tick">' + esc(p.label) + '</text>';
      });

      var lastX = px(points.length - 1), lastY = py(points[points.length - 1].value);

      return '<svg width="' + width + '" height="' + height + '" ' +
          'role="img" aria-label="' + esc(options.ariaLabel || '') + '">' +
        grid +
        // Aire : lavis à 10 %, jamais un aplat saturé.
        '<path d="' + areaPath + '" fill="' + color + '" fill-opacity="0.10"></path>' +
        '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2" ' +
          'stroke-linejoin="round" stroke-linecap="round"></path>' +
        '<line class="crosshair" x1="0" y1="' + padT + '" x2="0" y2="' + (padT + plotH) + '" ' +
          'stroke="' + INK.axis + '" stroke-width="1" opacity="0"></line>' +
        // Marqueur de fin : anneau blanc de 2 px pour rester lisible sur la ligne.
        '<circle cx="' + lastX + '" cy="' + lastY + '" r="4.5" fill="' + color +
          '" stroke="' + INK.surface + '" stroke-width="2"></circle>' +
        '<circle class="hover-dot" r="4.5" fill="' + color + '" stroke="' + INK.surface +
          '" stroke-width="2" opacity="0"></circle>' +
        xLabels +
        '<rect class="hit" x="' + padL + '" y="' + padT + '" width="' + plotW + '" height="' +
          plotH + '" fill="transparent"></rect>' +
        '</svg>';
    }

    mount(container, draw, function (root, svg, show, hide) {
      var padL = 34, padR = 18;
      svg.addEventListener('mousemove', function (event) {
        var box = svg.getBoundingClientRect();
        var plotW = box.width - padL - padR;
        var ratio = (event.clientX - box.left - padL) / plotW;
        var i = Math.round(Math.max(0, Math.min(1, ratio)) * (points.length - 1));
        var p = points[i];
        var x = padL + (i / (points.length - 1)) * plotW;

        var crosshair = svg.querySelector('.crosshair');
        crosshair.setAttribute('x1', x);
        crosshair.setAttribute('x2', x);
        crosshair.setAttribute('opacity', '1');

        var dot = svg.querySelector('.hover-dot');
        var padT = 14;
        var plotH = (options.height || 180) - padT - 24;
        var max = niceMax(Math.max.apply(null, points.map(function (q) { return q.value; })));
        dot.setAttribute('cx', x);
        dot.setAttribute('cy', padT + plotH - (p.value / max) * plotH);
        dot.setAttribute('opacity', '1');

        var rect = root.getBoundingClientRect();
        show('<strong>' + esc(p.full || p.label) + '</strong>' +
             '<span>' + fmt(p.value) + ' ' + esc(options.unit || '') + '</span>',
          event.clientX - rect.left, event.clientY - rect.top);
      });
      svg.addEventListener('mouseleave', function () {
        hide();
        svg.querySelector('.crosshair').setAttribute('opacity', '0');
        svg.querySelector('.hover-dot').setAttribute('opacity', '0');
      });
    });
  };

  /* --- Étincelle (tuiles de statistiques) ---------------------------------
     Rendue en chaîne : pas de survol, pas d'axe — c'est un ornement de tuile,
     la valeur exacte est le grand chiffre à côté. */

  App.charts.sparkline = function (values, color) {
    if (!values || values.length < 2) return '';
    var w = 72, hh = 22, max = Math.max.apply(null, values) || 1;
    var d = values.map(function (v, i) {
      return (i ? 'L' : 'M') + ((i / (values.length - 1)) * w).toFixed(1) + ',' +
        (hh - (v / max) * (hh - 3) - 1.5).toFixed(1);
    }).join(' ');
    return '<svg class="spark" width="' + w + '" height="' + hh + '" aria-hidden="true">' +
      '<path d="' + d + '" fill="none" stroke="' + (color || ACCENT) + '" stroke-width="2" ' +
      'stroke-linejoin="round" stroke-linecap="round" opacity="0.55"></path></svg>';
  };

  /* --- Jauge ---------------------------------------------------------------
     Piste = pas plus clair de la même rampe, pour que l'état se lise sur toute
     la largeur et pas seulement sur la partie remplie. */

  App.charts.meter = function (ratio, color) {
    var pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    return '<div class="meter" role="img" aria-label="' + pct + ' %">' +
      '<div class="meter-fill" style="width:' + pct + '%;background:' + (color || ACCENT) + '"></div>' +
      '</div>';
  };

  /* --- Calendrier ----------------------------------------------------------
     Grille du mois. L'activité est encodée par un lavis ordinal (rampe validée)
     ET par le nombre écrit dans la case : jamais par la couleur seule. */

  var DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  App.charts.monthLabel = function (year, month) {
    return MONTHS[month] + ' ' + year;
  };

  // counts : { 'AAAA-MM-JJ': nombre }
  App.charts.calendar = function (container, options) {
    var year = options.year, month = options.month;
    var counts = options.counts || {};

    var first = new Date(year, month, 1);
    // getDay() : 0 = dimanche. On décale pour une semaine qui commence lundi.
    var lead = (first.getDay() + 6) % 7;
    var daysInMonth = new Date(year, month + 1, 0).getDate();

    var values = Object.keys(counts).map(function (k) { return counts[k]; });
    var max = values.length ? Math.max.apply(null, values) : 0;

    function bin(n) {
      if (!n) return -1;
      if (max <= 1) return 0;
      // 4 paliers, du plus clair au plus foncé.
      return Math.min(RAMP.length - 1, Math.floor((n - 1) / (max / RAMP.length)));
    }

    var today = new Date();
    var isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

    var cells = '';
    for (var i = 0; i < lead; i++) cells += '<div class="cal-cell is-empty"></div>';

    for (var day = 1; day <= daysInMonth; day++) {
      var key = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var n = counts[key] || 0;
      var level = bin(n);
      var style = level >= 0 ? ' style="background:' + RAMP[level] + '"' : '';
      // Sur les deux pas les plus foncés, l'encre passe en blanc pour le contraste.
      var cls = 'cal-cell' +
        (level >= 2 ? ' on-dark' : '') +
        (isCurrentMonth && today.getDate() === day ? ' is-today' : '');

      cells += '<div class="' + cls + '"' + style +
        ' title="' + esc(day + ' ' + MONTHS[month] + ' — ' + (n ? h.plural(n, 'document') : 'aucun document')) + '">' +
        '<span class="cal-day">' + day + '</span>' +
        (n ? '<span class="cal-count">' + n + '</span>' : '') +
        '</div>';
    }

    var legend = '<div class="cal-legend"><span>Moins</span>' +
      '<i style="background:var(--surface-1)"></i>' +
      RAMP.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') +
      '<span>Plus</span></div>';

    container.innerHTML =
      '<div class="cal-grid cal-head">' +
        DAYS.map(function (d) { return '<div class="cal-dow">' + d + '</div>'; }).join('') +
      '</div>' +
      '<div class="cal-grid">' + cells + '</div>' + legend;
  };
})(window);
