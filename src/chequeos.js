import { promises as dnsPromises } from 'node:dns'
import { pedir as pedirReal } from './red.js'

export const SEVERIDADES = ['critica', 'alta', 'media', 'baja', 'info', 'ok']
const DESCUENTO = { critica: 40, alta: 20, media: 8, baja: 3, info: 0, ok: 0 }

const SUFIJOS_DOBLES = ['com.ar', 'gob.ar', 'org.ar', 'net.ar', 'edu.ar', 'int.ar', 'tur.ar', 'co.uk', 'com.br', 'com.mx', 'com.uy', 'com.co', 'com.pe', 'com.au']
const PLATAFORMAS = ['vercel.app', 'netlify.app', 'github.io', 'pages.dev', 'herokuapp.com', 'wixsite.com', 'web.app', 'firebaseapp.com', 'onrender.com', 'mitiendanube.com', 'empretienda.com.ar']

/** Dominio donde se configuran los registros de email (sin www ni subdominios). */
export function dominioRaiz(host) {
  const partes = host.toLowerCase().split('.')
  const n = SUFIJOS_DOBLES.some((s) => host.endsWith('.' + s)) ? 3 : 2
  return partes.slice(-n).join('.')
}

export const esPlataforma = (host) => PLATAFORMAS.some((p) => host === p || host.endsWith('.' + p))

const h = (id, categoria, severidad, titulo, detalle, solucion) => ({ id, categoria, severidad, titulo, detalle, solucion })

const encabezado = (res, nombre) => {
  const v = res.headers[nombre.toLowerCase()]
  return Array.isArray(v) ? v.join(', ') : v
}

async function seguirRedirecciones(pedir, url, max = 5) {
  let actual = url
  for (let i = 0; i <= max; i++) {
    const res = await pedir(actual)
    const destino = encabezado(res, 'location')
    if (res.status >= 300 && res.status < 400 && destino) {
      actual = new URL(destino, actual).toString()
      continue
    }
    return { res, url: actual }
  }
  throw new Error('Demasiadas redirecciones')
}

// ---------- Chequeos pasivos (equivalen a abrir la página en un navegador) ----------

function chequearTls(res, ahora) {
  const out = []
  const t = res.tls
  if (!t) return out
  if (!t.autorizado) {
    out.push(h('tls-invalido', 'HTTPS', 'alta', 'El certificado HTTPS no es válido',
      `El navegador muestra una advertencia de seguridad (${t.error ?? 'certificado no confiable'}). Muchos visitantes se van y Google penaliza el sitio.`,
      'Renovar o instalar un certificado de una autoridad reconocida. En la mayoría de los hostings es gratis con Let\'s Encrypt (opción "SSL" o "AutoSSL" del panel).'))
  }
  if (t.vence) {
    const dias = Math.floor((t.vence - ahora) / 86400000)
    if (dias < 0) {
      out.push(h('tls-vencido', 'HTTPS', 'critica', 'El certificado HTTPS está vencido', `Venció hace ${-dias} días.`, 'Renovar el certificado ya y activar la renovación automática.'))
    } else if (dias < 15) {
      out.push(h('tls-por-vencer', 'HTTPS', 'alta', `El certificado vence en ${dias} días`, `Vence el ${t.vence.toISOString().slice(0, 10)}.`, 'Verificar que la renovación automática esté activa en el hosting.'))
    } else if (dias < 30) {
      out.push(h('tls-por-vencer', 'HTTPS', 'media', `El certificado vence en ${dias} días`, `Vence el ${t.vence.toISOString().slice(0, 10)}.`, 'Verificar que la renovación automática esté activa en el hosting.'))
    } else if (t.autorizado) {
      out.push(h('tls-ok', 'HTTPS', 'ok', 'Certificado HTTPS válido', `Emitido por ${t.emisor ?? 'desconocido'}, vence en ${dias} días.`, ''))
    }
  }
  if (t.version && ['TLSv1', 'TLSv1.1', 'SSLv3'].includes(t.version)) {
    out.push(h('tls-viejo', 'HTTPS', 'media', `Usa un protocolo viejo (${t.version})`, 'Los navegadores modernos ya no lo aceptan y tiene fallas conocidas.', 'Configurar el servidor para usar solo TLS 1.2 y 1.3.'))
  }
  return out
}

async function chequearRedireccionHttp(pedir, host) {
  try {
    const res = await pedir(`http://${host}/`)
    const destino = encabezado(res, 'location') ?? ''
    if (res.status >= 300 && res.status < 400 && destino.startsWith('https://')) {
      return [h('http-redirige', 'HTTPS', 'ok', 'La versión sin HTTPS redirige a HTTPS', '', '')]
    }
    return [h('http-sin-redirigir', 'HTTPS', 'alta', 'El sitio también se puede ver sin HTTPS',
      `http://${host}/ responde con código ${res.status} en lugar de redirigir a https://. Los datos de formularios pueden viajar sin cifrar.`,
      'Activar "Forzar HTTPS" en el hosting, o agregar una redirección 301 de http a https.')]
  } catch {
    // Si el puerto 80 está cerrado no hay riesgo: solo se puede entrar por HTTPS.
    return [h('http-cerrado', 'HTTPS', 'ok', 'No responde sin HTTPS', 'El puerto 80 no está disponible, solo se accede por HTTPS.', '')]
  }
}

function chequearEncabezados(res) {
  const out = []
  const hsts = encabezado(res, 'strict-transport-security')
  if (!hsts) {
    out.push(h('hsts', 'Encabezados', 'media', 'Falta HSTS (Strict-Transport-Security)', 'Sin HSTS, alguien en la misma red wifi puede forzar la versión sin cifrar del sitio.', 'Agregar el encabezado: Strict-Transport-Security: max-age=31536000; includeSubDomains'))
  } else {
    const edad = Number(/max-age=(\d+)/i.exec(hsts)?.[1] ?? 0)
    out.push(edad < 15552000
      ? h('hsts-corto', 'Encabezados', 'baja', 'HSTS con duración corta', `max-age=${edad} (menos de 6 meses).`, 'Subir a max-age=31536000 (1 año).')
      : h('hsts-ok', 'Encabezados', 'ok', 'HSTS configurado', hsts, ''))
  }

  const csp = encabezado(res, 'content-security-policy')
  if (!csp) {
    out.push(h('csp', 'Encabezados', 'media', 'Falta Content-Security-Policy', 'Es la principal defensa del navegador contra scripts inyectados (XSS) y contra scripts de terceros que roban datos de tarjetas.', 'Empezar con una política en modo reporte (Content-Security-Policy-Report-Only) y ajustarla. Ejemplo mínimo: default-src \'self\'; frame-ancestors \'self\''))
  } else {
    out.push(h('csp-ok', 'Encabezados', 'ok', 'Tiene Content-Security-Policy', csp.length > 120 ? csp.slice(0, 117) + '...' : csp, ''))
  }

  const xfo = encabezado(res, 'x-frame-options')
  if (!xfo && !/frame-ancestors/i.test(csp ?? '')) {
    out.push(h('clickjacking', 'Encabezados', 'media', 'El sitio se puede meter dentro de otra página (clickjacking)', 'Otro sitio puede mostrar esta página en un marco invisible y engañar al usuario para que haga clic.', 'Agregar X-Frame-Options: SAMEORIGIN, o frame-ancestors \'self\' en la CSP.'))
  }
  if ((encabezado(res, 'x-content-type-options') ?? '').toLowerCase() !== 'nosniff') {
    out.push(h('nosniff', 'Encabezados', 'baja', 'Falta X-Content-Type-Options', 'El navegador puede interpretar archivos subidos como scripts.', 'Agregar X-Content-Type-Options: nosniff'))
  }
  if (!encabezado(res, 'referrer-policy')) {
    out.push(h('referrer', 'Encabezados', 'baja', 'Falta Referrer-Policy', 'Las direcciones completas (con datos en la URL) se mandan a otros sitios al hacer clic en un enlace.', 'Agregar Referrer-Policy: strict-origin-when-cross-origin'))
  }
  if (!encabezado(res, 'permissions-policy')) {
    out.push(h('permissions', 'Encabezados', 'baja', 'Falta Permissions-Policy', 'No se limita el acceso a cámara, micrófono o ubicación desde scripts de terceros.', 'Agregar Permissions-Policy: camera=(), microphone=(), geolocation=()'))
  }

  const server = encabezado(res, 'server') ?? ''
  if (/\d/.test(server)) {
    out.push(h('server-version', 'Información expuesta', 'baja', 'El servidor muestra su versión', `Server: ${server}. Facilita buscar fallas conocidas de esa versión.`, 'Ocultar la versión (Apache: ServerTokens Prod; Nginx: server_tokens off).'))
  }
  const powered = encabezado(res, 'x-powered-by')
  if (powered) {
    out.push(h('powered-by', 'Información expuesta', 'baja', 'Se ve la tecnología y versión del sitio', `X-Powered-By: ${powered}.`, 'Quitar el encabezado (PHP: expose_php = Off; Express: app.disable(\'x-powered-by\')).'))
  }
  return out
}

const NOMBRES_SESION = /sess|sid|token|auth|login|jwt|wordpress_logged_in|laravel_session|connect\.sid/i

function chequearCookies(res, esHttps) {
  const out = []
  const cookies = [].concat(res.headers['set-cookie'] ?? [])
  for (const c of cookies) {
    const nombre = c.split('=')[0].trim()
    const attrs = c.toLowerCase()
    const faltan = []
    if (esHttps && !/;\s*secure/.test(attrs)) faltan.push('Secure')
    if (NOMBRES_SESION.test(nombre) && !/;\s*httponly/.test(attrs)) faltan.push('HttpOnly')
    if (!/;\s*samesite=/.test(attrs)) faltan.push('SameSite')
    if (faltan.length === 0) continue
    const grave = faltan.includes('Secure') || faltan.includes('HttpOnly')
    out.push(h(`cookie-${nombre}`, 'Cookies', grave ? 'media' : 'baja', `La cookie "${nombre}" no tiene ${faltan.join(', ')}`,
      'Secure evita que viaje sin cifrar; HttpOnly evita que un script la robe; SameSite protege contra pedidos falsificados desde otros sitios.',
      `Agregar los atributos que faltan al crear la cookie: ${faltan.join('; ')}${faltan.includes('SameSite') ? '=Lax' : ''}`))
  }
  return out
}

function chequearHtml(res, esHttps) {
  const out = []
  const html = res.cuerpo ?? ''
  if (esHttps) {
    const mixtos = [...html.matchAll(/<(?:script|img|iframe|link|audio|video|source)\b[^>]*?\s(?:src|href)=["'](http:\/\/[^"']+)/gi)].map((m) => m[1])
    if (mixtos.length) {
      out.push(h('contenido-mixto', 'HTTPS', 'media', 'La página carga recursos sin HTTPS (contenido mixto)',
        `${mixtos.length} recurso(s), por ejemplo ${mixtos[0]}. El navegador puede bloquearlos o mostrar el candado roto.`,
        'Cambiar esas direcciones a https:// o a rutas relativas.'))
    }
  }
  const wp = /<meta[^>]+name=["']generator["'][^>]+content=["']WordPress\s*([\d.]+)?/i.exec(html)
  if (wp) {
    out.push(h('wp-version', 'Información expuesta', 'baja', `Se ve que el sitio usa WordPress${wp[1] ? ' ' + wp[1] : ''}`,
      'Los ataques automáticos buscan sitios con versiones de WordPress o plugins desactualizados.',
      'Mantener WordPress, el tema y los plugins actualizados, y ocultar la versión (quitar wp_generator).'))
  }
  return out
}

async function chequearSecurityTxt(pedir, base) {
  try {
    const res = await pedir(new URL('/.well-known/security.txt', base).toString())
    if (res.status === 200 && /contact:/i.test(res.cuerpo)) {
      return [h('security-txt', 'Buenas prácticas', 'ok', 'Tiene security.txt', 'Indica a quién avisar si alguien encuentra una falla.', '')]
    }
  } catch {}
  return [h('security-txt', 'Buenas prácticas', 'info', 'No tiene security.txt', 'Es un archivo estándar que dice a quién avisar si alguien encuentra una falla.', 'Crear /.well-known/security.txt con una línea "Contact: mailto:..." y "Expires: ...".')]
}

async function chequearEmail(dns, dominio) {
  const out = []
  const txt = async (nombre) => {
    try {
      return (await dns.resolveTxt(nombre)).map((r) => r.join(''))
    } catch {
      return []
    }
  }
  const spf = (await txt(dominio)).filter((r) => /^v=spf1\b/i.test(r))
  if (spf.length === 0) {
    out.push(h('spf', 'Email', 'media', 'El dominio no tiene SPF', `Cualquiera puede mandar emails haciéndose pasar por @${dominio} (por ejemplo, facturas falsas a clientes).`, `Agregar un registro TXT en ${dominio} con los servidores que mandan su correo, por ejemplo: v=spf1 include:_spf.google.com ~all. Si el dominio no manda emails: v=spf1 -all`))
  } else if (spf.length > 1) {
    out.push(h('spf-doble', 'Email', 'media', 'El dominio tiene dos registros SPF', 'Con más de uno, los servidores de correo lo toman como inválido.', 'Unificar todo en un solo registro TXT v=spf1.'))
  } else if (/\+all\b/i.test(spf[0])) {
    out.push(h('spf-abierto', 'Email', 'alta', 'El SPF permite a cualquiera mandar emails del dominio', spf[0], 'Cambiar +all por ~all o -all.'))
  } else {
    out.push(h('spf-ok', 'Email', 'ok', 'SPF configurado', spf[0], ''))
  }
  const dmarc = (await txt(`_dmarc.${dominio}`)).find((r) => /^v=DMARC1/i.test(r))
  if (!dmarc) {
    out.push(h('dmarc', 'Email', 'media', 'El dominio no tiene DMARC', 'Sin DMARC, Gmail y Outlook no saben qué hacer con emails falsos que usan el dominio.', `Agregar un registro TXT en _dmarc.${dominio}: v=DMARC1; p=quarantine; rua=mailto:dmarc@${dominio}`))
  } else if (/p=none/i.test(dmarc)) {
    out.push(h('dmarc-none', 'Email', 'baja', 'DMARC solo en modo observación (p=none)', dmarc, 'Cuando los reportes estén limpios, pasar a p=quarantine o p=reject.'))
  } else {
    out.push(h('dmarc-ok', 'Email', 'ok', 'DMARC configurado', dmarc, ''))
  }
  return out
}

// ---------- Chequeos activos (solo con permiso del dueño del sitio) ----------

const ARCHIVOS_EXPUESTOS = [
  { ruta: '/.env', sev: 'critica', titulo: 'El archivo .env es público', firma: (b) => /^[A-Z][A-Z0-9_]*=.+/m.test(b) && !/<html/i.test(b), detalle: 'Suele tener contraseñas de la base de datos, claves de Mercado Pago o de email.', solucion: 'Bloquear el acceso a archivos que empiezan con punto, sacar el .env de la carpeta pública y cambiar TODAS las claves que tenía.' },
  { ruta: '/.git/HEAD', sev: 'critica', titulo: 'La carpeta .git es pública', firma: (b) => /^ref: refs\//.test(b), detalle: 'Se puede descargar todo el código fuente del sitio, incluidas claves que alguna vez se subieron.', solucion: 'Borrar la carpeta .git del servidor o bloquear su acceso, y cambiar las claves que estuvieron en el repositorio.' },
  { ruta: '/wp-config.php.bak', sev: 'critica', titulo: 'Hay una copia pública de wp-config.php', firma: (b) => /DB_PASSWORD/.test(b), detalle: 'Contiene la contraseña de la base de datos de WordPress.', solucion: 'Borrar la copia y cambiar la contraseña de la base de datos.' },
  { ruta: '/wp-config.php~', sev: 'critica', titulo: 'Hay una copia pública de wp-config.php', firma: (b) => /DB_PASSWORD/.test(b), detalle: 'Contiene la contraseña de la base de datos de WordPress.', solucion: 'Borrar la copia y cambiar la contraseña de la base de datos.' },
  { ruta: '/backup.sql', sev: 'critica', titulo: 'Hay una copia de la base de datos descargable', firma: (b) => /CREATE TABLE|INSERT INTO/i.test(b), detalle: 'Cualquiera puede bajar los datos de clientes.', solucion: 'Borrar el archivo y guardar los backups fuera de la carpeta pública.' },
  { ruta: '/dump.sql', sev: 'critica', titulo: 'Hay una copia de la base de datos descargable', firma: (b) => /CREATE TABLE|INSERT INTO/i.test(b), detalle: 'Cualquiera puede bajar los datos de clientes.', solucion: 'Borrar el archivo y guardar los backups fuera de la carpeta pública.' },
  { ruta: '/backup.zip', sev: 'critica', titulo: 'Hay un backup .zip descargable', firma: (b) => b.startsWith('PK'), detalle: 'Puede tener el código y la base de datos completos.', solucion: 'Borrar el archivo y guardar los backups fuera de la carpeta pública.' },
  { ruta: '/phpinfo.php', sev: 'alta', titulo: 'phpinfo() es público', firma: (b) => /phpinfo\(\)|<title>PHP \d/i.test(b), detalle: 'Muestra la configuración completa del servidor, rutas internas y a veces variables con claves.', solucion: 'Borrar el archivo.' },
  { ruta: '/info.php', sev: 'alta', titulo: 'phpinfo() es público', firma: (b) => /phpinfo\(\)|<title>PHP \d/i.test(b), detalle: 'Muestra la configuración completa del servidor, rutas internas y a veces variables con claves.', solucion: 'Borrar el archivo.' },
  { ruta: '/server-status', sev: 'media', titulo: 'La página de estado de Apache es pública', firma: (b) => /Apache Server Status/i.test(b), detalle: 'Muestra las direcciones que visitan los usuarios en tiempo real.', solucion: 'Restringir /server-status a la IP del administrador.' },
  { ruta: '/wp-content/uploads/', sev: 'media', titulo: 'Se puede listar el contenido de carpetas', firma: (b) => /<title>Index of \//i.test(b), detalle: 'Se ven todos los archivos subidos, incluidos los que no están enlazados (facturas, documentos).', solucion: 'Desactivar el listado de carpetas (Apache: Options -Indexes).' },
  { ruta: '/uploads/', sev: 'media', titulo: 'Se puede listar el contenido de carpetas', firma: (b) => /<title>Index of \//i.test(b), detalle: 'Se ven todos los archivos subidos, incluidos los que no están enlazados.', solucion: 'Desactivar el listado de carpetas (Apache: Options -Indexes).' },
  { ruta: '/.DS_Store', sev: 'baja', titulo: 'Hay un archivo .DS_Store público', firma: (b) => b.includes('Bud1'), detalle: 'Revela nombres de archivos y carpetas del sitio.', solucion: 'Borrarlo y bloquear archivos que empiezan con punto.' },
]

async function chequearArchivos(pedir, base) {
  const out = []
  const vistos = new Set()
  for (const a of ARCHIVOS_EXPUESTOS) {
    if (vistos.has(a.titulo)) continue
    try {
      const res = await pedir(new URL(a.ruta, base).toString())
      if (res.status === 200 && a.firma(res.cuerpo ?? '')) {
        vistos.add(a.titulo)
        out.push(h(`expuesto${a.ruta.replace(/[^a-z0-9]+/gi, '-')}`, 'Archivos expuestos', a.sev, a.titulo, `${a.ruta}: ${a.detalle}`, a.solucion))
      }
    } catch {}
  }
  if (out.length === 0) {
    out.push(h('archivos-ok', 'Archivos expuestos', 'ok', 'No se encontraron archivos sensibles públicos', `Se probaron ${ARCHIVOS_EXPUESTOS.length} rutas comunes (.env, .git, backups, phpinfo, listado de carpetas).`, ''))
  }
  return out
}

async function chequearWordPress(pedir, base) {
  const out = []
  try {
    const res = await pedir(new URL('/wp-json/wp/v2/users', base).toString())
    if (res.status === 200) {
      const usuarios = JSON.parse(res.cuerpo)
      if (Array.isArray(usuarios) && usuarios.some((u) => u.slug)) {
        out.push(h('wp-usuarios', 'WordPress', 'media', 'Se pueden listar los usuarios de WordPress',
          `Usuarios visibles: ${usuarios.map((u) => u.slug).slice(0, 5).join(', ')}. Con el nombre de usuario, los robots prueban contraseñas.`,
          'Bloquear /wp-json/wp/v2/users para visitantes (plugin de seguridad o filtro rest_endpoints) y usar contraseñas fuertes con 2FA.'))
      }
    }
  } catch {}
  try {
    const res = await pedir(new URL('/xmlrpc.php', base).toString())
    if (/XML-RPC server accepts POST requests only/i.test(res.cuerpo ?? '')) {
      out.push(h('wp-xmlrpc', 'WordPress', 'baja', 'xmlrpc.php está activo', 'Se usa para probar miles de contraseñas en un solo pedido.', 'Desactivar XML-RPC si no se usa la app móvil de WordPress ni Jetpack.'))
    }
  } catch {}
  return out
}

// ---------- Orquestador ----------

export function calcularPuntaje(hallazgos) {
  const puntaje = Math.max(0, 100 - hallazgos.reduce((s, x) => s + DESCUENTO[x.severidad], 0))
  const nota = puntaje >= 90 ? 'A' : puntaje >= 75 ? 'B' : puntaje >= 60 ? 'C' : puntaje >= 40 ? 'D' : 'F'
  return { puntaje, nota }
}

/**
 * Revisa un sitio.
 * @param {string} sitio  dominio o URL (ej. "ejemplo.com.ar")
 * @param {{completo?:boolean, pedir?:Function, dns?:{resolveTxt:Function}, ahora?:Date, revisarEmail?:boolean}} opciones
 *   completo: además prueba rutas sensibles (.env, .git, backups). Solo con permiso del dueño.
 */
export async function revisar(sitio, { completo = false, pedir = pedirReal, dns = dnsPromises, ahora = new Date(), revisarEmail = true } = {}) {
  const url = new URL(/^https?:\/\//i.test(sitio) ? sitio : `https://${sitio}`)
  const host = url.hostname
  const hallazgos = []

  let final
  try {
    final = await seguirRedirecciones(pedir, `https://${host}${url.pathname}`)
  } catch (e) {
    hallazgos.push(h('sin-https', 'HTTPS', 'critica', 'El sitio no carga por HTTPS', `No se pudo abrir https://${host}/ (${e.message}).`, 'Instalar un certificado HTTPS (gratis con Let\'s Encrypt en casi todos los hostings).'))
  }

  if (final) {
    const esHttps = final.url.startsWith('https://')
    if (!esHttps) {
      hallazgos.push(h('redirige-a-http', 'HTTPS', 'alta', 'La versión HTTPS redirige a una página sin cifrar', `Termina en ${final.url}.`, 'Corregir la redirección para que siempre termine en https://.'))
    }
    // El certificado se evalúa en la primera respuesta HTTPS del dominio pedido.
    const primera = await pedir(`https://${host}/`).catch(() => null)
    if (primera) hallazgos.push(...chequearTls(primera, ahora))
    hallazgos.push(...(await chequearRedireccionHttp(pedir, host)))
    hallazgos.push(...chequearEncabezados(final.res))
    hallazgos.push(...chequearCookies(final.res, esHttps))
    hallazgos.push(...chequearHtml(final.res, esHttps))
    hallazgos.push(...(await chequearSecurityTxt(pedir, final.url)))
    if (completo) {
      hallazgos.push(...(await chequearArchivos(pedir, final.url)))
      hallazgos.push(...(await chequearWordPress(pedir, final.url)))
    }
  }

  let dominio = null
  if (revisarEmail && !esPlataforma(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host) && host !== 'localhost') {
    dominio = dominioRaiz(host)
    hallazgos.push(...(await chequearEmail(dns, dominio)))
  }

  hallazgos.sort((a, b) => SEVERIDADES.indexOf(a.severidad) - SEVERIDADES.indexOf(b.severidad))
  return { sitio: host, url: final?.url ?? url.toString(), dominioEmail: dominio, fecha: ahora.toISOString(), completo, hallazgos, ...calcularPuntaje(hallazgos) }
}
