import http from 'node:http'
import https from 'node:https'

const LIMITE_CUERPO = 512 * 1024
const AGENTE = 'chequeo-seguridad-web/0.1 (+revision autorizada)'

/**
 * Hace un pedido HTTP(S) sin seguir redirecciones y sin cortar si el certificado es inválido
 * (eso se reporta como hallazgo, no como error).
 * @returns {Promise<{status:number, headers:Record<string,string|string[]>, cuerpo:string,
 *   tls?:{autorizado:boolean, error?:string, version?:string, vence?:Date, emisor?:string, nombres?:string[]}}>}
 */
export function pedir(url, { metodo = 'GET', timeout = 10000, ca } = {}) {
  const u = new URL(url)
  const mod = u.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = mod.request(
      u,
      {
        method: metodo,
        headers: { 'user-agent': AGENTE, accept: '*/*' },
        rejectUnauthorized: false,
        ca,
        servername: u.hostname,
        timeout,
      },
      (res) => {
        let tls
        if (u.protocol === 'https:') {
          const s = res.socket
          const cert = s.getPeerCertificate?.() ?? {}
          tls = {
            autorizado: s.authorized,
            error: s.authorizationError ? String(s.authorizationError) : undefined,
            version: s.getProtocol?.(),
            vence: cert.valid_to ? new Date(cert.valid_to) : undefined,
            emisor: cert.issuer?.O ?? cert.issuer?.CN,
            nombres: (cert.subjectaltname ?? '')
              .split(',')
              .map((n) => n.trim().replace(/^DNS:/, ''))
              .filter(Boolean),
          }
        }
        const partes = []
        let total = 0
        res.on('data', (c) => {
          if (total < LIMITE_CUERPO) partes.push(c)
          total += c.length
        })
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, cuerpo: Buffer.concat(partes).toString('utf8'), tls }),
        )
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error(`Tiempo de espera agotado (${timeout} ms)`)))
    req.on('error', reject)
    req.end()
  })
}
