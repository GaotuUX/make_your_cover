import { put } from '@vercel/blob'
import formidable from 'formidable'
import { buildBlobStorageKey } from '../lib/safeBlobUploadFilename.js'
import { readFile } from 'fs/promises'

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export default async function handler(req, res) {
  corsHeaders(res)
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const form = formidable({
      maxFileSize: 4 * 1024 * 1024, // 4MB，低于 Vercel 4.5MB 限制
      keepExtensions: true,
    })

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err)
        else resolve([fields, files])
      })
    })

    const file = files?.file?.[0]
    if (!file) {
      return res.status(400).json({
        error: 'no file uploaded',
        hint: '请选择一张图片上传，表单字段名为 file',
      })
    }

    const buffer = await readFile(file.filepath)
    const key = buildBlobStorageKey('uploads', file.originalFilename, file.mimetype)

    const blob = await put(key, buffer, {
      access: 'public',
      addRandomSuffix: true,
    })

    return res.json({ url: blob.url })
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'File too large',
        hint: '图片请小于 4MB，建议压缩或换小图。',
      })
    }
    console.error('[upload-image] error', err)
    return res.status(500).json({
      error: 'Upload failed',
      detail: err?.message || String(err),
    })
  }
}
