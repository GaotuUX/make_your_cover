import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const jsonPath = path.join(__dirname, '..', 'src', 'data', 'coverTemplateGooglePreprocess.json')

/** @type {Record<string, string>} */
let _cache = null

function loadMap() {
  if (!_cache) {
    _cache = JSON.parse(readFileSync(jsonPath, 'utf8'))
  }
  return _cache
}

/**
 * @param {string} templateId
 * @returns {string | null}
 */
export function getGooglePreprocessPrompt(templateId) {
  if (!templateId || typeof templateId !== 'string') return null
  const map = loadMap()
  const p = map[templateId.trim()]
  return typeof p === 'string' && p.trim() ? p.trim() : null
}

/**
 * @param {string} templateId
 * @returns {boolean}
 */
export function hasGooglePreprocessPrompt(templateId) {
  return getGooglePreprocessPrompt(templateId) != null
}
