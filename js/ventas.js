// Modulo Ventas: lo que el cliente anota en su hoja, cruzado con la inversion del propio tablero.
//
// Los datos no se interpretan aqui. Nexus lee la hoja de control diario del cliente, decide lo
// dificil —el mes que declara, las celdas combinadas, si un blanco es un cero— y publica el
// resultado en una hoja con el contrato NEXUS_VENTAS_V1. El Apps Script la sirve en `ventas` y este
// modulo solo la muestra. Si algun dia hubiera que repetir aqui esa interpretacion, seria la senal
// de que algo se hizo al reves.
//
// Vacio no es cero: un dia sin dato se muestra como un hueco, nunca como una venta de cero. Y un mes
// que no cuadro con su TOTAL MENSUAL se marca, porque sus blancos no se pueden leer como ceros.
(function () {
  const VIEW_ID = 'view-ventas';
  const state = { month: null };

  const api = () => window.MrPaletaData;
  const fmt = () => api().fmt;
  const esc = value => api().esc(value);

  function host() {
    return document.getElementById('ventas-body');
  }

  function empty(title, detail) {
    return `<div class="panel"><div class="empty-state"><strong>${esc(title)}</strong><span>${esc(detail)}</span></div></div>`;
  }

  // Un dia de la hoja mas lo que ese dia costo, que sale de las descargas de Meta del propio tablero.
  function join(rows, key) {
    const month = api().monthByKey(key);
    const spend = month ? api().metrics.dailyValues(month, 'spend') : null;
    // «Conversaciones con mensajes iniciadas»: el paso del medio del embudo cuando el cliente no
    // anota mensajes en su hoja. No mide lo mismo que la hoja, y por eso se dice de donde sale.
    const chats = month ? api().metrics.dailyValues(month, 'conversations') : null;
    return rows.map(row => {
      const day = Number(String(row.dia).slice(8, 10));
      return Object.assign({}, row, {
        spend: spend ? spend[day - 1] : null,
        conversations: chats ? chats[day - 1] : null,
      });
    });
  }

  function totals(rows) {
    const sum = field => rows.reduce((acc, row) => (row[field] == null ? acc : acc + Number(row[field])), null);
    return {
      spend: sum('spend'),
      sales: sum('total_ventas'),
      amount: sum('total_monto'),
      messages: sum('total_mensajes'),
      chats: sum('conversations'),
    };
  }

  // El embudo, con el mismo dibujo que «De la inversion al lead»: tres etapas que se estrechan.
  //
  // El paso del medio son mensajes, y pueden salir de dos sitios. Manda la hoja del cliente: si el
  // los anota, son los suyos. Si no, se usan las conversaciones que atribuye la plataforma. Meta
  // siempre genera ese indicador, asi que un cero con inversion detras no significa «nadie
  // escribio»: significa que ninguna campana activa esta pidiendo mensajes. Lo mismo cuando llegar
  // a una conversacion sale mas caro que cerrar una venta. En los dos casos se avisa al lado en vez
  // de tapar el numero.
  function funnelOf(data) {
    const ratio = (a, b) => (a == null || !b ? null : a / b);
    const fromSheet = data.messages != null && data.messages > 0;
    const messages = fromSheet ? data.messages : data.chats;
    const source = fromSheet ? 'cliente' : (data.chats == null ? null : 'plataforma');
    const costPerMessage = ratio(data.spend, messages);
    const costPerSale = ratio(data.spend, data.sales);
    return {
      source, messages, costPerMessage, costPerSale,
      spend: data.spend, sales: data.sales, amount: data.amount,
      messageToSale: messages == null || !messages || data.sales == null ? null : (data.sales / messages) * 100,
      roas: ratio(data.amount, data.spend),
      suspect: source === 'plataforma' && data.spend != null && data.spend > 0
        && (messages == null || messages <= 0
          || (costPerMessage != null && costPerSale != null && costPerMessage > costPerSale)),
    };
  }

  function funnel(data) {
    const f = fmt();
    const e = funnelOf(data);
    const sub = e.source === 'plataforma'
      ? 'Los mensajes son las conversaciones iniciadas que atribuye la plataforma; el cliente no los anota en su hoja.'
      : (e.source === 'cliente'
        ? 'Los mensajes son los que anota el cliente en su hoja.'
        : 'Nadie reporta mensajes en este mes: el paso del medio va sin datos.');
    const stage = (label, value, note, shape) => `<div class="ventas-stage">
      <span>${esc(label)}</span><strong>${esc(value)}</strong>
      <div class="ventas-shape ${shape}" aria-hidden="true"></div>
      <small>${esc(note)}</small></div>`;
    const roas = e.roas == null ? '—' : f.decimal(e.roas) + 'x';
    const aviso = !e.suspect ? '' : `<p class="ventas-aviso"><span>Revisa el paso de mensajes</span> ${
      e.messages == null || e.messages <= 0
        ? 'Con ' + esc(f.money(e.spend)) + ' invertidos, la plataforma no registró ni una conversación. '
          + 'Suele significar que ninguna campaña activa está pidiendo mensajes, no que nadie escriba.'
        : 'Llegar a una conversación costó ' + esc(f.money(e.costPerMessage)) + ' y cerrar una venta '
          + esc(f.money(e.costPerSale)) + '. Cuando el paso del medio sale más caro que el final, suele ser '
          + 'que la inversión fue a anuncios que no piden mensajes, no que nadie escriba.'
    }</p>`;
    return `<div class="panel ventas-funnel-panel"><div class="panel-head"><div>
      <div class="panel-title">De la inversión a la venta</div>
      <div class="panel-sub">${esc(sub)}</div></div></div>
      <div class="ventas-funnel">
        ${stage('Inversión publicitaria', f.money(e.spend), 'Costo por conversación: ' + f.money(e.costPerMessage), 'shape-one')}
        ${stage(e.source === 'cliente' ? 'Conversaciones · hoja del cliente' : 'Conversaciones · plataforma',
          f.count(e.messages), 'Conversación a venta: ' + f.pct(e.messageToSale), 'shape-two')}
        ${stage('Ventas', f.count(e.sales), 'Costo por venta: ' + f.money(e.costPerSale) + ' · '
          + f.money(e.amount) + ' en ingresos · ROAS ' + roas, 'shape-three')}
      </div>${aviso}
      <p class="projection-note">Relación agregada, no atribución individual. El dibujo representa etapas:
      su ancho no es una escala entre unidades distintas, y no compara dinero con personas. Las
      conversaciones y las ventas no son la misma cohorte —una conversación de ayer puede cerrarse hoy—
      así que «conversación a venta» puede pasar del 100%: cuando eso ocurre, lo que falta son
      conversaciones medidas, no ventas de más.</p></div>`;
  }

  function kpis(data) {
    const f = fmt();
    const ratio = (a, b) => (a == null || !b ? null : a / b);
    const cards = [
      ['Inversión', f.money(data.spend), 'Meta Ads, del mismo tablero'],
      ['Ventas', f.count(data.sales), 'Anotadas por el cliente'],
      ['Ingresos', f.money(data.amount), 'Monto de esas ventas'],
      ['ROAS', data.amount == null || !data.spend ? '—' : f.decimal(data.amount / data.spend) + 'x', 'Ingresos por cada sol invertido'],
      ['Costo por venta', f.money(ratio(data.spend, data.sales)), 'Inversión entre ventas'],
      ['Ticket', f.money(ratio(data.amount, data.sales)), 'Ingreso medio por venta'],
    ];
    // Las clases son las del tablero (`kpi-strip` / `kpi-pill`): el modulo tiene que parecer de la
    // casa, no traer su propio estilo.
    return `<div class="kpi-strip">${cards.map(([label, value, note]) => `
      <div class="kpi-pill"><span>${esc(label)}</span><strong>${esc(value)}</strong>
      <small>${esc(note)}</small></div>`).join('')}</div>`;
  }

  function table(rows) {
    const f = fmt();
    const body = rows.map(row => `<tr>
      <td>${esc(row.dia)}</td>
      ${row.spend == null ? '<td class="num">—</td>' : `<td class="num">${esc(f.money(row.spend))}</td>`}
      ${row.total_ventas == null ? '<td class="num">—</td>' : `<td class="num">${esc(f.count(row.total_ventas))}</td>`}
      ${row.total_monto == null ? '<td class="num">—</td>' : `<td class="num">${esc(f.money(row.total_monto))}</td>`}
      <td>${row.cuadra ? '' : 'mes sin cuadre'}</td>
    </tr>`).join('');
    return `<div class="panel"><div class="panel-head"><div><div class="panel-title">Día a día</div>
      <div class="panel-sub">Un guion es un día sin dato, no una venta de cero.</div></div></div>
      <div class="table-scroll"><table><thead><tr><th>Día</th><th class="num">Inversión</th>
      <th class="num">Ventas</th><th class="num">Ingresos</th><th></th></tr></thead>
      <tbody>${body || '<tr><td colspan="5" class="table-empty">Sin días para este mes.</td></tr>'}</tbody></table></div></div>`;
  }

  function networks(rows) {
    const f = fmt();
    const redes = [['whatsapp', 'WhatsApp'], ['instagram', 'Instagram'], ['facebook', 'Facebook']];
    const total = rows.reduce((acc, row) => acc + (row.total_ventas || 0), 0);
    const body = redes.map(([key, label]) => {
      const sales = rows.reduce((acc, row) => (row[key + '_ventas'] == null ? acc : acc + row[key + '_ventas']), null);
      const amount = rows.reduce((acc, row) => (row[key + '_monto'] == null ? acc : acc + row[key + '_monto']), null);
      const share = sales == null || !total ? null : (sales / total) * 100;
      return `<tr><td>${esc(label)}</td><td class="num">${esc(f.count(sales))}</td>
        <td class="num">${esc(f.money(amount))}</td><td class="num">${esc(f.pct(share))}</td></tr>`;
    }).join('');
    return `<div class="panel"><div class="panel-head"><div><div class="panel-title">Por red</div>
      <div class="panel-sub">El reparto sale de la hoja. La inversión no se reparte por red: la plataforma la cobra por campaña.</div></div></div>
      <div class="table-scroll"><table><thead><tr><th>Red</th><th class="num">Ventas</th>
      <th class="num">Ingresos</th><th class="num">Parte</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
  }

  function tabs(keys) {
    return `<div class="month-tabs">${keys.map(key => `<button type="button" class="month-tab${key === state.month ? ' active' : ''}" data-ventas-month="${esc(key)}">${esc(key === 'todo' ? 'Todo el periodo' : key)}</button>`).join('')}</div>`;
  }

  function render() {
    const node = host();
    if (!node) return;
    const snapshot = api() && api().snapshot();
    const ventas = snapshot && snapshot.ventas;
    if (!ventas) {
      node.innerHTML = empty('Ventas no está conectado',
        'Falta la hoja que publica Nexus con las ventas del cliente.');
      return;
    }
    if (ventas.error) { node.innerHTML = empty('No se pudieron leer las ventas', ventas.error); return; }
    const rows = ventas.rows || [];
    if (!rows.length) { node.innerHTML = empty('Todavía no hay ventas publicadas', 'La hoja está vacía.'); return; }

    const keys = Array.from(new Set(rows.map(row => row.mes))).sort().reverse();
    if (!state.month || (state.month !== 'todo' && !keys.includes(state.month))) state.month = keys[0];
    const visible = state.month === 'todo' ? rows : rows.filter(row => row.mes === state.month);
    const joined = state.month === 'todo'
      ? keys.flatMap(key => join(rows.filter(row => row.mes === key), key))
      : join(visible, state.month);
    const sinCuadre = joined.some(row => !row.cuadra);

    node.innerHTML = tabs(keys.concat(['todo']))
      + (sinCuadre ? `<p class="section-desc">Hay un mes que no cuadró con su TOTAL MENSUAL: sus días en blanco no se leen como ceros y quedan como huecos.</p>` : '')
      + kpis(totals(joined))
      + funnel(totals(joined))
      + table(joined)
      + networks(joined);

    node.querySelectorAll('[data-ventas-month]').forEach(button => {
      button.addEventListener('click', () => { state.month = button.getAttribute('data-ventas-month'); render(); });
    });
  }

  window.addEventListener('mrpaleta:data-updated', render);
  window.addEventListener('mrpaleta:data-error', render);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
