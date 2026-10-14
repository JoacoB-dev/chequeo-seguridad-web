// Genera docs/informe-ejemplo.html con un sitio ficticio mal configurado (sin conectarse a internet).
import { writeFileSync } from 'node:fs'
import { revisar } from '../src/chequeos.js'
import { informeHtml } from '../src/informe-html.js'

const respuestas = {
  'https://www.ferreteria-ejemplo.com.ar/': {
    status: 200,
    tls: { autorizado: true, version: 'TLSv1.2', vence: new Date('2026-11-02'), emisor: "Let's Encrypt" },
    headers: { server: 'Apache/2.4.41 (Ubuntu)', 'x-powered-by': 'PHP/7.4.3', 'set-cookie': ['PHPSESSID=abc; path=/'] },
    cuerpo: '<meta name="generator" content="WordPress 5.8.1"><img src="http://www.ferreteria-ejemplo.com.ar/logo.png">',
  },
  'http://www.ferreteria-ejemplo.com.ar/': { status: 200, cuerpo: '' },
  'https://www.ferreteria-ejemplo.com.ar/.env': { status: 200, cuerpo: 'DB_PASSWORD=x' },
  'https://www.ferreteria-ejemplo.com.ar/wp-json/wp/v2/users': { status: 200, cuerpo: '[{"slug":"admin"},{"slug":"ventas"}]' },
}
const pedir = async (url) => ({ status: 404, headers: {}, cuerpo: '', ...respuestas[url] })
const dns = {
  resolveTxt: async (n) => {
    if (n === 'ferreteria-ejemplo.com.ar') return [['v=spf1 include:_spf.google.com ~all']]
    throw new Error('ENODATA')
  },
}
const r = await revisar('www.ferreteria-ejemplo.com.ar', { completo: true, pedir, dns, ahora: new Date('2026-10-14T12:00:00Z') })
writeFileSync(new URL('./informe-ejemplo.html', import.meta.url), informeHtml(r, { autor: 'Joaquin Bobbio', contacto: 'joacob-dev.github.io' }))
console.log(`Nota ${r.nota} (${r.puntaje}/100), ${r.hallazgos.length} hallazgos`)
