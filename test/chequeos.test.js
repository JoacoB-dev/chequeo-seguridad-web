import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { calcularPuntaje, dominioRaiz, esPlataforma, revisar } from '../src/chequeos.js'
import { informeHtml } from '../src/informe-html.js'
import { pedir as pedirReal } from '../src/red.js'

const AHORA = new Date('2026-10-14T12:00:00Z')
const ids = (r) => r.hallazgos.map((x) => x.id)
const sev = (r, id) => r.hallazgos.find((x) => x.id === id)?.severidad

/** Simula un servidor: rutas -> respuesta. */
function servidorFalso(rutas) {
  return async (url) => {
    const r = rutas[url]
    if (!r) return { status: 404, headers: {}, cuerpo: 'No encontrado' }
    if (r instanceof Error) throw r
    return { headers: {}, cuerpo: '', ...r }
  }
}
const dnsFalso = (registros) => ({
  resolveTxt: async (nombre) => {
    if (!registros[nombre]) throw Object.assign(new Error('ENODATA'), { code: 'ENODATA' })
    return registros[nombre].map((r) => [r])
  },
})

const TLS_OK = { autorizado: true, version: 'TLSv1.3', vence: new Date('2027-01-10'), emisor: "Let's Encrypt" }

test('dominio raíz y plataformas', () => {
  assert.equal(dominioRaiz('www.tienda.com.ar'), 'tienda.com.ar')
  assert.equal(dominioRaiz('shop.ejemplo.com'), 'ejemplo.com')
  assert.equal(esPlataforma('gino-talles-especiales.vercel.app'), true)
  assert.equal(esPlataforma('tienda.com.ar'), false)
})

test('sitio mal configurado: detecta los problemas típicos de una pyme', async () => {
  const pedir = servidorFalso({
    'https://tienda.com.ar/': {
      status: 200,
      tls: { autorizado: true, version: 'TLSv1.2', vence: new Date('2026-10-20'), emisor: 'R11' },
      headers: { server: 'Apache/2.4.41 (Ubuntu)', 'x-powered-by': 'PHP/7.4.3', 'set-cookie': ['PHPSESSID=abc; path=/'] },
      cuerpo: '<html><meta name="generator" content="WordPress 5.8.1"><img src="http://tienda.com.ar/logo.png"></html>',
    },
    'http://tienda.com.ar/': { status: 200, cuerpo: '<html>' },
    'https://tienda.com.ar/.env': { status: 200, cuerpo: 'DB_PASSWORD=secreta\nMP_ACCESS_TOKEN=APP_USR-1' },
    'https://tienda.com.ar/.git/HEAD': { status: 200, cuerpo: 'ref: refs/heads/main\n' },
    'https://tienda.com.ar/wp-content/uploads/': { status: 200, cuerpo: '<title>Index of /wp-content/uploads</title>' },
    'https://tienda.com.ar/wp-json/wp/v2/users': { status: 200, cuerpo: JSON.stringify([{ id: 1, slug: 'admin' }]) },
    'https://tienda.com.ar/xmlrpc.php': { status: 405, cuerpo: 'XML-RPC server accepts POST requests only.' },
  })
  const dns = dnsFalso({ 'tienda.com.ar': ['v=spf1 +all'] })
  const r = await revisar('tienda.com.ar', { completo: true, pedir, dns, ahora: AHORA })

  assert.equal(sev(r, 'tls-por-vencer'), 'alta')
  assert.equal(sev(r, 'http-sin-redirigir'), 'alta')
  for (const id of ['hsts', 'csp', 'clickjacking', 'nosniff', 'referrer', 'server-version', 'powered-by', 'cookie-PHPSESSID', 'contenido-mixto', 'wp-version', 'wp-usuarios', 'wp-xmlrpc', 'dmarc']) {
    assert.ok(ids(r).includes(id), `falta ${id}`)
  }
  assert.equal(sev(r, 'spf-abierto'), 'alta')
  assert.equal(sev(r, 'expuesto-env'), 'critica')
  assert.equal(sev(r, 'expuesto-git-HEAD'), 'critica')
  assert.equal(sev(r, 'expuesto-wp-content-uploads-'), 'media')
  assert.match(r.hallazgos.find((x) => x.id === 'cookie-PHPSESSID').titulo, /Secure, HttpOnly, SameSite/)
  assert.equal(r.nota, 'F')
  assert.equal(r.hallazgos[0].severidad, 'critica', 'ordenado de más grave a menos grave')
})

test('sitio bien configurado: nota A y sin falsos positivos por páginas 404 "lindas"', async () => {
  const encabezadosBuenos = {
    'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
    'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=()',
    server: 'cloudflare',
    'set-cookie': ['sesion_id=x; Path=/; Secure; HttpOnly; SameSite=Lax'],
  }
  const paginaError = { status: 200, cuerpo: '<html><title>Página no encontrada</title>Index of nada</html>' }
  const pedir = async (url) => {
    if (url === 'https://www.estudio.com.ar/') return { status: 301, headers: { location: 'https://estudio.com.ar/' }, tls: TLS_OK, cuerpo: '' }
    if (url === 'https://estudio.com.ar/') return { status: 200, headers: encabezadosBuenos, tls: TLS_OK, cuerpo: '<html><img src="/logo.png"></html>' }
    if (url === 'http://www.estudio.com.ar/') return { status: 301, headers: { location: 'https://www.estudio.com.ar/' }, cuerpo: '' }
    if (url.endsWith('/.well-known/security.txt')) return { status: 200, headers: {}, cuerpo: 'Contact: mailto:seguridad@estudio.com.ar' }
    return { ...paginaError, headers: {} } // sitios que responden 200 a todo
  }
  const dns = dnsFalso({
    'estudio.com.ar': ['v=spf1 include:_spf.google.com ~all', 'google-site-verification=x'],
    '_dmarc.estudio.com.ar': ['v=DMARC1; p=quarantine'],
  })
  const r = await revisar('https://www.estudio.com.ar', { completo: true, pedir, dns, ahora: AHORA })
  const problemas = r.hallazgos.filter((x) => !['ok', 'info'].includes(x.severidad))
  assert.deepEqual(problemas, [])
  assert.equal(r.nota, 'A')
  assert.equal(r.puntaje, 100)
  assert.equal(r.url, 'https://estudio.com.ar/')
  assert.ok(ids(r).includes('archivos-ok'))
})

test('sin --completo no prueba rutas privadas', async () => {
  const pedidos = []
  const pedir = async (url) => {
    pedidos.push(new URL(url).pathname)
    return { status: 200, headers: {}, tls: TLS_OK, cuerpo: '' }
  }
  await revisar('tienda.com.ar', { pedir, dns: dnsFalso({}), ahora: AHORA })
  assert.deepEqual([...new Set(pedidos)].sort(), ['/', '/.well-known/security.txt'])
})

test('sitio caído o sin HTTPS', async () => {
  const pedir = servidorFalso({ 'https://viejo.com.ar/': new Error('connect ECONNREFUSED') })
  const r = await revisar('viejo.com.ar', { pedir, dns: dnsFalso({}), ahora: AHORA })
  assert.equal(r.hallazgos[0].id, 'sin-https')
  assert.equal(r.hallazgos[0].severidad, 'critica')
})

test('en plataformas (vercel.app) no revisa el email del dominio ajeno', async () => {
  const pedir = async () => ({ status: 200, headers: {}, tls: TLS_OK, cuerpo: '' })
  const r = await revisar('gino-talles-especiales.vercel.app', { pedir, dns: dnsFalso({}), ahora: AHORA })
  assert.equal(r.dominioEmail, null)
  assert.ok(!ids(r).includes('spf'))
})

test('puntaje y nota', () => {
  assert.deepEqual(calcularPuntaje([]), { puntaje: 100, nota: 'A' })
  assert.deepEqual(calcularPuntaje([{ severidad: 'media' }, { severidad: 'baja' }]), { puntaje: 89, nota: 'B' })
  assert.deepEqual(calcularPuntaje([{ severidad: 'critica' }, { severidad: 'critica' }, { severidad: 'alta' }]), { puntaje: 0, nota: 'F' })
})

test('el informe HTML escapa el contenido del sitio', async () => {
  const pedir = async () => ({ status: 200, headers: { 'x-powered-by': '<script>alert(1)</script>' }, tls: TLS_OK, cuerpo: '' })
  const r = await revisar('tienda.com.ar', { pedir, dns: dnsFalso({}), ahora: AHORA })
  const html = informeHtml(r, { autor: 'Joaquin Bobbio', contacto: 'WhatsApp' })
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('Preparado por Joaquin Bobbio'))
})

test('red real: lee el certificado de un servidor HTTPS local', async () => {
  const cert = readFileSync(new URL('./certs/cert.pem', import.meta.url))
  const key = readFileSync(new URL('./certs/clave.pem', import.meta.url))
  const srvHttps = https.createServer({ cert, key }, (req, res) => {
    res.setHeader('strict-transport-security', 'max-age=31536000')
    res.end('<html>hola</html>')
  })
  const srvHttp = http.createServer((req, res) => {
    res.writeHead(301, { location: 'https://127.0.0.1/' })
    res.end()
  })
  await new Promise((r) => srvHttps.listen(0, '127.0.0.1', r))
  await new Promise((r) => srvHttp.listen(0, '127.0.0.1', r))
  const pHttps = srvHttps.address().port
  const pHttp = srvHttp.address().port
  try {
    const conCa = await pedirReal(`https://127.0.0.1:${pHttps}/`, { ca: cert })
    assert.equal(conCa.tls.autorizado, true)
    assert.ok(conCa.tls.vence > AHORA)
    assert.equal(conCa.headers['strict-transport-security'], 'max-age=31536000')

    const sinCa = await pedirReal(`https://127.0.0.1:${pHttps}/`)
    assert.equal(sinCa.tls.autorizado, false, 'un certificado autofirmado no es confiable')

    const pedir = (url) =>
      pedirReal(url.replace('https://127.0.0.1', `https://127.0.0.1:${pHttps}`).replace('http://127.0.0.1', `http://127.0.0.1:${pHttp}`))
    const r = await revisar('127.0.0.1', { pedir, dns: dnsFalso({}), ahora: AHORA })
    assert.equal(sev(r, 'tls-invalido'), 'alta')
    assert.equal(sev(r, 'http-redirige'), 'ok')
    assert.equal(sev(r, 'hsts-ok'), 'ok')
    assert.equal(r.dominioEmail, null)
  } finally {
    srvHttps.close()
    srvHttp.close()
  }
})
