#!/usr/bin/env node
/**
 * 上传标题背景图到 Vercel Blob，获取永久链接
 * 用法:BLOB_READ_WRITE_TOKEN=xxx node scripts/upload-title-bg.mjs [图片路径]
 * 或:vercel env pull 后直接 node scripts/upload-title-bg.mjs
 */
import { put } from '@vercel/blob'
import { readFile } from 'fs/promises'
import { resolve } from 'path'

const defaultPath = resolve(process.cwd(), 'scripts/title-bg-upload.png')
const fallbackPath = resolve(process.cwd(), 'src/assets/title-bg.png')

async function main() {
  const inputPath = process.argv[2] || defaultPath
  let buffer
  try {
    buffer = await readFile(inputPath)
  } catch (e) {
    buffer = await readFile(fallbackPath)
    console.warn('使用 fallback 路径:', fallbackPath)
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    console.error('请设置 BLOB_READ_WRITE_TOKEN 环境变量')
    console.error('可从 Vercel 控制台 → Storage → Blob → 环境变量 获取')
    process.exit(1)
  }

  const blob = await put(
    `poster/title-bg-${Date.now()}.png`,
    buffer,
    { access: 'public', addRandomSuffix: false }
  )

  console.log(blob.url)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
