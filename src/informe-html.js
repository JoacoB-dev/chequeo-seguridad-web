const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const pl = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

const ETIQUETA = { critica: 'Crítico', alta: 'Alto', media: 'Medio', baja: 'Bajo', info: 'Info', ok: 'Bien' }

/** Genera un informe HTML autocontenido (se puede imprimir como PDF desde el navegador). */
export function informeHtml(r, { autor, contacto } = {}) {
  const problemas = r.hallazgos.filter((x) => !['ok', 'info'].includes(x.severidad))
  const bien = r.hallazgos.filter((x) => x.severidad === 'ok')
  const sugerencias = r.hallazgos.filter((x) => x.severidad === 'info')
  const cuenta = (s) => r.hallazgos.filter((x) => x.severidad === s).length
  const fecha = new Date(r.fecha).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })

  const tarjeta = (x) => `
    <article class="hallazgo ${x.severidad}">
      <header><span class="sev">${ETIQUETA[x.severidad]}</span><h3>${esc(x.titulo)}</h3><span class="cat">${esc(x.categoria)}</span></header>
      ${x.detalle ? `<p>${esc(x.detalle)}</p>` : ''}
      ${x.solucion ? `<p class="sol"><strong>Cómo se arregla:</strong> ${esc(x.solucion)}</p>` : ''}
    </article>`

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chequeo de seguridad: ${esc(r.sitio)}</title>
<style>
  :root { --fondo:#f6f7f9; --papel:#fff; --texto:#1b2430; --suave:#5b6675; --borde:#dde2e8;
    --critica:#b42318; --alta:#d9480f; --media:#b7791f; --baja:#2f6fb3; --ok:#2b8a3e; --info:#6b7280; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--fondo); color:var(--texto); font:16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 32px 16px 64px; }
  .portada { background:var(--papel); border:1px solid var(--borde); border-radius:12px; padding:24px; display:grid; grid-template-columns: 1fr auto; gap:16px; align-items:center; }
  .portada h1 { margin:0 0 4px; font-size:1.6rem; }
  .portada p { margin:0; color:var(--suave); }
  .nota { width:110px; height:110px; border-radius:50%; display:grid; place-items:center; font-size:3rem; font-weight:700; color:#fff; }
  .nota small { display:block; font-size:.8rem; font-weight:500; margin-top:-14px; }
  .A,.B { background:var(--ok); } .C { background:var(--media); } .D { background:var(--alta); } .F { background:var(--critica); }
  .resumen { display:flex; flex-wrap:wrap; gap:8px; margin:16px 0 8px; }
  .resumen span { background:var(--papel); border:1px solid var(--borde); border-radius:999px; padding:4px 12px; font-size:.9rem; }
  h2 { margin:32px 0 12px; font-size:1.2rem; }
  .hallazgo { background:var(--papel); border:1px solid var(--borde); border-left:5px solid var(--info); border-radius:10px; padding:14px 16px; margin-bottom:10px; break-inside: avoid; }
  .hallazgo header { display:flex; flex-wrap:wrap; gap:8px; align-items:baseline; }
  .hallazgo h3 { margin:0; font-size:1rem; flex:1 1 300px; }
  .hallazgo p { margin:8px 0 0; color:var(--suave); }
  .hallazgo .sol { color:var(--texto); }
  .sev { font-size:.75rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; padding:2px 8px; border-radius:6px; color:#fff; background:var(--info); }
  .cat { font-size:.8rem; color:var(--suave); }
  ${['critica', 'alta', 'media', 'baja', 'ok', 'info'].map((s) => `.${s} { border-left-color: var(--${s}); } .${s} .sev { background: var(--${s}); }`).join('\n  ')}
  .ok p { display:none; }
  .ok p:first-of-type { display:block; }
  footer { margin-top:40px; font-size:.85rem; color:var(--suave); border-top:1px solid var(--borde); padding-top:16px; }
  @media (max-width: 560px) { .portada { grid-template-columns: 1fr; } .nota { width:84px; height:84px; font-size:2.2rem; } }
  @media print { body { background:#fff; } main { padding:0; } .hallazgo, .portada { border-color:#ccc; } }
</style>
</head>
<body>
<main>
  <section class="portada">
    <div>
      <h1>Chequeo de seguridad web</h1>
      <p><strong>${esc(r.sitio)}</strong> · ${esc(fecha)}</p>
      <p>${r.completo ? 'Revisión completa (con autorización del dueño del sitio).' : 'Revisión pasiva: solo lo que ve cualquier visitante.'}</p>
      ${autor ? `<p>Preparado por ${esc(autor)}${contacto ? ` · ${esc(contacto)}` : ''}</p>` : ''}
    </div>
    <div class="nota ${r.nota}"><div>${r.nota}<small>${r.puntaje}/100</small></div></div>
  </section>

  <div class="resumen">
    <span>${pl(cuenta('critica'), 'crítico', 'críticos')}</span><span>${pl(cuenta('alta'), 'alto', 'altos')}</span><span>${pl(cuenta('media'), 'medio', 'medios')}</span><span>${pl(cuenta('baja'), 'bajo', 'bajos')}</span><span>${bien.length} en orden</span>
  </div>

  <h2>Qué conviene arreglar (${problemas.length})</h2>
  ${problemas.length ? problemas.map(tarjeta).join('') : '<p>No se encontraron problemas en esta revisión.</p>'}

  ${sugerencias.length ? `<h2>Sugerencias</h2>${sugerencias.map(tarjeta).join('')}` : ''}

  <h2>Lo que está bien (${bien.length})</h2>
  ${bien.map(tarjeta).join('')}

  <footer>
    <p>Este informe revisa configuración pública del sitio y del dominio${r.dominioEmail ? ` (${esc(r.dominioEmail)})` : ''}. No es una prueba de penetración: no intenta entrar al sitio ni probar contraseñas.</p>
    <p>Generado con chequeo-seguridad-web.</p>
  </footer>
</main>
</body>
</html>
`
}
