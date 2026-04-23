import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Dev-only middleware: POST /__write-reader-trazado
 *
 * Body: { type: 'ligada'|'mayusculas', folderName: 'trazado-letra-a', files: {...} }
 * Each files entry is either a plain string (utf-8 text) or { base64: '...' }
 * (binary — used for thum.png). Writes everything to
 * public/reader/libro/assets/trazados/{type}/{folderName}/.
 *
 * Used by "Preview en reader" in the generator wizard so a just-built trazado
 * can be tested inside the reader without going through the ZIP-download flow.
 */
function readerWriterPlugin() {
  const ALLOWED_TYPES = new Set(['ligada', 'mayusculas'])
  const FOLDER_RE = /^trazado-letra-[a-z0-9-]+$/i
  const FILE_RE = /^[a-zA-Z0-9._-]+$/

  return {
    name: 'reader-writer',
    configureServer(server) {
      server.middlewares.use('/__write-reader-trazado', (req, res, next) => {
        if (req.method !== 'POST') return next()

        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            const { type, folderName, files } = body
            if (!ALLOWED_TYPES.has(type)) throw new Error(`invalid type: ${type}`)
            if (!FOLDER_RE.test(folderName)) throw new Error(`invalid folderName: ${folderName}`)
            if (!files || typeof files !== 'object') throw new Error('missing files')

            const targetDir = path.resolve(
              server.config.root,
              'public/reader/libro/assets/trazados',
              type,
              folderName,
            )
            fs.mkdirSync(targetDir, { recursive: true })

            const written = []
            for (const [name, value] of Object.entries(files)) {
              if (!FILE_RE.test(name)) throw new Error(`invalid file name: ${name}`)
              const filePath = path.join(targetDir, name)
              if (value && typeof value === 'object' && typeof value.base64 === 'string') {
                fs.writeFileSync(filePath, Buffer.from(value.base64, 'base64'))
              } else if (typeof value === 'string') {
                fs.writeFileSync(filePath, value, 'utf8')
              } else {
                throw new Error(`invalid file value for ${name}`)
              }
              written.push(name)
            }

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, path: targetDir, written }))
          } catch (err) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err?.message || 'bad request' }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), readerWriterPlugin()],
  server: {
    port: 5177,
    open: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
