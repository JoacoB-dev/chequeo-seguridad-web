#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { revisar } from './chequeos.js'
import { informeHtml } from './informe-html.js'

const args = process.argv.slice(2)
const opcion = (n) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const bandera = (n) => args.includes(`--${n}`)
const sitio = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.match(/^--(html|json|autor|contacto)$/))

if (!sitio || bandera('ayuda')) {
  console.log(`Uso: chequeo-seguridad-web <dominio> [opciones]

  --completo            Además prueba rutas sensibles (.env, .git, backups, phpinfo).
                        Requiere --tengo-permiso: usalo solo en sitios propios o con permiso escrito del dueño.
  --html informe.html   Guarda el informe para el cliente (se imprime como PDF desde el navegador)
  --json resultado.json Guarda el resultado en JSON
  --autor "Nombre"      Aparece en el informe
  --contacto "WhatsApp" Aparece en el informe
  --sin-email           No revisa SPF/DMARC

Sin --completo hace una revisión pasiva: lo mismo que ve cualquier visitante (página principal,
encabezados, certificado, security.txt) más los registros DNS públicos de email.`)
  process.exit(sitio ? 0 : 1)
}

const completo = bandera('completo')
if (completo && !bandera('tengo-permiso')) {
  console.error('La revisión completa prueba rutas privadas del servidor. Agregá --tengo-permiso solo si el sitio es tuyo o tenés permiso escrito del dueño.')
  process.exit(2)
}

const COLOR = { critica: '\x1b[41m\x1b[97m', alta: '\x1b[31m', media: '\x1b[33m', baja: '\x1b[36m', info: '\x1b[90m', ok: '\x1b[32m' }
const RESET = '\x1b[0m'

try {
  const r = await revisar(sitio, { completo, revisarEmail: !bandera('sin-email') })
  console.log(`\n${r.sitio}: nota ${r.nota} (${r.puntaje}/100)${completo ? ' · revisión completa' : ' · revisión pasiva'}\n`)
  for (const x of r.hallazgos) {
    console.log(`${COLOR[x.severidad]}${x.severidad.toUpperCase().padEnd(7)}${RESET} ${x.titulo}`)
  }
  const html = opcion('html')
  if (html) {
    writeFileSync(html, informeHtml(r, { autor: opcion('autor'), contacto: opcion('contacto') }))
    console.log(`\nInforme guardado en ${html}`)
  }
  const json = opcion('json')
  if (json) writeFileSync(json, JSON.stringify(r, null, 2))
  process.exitCode = r.hallazgos.some((x) => ['critica', 'alta'].includes(x.severidad)) ? 1 : 0
} catch (e) {
  console.error(`No se pudo revisar ${sitio}: ${e.message}`)
  process.exitCode = 2
}
