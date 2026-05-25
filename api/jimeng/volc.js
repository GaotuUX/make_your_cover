import crypto from 'crypto'
import axios from 'axios'
import { AXIOS_NO_ENV_PROXY } from '../lib/axiosNoEnvProxy.js'

export function sha256Hex(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function hmac(key, content, encoding) {
  return crypto.createHmac('sha256', key).update(content).digest(encoding)
}

export function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function canonicalQueryString(urlObj) {
  const pairs = []
  for (const [k, v] of urlObj.searchParams.entries()) {
    pairs.push([encodeURIComponent(k), encodeURIComponent(v)])
  }
  pairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
  return pairs.map(([k, v]) => `${k}=${v}`).join('&')
}

function buildVolcAuthorization({
  accessKeyId,
  secretAccessKey,
  region,
  service,
  method,
  url,
  headersToSign,
  payload,
  xDate,
}) {
  const urlObj = new URL(url)
  const canonicalURI = urlObj.pathname || '/'
  const canonicalQS = canonicalQueryString(urlObj)
  const canonicalHeaderEntries = Object.entries(headersToSign)
    .map(([k, v]) => [k.toLowerCase().trim(), String(v).trim()])
    .sort((a, b) => a[0].localeCompare(b[0]))
  const canonicalHeaders = canonicalHeaderEntries.map(([k, v]) => `${k}:${v}\n`).join('')
  const signedHeaders = canonicalHeaderEntries.map(([k]) => k).join(';')
  const hashedPayload = sha256Hex(payload ?? '')
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalURI,
    canonicalQS,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n')
  const shortDate = xDate.slice(0, 8)
  const credentialScope = `${shortDate}/${region}/${service}/request`
  const stringToSign = ['HMAC-SHA256', xDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')
  const kDate = hmac(secretAccessKey, shortDate)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  const kSigning = hmac(kService, 'request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  return `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

const JIMENG_ACCESS_KEY_ID = process.env.JIMENG_ACCESS_KEY_ID
const JIMENG_SECRET_ACCESS_KEY = process.env.JIMENG_SECRET_ACCESS_KEY
const JIMENG_REGION = process.env.JIMENG_REGION || 'cn-beijing'
const JIMENG_SERVICE = process.env.JIMENG_SERVICE || 'cv'
const JIMENG_API_KEY = process.env.JIMENG_API_KEY

export function volcPost({ url, payload, useAKSK }) {
  const xDate = toAmzDate(new Date())
  const host = new URL(url).host
  const headers = { 'Content-Type': 'application/json', Host: host }
  if (useAKSK) {
    headers['X-Date'] = xDate
    headers.Authorization = buildVolcAuthorization({
      accessKeyId: JIMENG_ACCESS_KEY_ID,
      secretAccessKey: JIMENG_SECRET_ACCESS_KEY,
      region: JIMENG_REGION,
      service: JIMENG_SERVICE,
      method: 'POST',
      url,
      headersToSign: { host, 'x-date': xDate },
      payload,
      xDate,
    })
  } else {
    headers.Authorization = `Bearer ${JIMENG_API_KEY}`
  }
  return axios.post(url, payload, { headers, timeout: 120000, ...AXIOS_NO_ENV_PROXY })
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
