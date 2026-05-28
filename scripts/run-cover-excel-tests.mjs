import fs from 'fs'
import path from 'path'
import readline from 'readline/promises'
import { stdin as input, stdout as output } from 'process'
import JSZip from 'jszip'

const DEFAULT_FILE = '0402代办-AI赋能运营内容封面.xlsx'
const DEFAULT_SHEET = '三级标签对应内容明细'
const DEFAULT_API_BASE = 'http://localhost:3000'
/** 已从产品模版库移除的 id：自动化测试永不遍历（即使 TS 误合并旧块也会被过滤） */
const AUTO_TEST_EXCLUDED_TEMPLATE_IDS = new Set(['tpl-campus-national-day-travel'])
const L1_COLUMN = 1
const L2_COLUMN = 2
const L3_COLUMN = 3
const TITLE_COLUMN = 4
const TEACHER_IMAGE_COLUMN = 5
const OUTPUT_START_COLUMN = 6
const IMAGE_WIDTH_PX = 160
const IMAGE_HEIGHT_PX = 213
const EMU_PER_PX = 9525

const args = parseArgs(process.argv.slice(2))
const startRow = Number(args['start-row'])
const endRow = Number(args['end-row'])
const dryRun = Boolean(args['dry-run'])
const workbookPath = args.file || DEFAULT_FILE
const sheetName = args.sheet || DEFAULT_SHEET
const apiBase = (args['api-base'] || DEFAULT_API_BASE).replace(/\/$/, '')

if (!Number.isInteger(startRow) || !Number.isInteger(endRow) || startRow < 2 || endRow < startRow) {
  throw new Error('请传入有效范围，例如: --start-row 2 --end-row 4')
}

await confirmRange({ startRow, endRow, dryRun, confirmed: args['confirmed-row-range'] })

const zipBuffer = fs.readFileSync(workbookPath)
const zip = await JSZip.loadAsync(zipBuffer)
const workbook = await loadWorkbook(zip, sheetName)
const sharedStrings = await loadSharedStrings(zip)
const sheetXml = await getText(zip, workbook.sheetPath)
const rows = parseRows(sheetXml, sharedStrings)
const templates = parseTemplates(fs.readFileSync('src/data/coverTemplates.ts', 'utf8')).filter(
  (t) => !AUTO_TEST_EXCLUDED_TEMPLATE_IDS.has(t.id),
)
const taxonomy = parseTaxonomy(fs.readFileSync('src/data/coverThemeTaxonomy.ts', 'utf8'))
const drawing = await loadDrawing(zip, workbook.sheetPath, sheetXml)
const teacherImagesByRow = await loadTeacherImagesByRow(zip, drawing)

const plan = buildRunPlan({ rows, templates, taxonomy, teacherImagesByRow, startRow, endRow })
printPlan(plan, { dryRun })

if (dryRun) {
  process.exit(0)
}

let mutableSheetXml = sheetXml
let mutableDrawingXml = drawing.xml
let mutableDrawingRelsXml = drawing.relsXml
const occupiedImagesByRow = buildOccupiedImagesByRow(drawing.anchors)
const outputPath =
  args.output ||
  workbookPath.replace(/\.xlsx$/i, `.generated-${startRow}-${endRow}.xlsx`)

for (const rowPlan of plan) {
  if (!rowPlan.title) {
    console.log(`[row ${rowPlan.row}] 跳过: 标题为空`)
    continue
  }
  if (!rowPlan.templates.length) {
    console.log(`[row ${rowPlan.row}] 跳过: ${rowPlan.l1}/${rowPlan.l2} 没有匹配模版`)
    continue
  }

  console.log(`[row ${rowPlan.row}] 开始: ${rowPlan.l1}/${rowPlan.l2}《${rowPlan.title}》`)
  let teacherImageUrl = null
  if (rowPlan.teacherImage) {
    teacherImageUrl = writeTeacherImageToUploads(rowPlan)
    console.log(`[row ${rowPlan.row}] 老师图: ${teacherImageUrl}`)
  }

  for (const tpl of rowPlan.templates) {
    if (tpl.requiresReferenceImage && !teacherImageUrl) {
      console.log(`[row ${rowPlan.row}] 跳过模版 ${tpl.name}: 需要老师图但本行为空`)
      continue
    }

    console.log(`[row ${rowPlan.row}] 生成模版: ${tpl.name}`)
    const generated = await generateCoverForTemplate({
      apiBase,
      rowPlan,
      template: tpl,
      teacherImageUrl,
    })

    const promptCol = findNextOutputColumn({
      row: rowPlan.row,
      rows,
      occupiedImagesByRow,
      startCol: OUTPUT_START_COLUMN,
    })
    mutableSheetXml = ensureHeader(mutableSheetXml, promptCol, `${tpl.name}提示词`)
    mutableSheetXml = ensureColumnWidth(mutableSheetXml, promptCol, 48)
    mutableSheetXml = writeInlineStringCell(mutableSheetXml, rowPlan.row, promptCol, generated.prompt)
    setRowCell(rows, rowPlan.row, promptCol, generated.prompt)
    console.log(`[row ${rowPlan.row}] 已写入 ${colToName(promptCol)}${rowPlan.row}: ${tpl.name}提示词`)

    for (let imageIndex = 0; imageIndex < generated.imageUrls.length; imageIndex++) {
      const imageUrl = generated.imageUrls[imageIndex]
      const image = await loadImageForEmbed(imageUrl)
      const col = findNextOutputColumn({
        row: rowPlan.row,
        rows,
        occupiedImagesByRow,
        startCol: OUTPUT_START_COLUMN,
      })
      occupiedImagesByRow.get(rowPlan.row)?.add(col) ?? occupiedImagesByRow.set(rowPlan.row, new Set([col]))
      mutableSheetXml = ensureHeader(mutableSheetXml, col, `${tpl.name}图${imageIndex + 1}`)
      mutableSheetXml = ensureRowHeight(mutableSheetXml, rowPlan.row, IMAGE_HEIGHT_PX)
      mutableSheetXml = ensureColumnWidth(mutableSheetXml, col)
      const added = await addImageToWorkbook({
        zip,
        drawing,
        drawingXml: mutableDrawingXml,
        drawingRelsXml: mutableDrawingRelsXml,
        image,
        row: rowPlan.row,
        col,
        alt: `${rowPlan.title}-${tpl.name}-${imageIndex + 1}`,
      })
      mutableDrawingXml = added.drawingXml
      mutableDrawingRelsXml = added.drawingRelsXml
      console.log(`[row ${rowPlan.row}] 已写入 ${colToName(col)}${rowPlan.row}: ${tpl.name}图${imageIndex + 1}`)
    }
  }
  await saveWorkbook({
    zip,
    workbook,
    drawing,
    sheetXml: mutableSheetXml,
    drawingXml: mutableDrawingXml,
    drawingRelsXml: mutableDrawingRelsXml,
    outputPath,
  })
  console.log(`[row ${rowPlan.row}] 已保存到 ${outputPath}`)
}

console.log(`完成，输出文件: ${outputPath}`)

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      out[key] = true
    } else {
      out[key] = next
      i++
    }
  }
  return out
}

async function saveWorkbook({
  zip,
  workbook,
  drawing,
  sheetXml,
  drawingXml,
  drawingRelsXml,
  outputPath,
}) {
  zip.file(workbook.sheetPath, sheetXml)
  zip.file(drawing.path, drawingXml)
  zip.file(drawing.relsPath, drawingRelsXml)
  zip.file('[Content_Types].xml', ensureImageContentTypes(await getText(zip, '[Content_Types].xml')))
  const outBuffer = await zip.generateAsync({ type: 'nodebuffer' })
  fs.writeFileSync(outputPath, outBuffer)
}

async function confirmRange({ startRow, endRow, dryRun, confirmed }) {
  const expected = `${startRow}-${endRow}`
  if (confirmed === expected) return
  const rl = readline.createInterface({ input, output })
  const answer = await rl.question(
    `确认${dryRun ? '检查' : '执行生成'} Excel 行范围 ${expected}？请输入 ${expected} 继续: `,
  )
  rl.close()
  if (answer.trim() !== expected) {
    throw new Error(`已取消: 输入 ${answer.trim() || '(空)'} 与 ${expected} 不一致`)
  }
}

async function getText(zip, filePath) {
  const file = zip.file(filePath)
  if (!file) throw new Error(`xlsx 缺少文件: ${filePath}`)
  return file.async('string')
}

async function getBuffer(zip, filePath) {
  const file = zip.file(filePath)
  if (!file) throw new Error(`xlsx 缺少文件: ${filePath}`)
  return file.async('nodebuffer')
}

async function loadWorkbook(zip, targetSheetName) {
  const workbookXml = await getText(zip, 'xl/workbook.xml')
  const relsXml = await getText(zip, 'xl/_rels/workbook.xml.rels')
  const rels = parseRelationships(relsXml)
  const sheetRe = /<sheet\b([^>]*)\/>/g
  let match
  while ((match = sheetRe.exec(workbookXml))) {
    const attrs = parseAttrs(match[1])
    if (attrs.name !== targetSheetName) continue
    const target = rels.get(attrs['r:id'])
    if (!target) throw new Error(`找不到 sheet relationship: ${attrs['r:id']}`)
    return { sheetPath: resolveRelationshipTarget('xl/workbook.xml', target) }
  }
  throw new Error(`找不到 sheet: ${targetSheetName}`)
}

async function loadSharedStrings(zip) {
  const file = zip.file('xl/sharedStrings.xml')
  if (!file) return []
  const xml = await file.async('string')
  return [...xml.matchAll(/<si\b[\s\S]*?<\/si>/g)].map(([si]) =>
    [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join(''),
  )
}

function parseRows(sheetXml, sharedStrings) {
  const rows = new Map()
  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowAttrs = parseAttrs(rowMatch[1])
    const rowNum = Number(rowAttrs.r)
    const cells = new Map()
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = parseAttrs(cellMatch[1])
      const ref = attrs.r
      if (!ref) continue
      const col = colNameToNumber(ref.match(/[A-Z]+/)?.[0] || '')
      cells.set(col, readCellValue(attrs, cellMatch[2] || '', sharedStrings))
    }
    rows.set(rowNum, cells)
  }
  return rows
}

function readCellValue(attrs, xml, sharedStrings) {
  if (attrs.t === 'inlineStr') {
    return [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('')
  }
  const value = xml.match(/<v>([\s\S]*?)<\/v>/)?.[1]
  if (value == null) return null
  if (attrs.t === 's') return sharedStrings[Number(value)] ?? value
  return decodeXml(value)
}

async function loadDrawing(zip, sheetPath, sheetXml) {
  const sheetRelsPath = `${path.posix.dirname(sheetPath)}/_rels/${path.posix.basename(sheetPath)}.rels`
  const relsXml = await getText(zip, sheetRelsPath)
  const sheetRels = parseRelationships(relsXml)
  const drawingRid = sheetXml.match(/<drawing\b[^>]*r:id="([^"]+)"/)?.[1]
  if (!drawingRid) throw new Error('当前 sheet 没有 drawing，无法保留/追加嵌入图片')
  const drawingPath = resolveRelationshipTarget(sheetPath, sheetRels.get(drawingRid))
  const drawingRelsPath = `${path.posix.dirname(drawingPath)}/_rels/${path.posix.basename(drawingPath)}.rels`
  const drawingXml = await getText(zip, drawingPath)
  const drawingRelsXml = await getText(zip, drawingRelsPath)
  return {
    path: drawingPath,
    relsPath: drawingRelsPath,
    xml: drawingXml,
    relsXml: drawingRelsXml,
    rels: parseRelationships(drawingRelsXml),
    anchors: parseImageAnchors(drawingXml, parseRelationships(drawingRelsXml), drawingPath),
  }
}

function parseRelationships(xml) {
  const rels = new Map()
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const attrs = parseAttrs(m[1])
    rels.set(attrs.Id, attrs.Target)
  }
  return rels
}

function parseAttrs(s) {
  const attrs = {}
  for (const m of s.matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[m[1]] = decodeXml(m[2])
  return attrs
}

function parseImageAnchors(drawingXml, rels, drawingPath) {
  const anchors = []
  for (const anchor of drawingXml.matchAll(/<xdr:(?:oneCellAnchor|twoCellAnchor)\b[\s\S]*?<\/xdr:(?:oneCellAnchor|twoCellAnchor)>/g)) {
    const xml = anchor[0]
    const col = Number(xml.match(/<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>/)?.[1]) + 1
    const row = Number(xml.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/)?.[1]) + 1
    const rid = xml.match(/<a:blip\b[^>]*r:embed="([^"]+)"/)?.[1]
    const target = rid ? rels.get(rid) : null
    if (Number.isInteger(row) && Number.isInteger(col) && target) {
      anchors.push({ row, col, mediaPath: resolveRelationshipTarget(drawingPath, target) })
    }
  }
  return anchors
}

async function loadTeacherImagesByRow(zip, drawing) {
  const out = new Map()
  for (const anchor of drawing.anchors) {
    if (anchor.col !== TEACHER_IMAGE_COLUMN) continue
    if (out.has(anchor.row)) continue
    const buffer = await getBuffer(zip, anchor.mediaPath)
    out.set(anchor.row, {
      mediaPath: anchor.mediaPath,
      buffer,
      ext: mediaExt(anchor.mediaPath),
    })
  }
  return out
}

function parseTemplates(text) {
  const templates = []
  const objectRe = /\{\s*id:\s*'([^']+)'([\s\S]*?)themeBindings:\s*\[([\s\S]*?)\]\s*,?\s*\}/g
  for (const m of text.matchAll(objectRe)) {
    const id = m[1]
    const body = m[2]
    const bindingsText = m[3]
    const name = body.match(/name:\s*'([^']+)'/)?.[1] || id
    const jimengModel = body.match(/jimengModel:\s*'([^']+)'/)?.[1] || 'image_4_0'
    const requiresReferenceImage = /requiresReferenceImage:\s*true/.test(body)
    const prompt = body.match(/prompt:\s*'([\s\S]*?)'\s*,/)?.[1] || ''
    const bindings = []
    for (const b of bindingsText.matchAll(/\{\s*l1:\s*'([^']+)'(?:\s*,\s*l2:\s*'([^']+)')?(?:\s*,\s*l3:\s*'([^']+)')?\s*\}/g)) {
      bindings.push({ l1: b[1], l2: b[2] || null, l3: b[3] || null })
    }
    templates.push({ id, name, jimengModel, requiresReferenceImage, prompt, bindings })
  }
  return templates
}

function parseTaxonomy(text) {
  const taxonomy = new Map()
  let currentL1 = null
  for (const line of text.split(/\r?\n/)) {
    const l1 = line.match(/^\s{4}name:\s*'([^']+)'/)?.[1]
    if (l1) currentL1 = l1
    const l2 = line.match(/^\s{8}name:\s*'([^']+)'/)?.[1]
    const l3Line = line.includes('level3: l3(') ? line : null
    if (currentL1 && l2) {
      taxonomy.set(`${currentL1}\u0000${l2}`, [])
    }
    if (currentL1 && l3Line) {
      const names = [...l3Line.matchAll(/'([^']+)'/g)].map((m) => m[1])
      const lastKey = [...taxonomy.keys()].at(-1)
      if (lastKey) taxonomy.set(lastKey, names)
    }
  }
  return taxonomy
}

function buildRunPlan({ rows, templates, taxonomy, teacherImagesByRow, startRow, endRow }) {
  const plan = []
  let currentL1 = ''
  let currentL2 = ''
  let currentL3 = ''
  for (let row = 2; row <= endRow; row++) {
    const cells = rows.get(row) || new Map()
    if (cells.get(L1_COLUMN)) currentL1 = cells.get(L1_COLUMN)
    if (cells.get(L2_COLUMN)) currentL2 = cells.get(L2_COLUMN)
    if (cells.get(L3_COLUMN)) currentL3 = cells.get(L3_COLUMN)
    if (row < startRow) continue
    const title = (cells.get(TITLE_COLUMN) || '').trim()
    const l3 = currentL3 || taxonomy.get(`${currentL1}\u0000${currentL2}`)?.[0] || currentL2
    const matched = templates.filter((tpl) =>
      tpl.bindings.some((b) =>
        b.l1 === currentL1 &&
        (b.l2 == null || b.l2 === currentL2) &&
        (b.l3 == null || b.l3 === l3),
      ),
    )
    plan.push({
      row,
      l1: currentL1,
      l2: currentL2,
      l3,
      title,
      templates: matched,
      teacherImage: teacherImagesByRow.get(row) || null,
    })
  }
  return plan
}

function printPlan(plan, { dryRun }) {
  console.log(`${dryRun ? '检查' : '执行'}计划:`)
  for (const p of plan) {
    const names = p.templates.map((t) => `${t.name}${t.requiresReferenceImage ? '(需老师图)' : ''}`).join('、') || '无'
    console.log(
      `- row ${p.row}: ${p.l1}/${p.l2}/${p.l3} | 标题=${p.title || '(空)'} | 老师图=${p.teacherImage ? '有' : '无'} | 模版=${names}`,
    )
  }
}

function writeTeacherImageToUploads(rowPlan) {
  const ext = detectImageExt(rowPlan.teacherImage.buffer) || rowPlan.teacherImage.ext || 'jpeg'
  const dir = path.join('server', 'uploads')
  fs.mkdirSync(dir, { recursive: true })
  const name = `excel-row-${rowPlan.row}-${Date.now()}.${ext}`
  const filePath = path.join(dir, name)
  fs.writeFileSync(filePath, rowPlan.teacherImage.buffer)
  return `${apiBase}/uploads/${name}`
}

function detectImageExt(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png'
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg'
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'webp'
  }
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return 'gif'
  }
  return null
}

async function generateCoverForTemplate({ apiBase, rowPlan, template, teacherImageUrl }) {
  const promptRes = await fetchJson(`${apiBase}/api/doubao`, {
    mode: 'scheme2',
    themePath: `${rowPlan.l1} · ${rowPlan.l2} · ${rowPlan.l3}`,
    title: rowPlan.title,
    subtitle: '',
    templatePrompt: template.prompt,
  })
  const prompt = promptRes.text
  if (!prompt || typeof prompt !== 'string') throw new Error(`row ${rowPlan.row}: 豆包未返回文案`)

  let refUrl = teacherImageUrl
  if (refUrl && template.requiresReferenceImage) {
    const pre = await fetchJson(`${apiBase}/api/jimeng-preprocess-reference`, {
      imageUrl: refUrl,
      jimengModel: template.jimengModel,
    })
    refUrl = pre.optimizedImageUrl
  }

  const response = await fetch(`${apiBase}/api/scheme2-generate-cover-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      prompt,
      jimengModel: template.jimengModel,
      testMode: true,
      ...(template.requiresReferenceImage && refUrl ? { imageUrls: [refUrl] } : {}),
    }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`生成失败 ${response.status}: ${body}`)
  }
  const streamText = await response.text()
  const events = parseSseEvents(streamText)
  const errorEvent = events.find((ev) => ev.event === 'error' || ev.event === 'failed')
  if (errorEvent) {
    throw new Error(formatSseError(errorEvent))
  }
  const done = [...events].reverse().find((ev) => ev.event === 'done' || ev.event === 'recommend')
  const imageUrls =
    (Array.isArray(done?.data?.imageUrls) ? done.data.imageUrls : null) ||
    events
      .filter((ev) => ev.event === 'processImage' && ev.data?.url)
      .sort((a, b) => Number(a.data.index || 0) - Number(b.data.index || 0))
      .map((ev) => ev.data.url)
  if (!Array.isArray(imageUrls) || imageUrls.length < 4) {
    throw new Error(`生成结果未返回 4 张图片，仅收到 ${Array.isArray(imageUrls) ? imageUrls.length : 0} 张`)
  }
  return { prompt, imageUrls: imageUrls.slice(0, 4) }
}

function formatSseError(errorEvent) {
  const data = errorEvent?.data
  if (!data || typeof data !== 'object') {
    return typeof data === 'string' && data ? data : '生成失败'
  }
  const parts = [
    data.hint,
    data.error,
    data.message,
    data.detail,
  ].filter((item) => item != null && item !== '')
  if (parts.length === 0) return '生成失败'
  return parts
    .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
    .join(' | ')
}

function formatHttpJsonErrorBody(data) {
  if (!data || typeof data !== 'object') return ''
  const parts = []
  for (const k of ['hint', 'message', 'error']) {
    const v = data[k]
    if (v == null || v === '') continue
    parts.push(typeof v === 'string' ? v : JSON.stringify(v))
  }
  if (data.detail != null) {
    parts.push(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail))
  }
  return parts.filter(Boolean).join(' | ')
}

async function fetchJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(formatHttpJsonErrorBody(data) || `${url} ${res.status}`)
  }
  return data
}

function parseSseEvents(text) {
  return text
    .split(/\n\n+/)
    .map((block) => {
      const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() || 'message'
      const dataText = [...block.matchAll(/^data:\s*(.*)$/gm)].map((m) => m[1]).join('\n')
      let data = dataText
      try {
        data = JSON.parse(dataText)
      } catch {
        // keep string
      }
      return { event, data }
    })
    .filter((ev) => ev.event)
}

async function loadImageForEmbed(imageUrl) {
  if (imageUrl.startsWith('data:')) {
    const m = imageUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
    if (!m) throw new Error('不支持的 data URL 图片')
    return { buffer: Buffer.from(m[2], 'base64'), ext: extFromMime(m[1]) }
  }
  const res = await fetch(imageUrl)
  if (!res.ok) throw new Error(`下载生成图失败 ${res.status}: ${imageUrl}`)
  const mime = res.headers.get('content-type') || 'image/png'
  return { buffer: Buffer.from(await res.arrayBuffer()), ext: extFromMime(mime) }
}

function findNextOutputColumn({ row, rows, occupiedImagesByRow, startCol }) {
  const cells = rows.get(row) || new Map()
  const imageCols = occupiedImagesByRow.get(row) || new Set()
  let col = startCol
  while ((cells.get(col) != null && cells.get(col) !== '') || imageCols.has(col)) col++
  return col
}

function buildOccupiedImagesByRow(anchors) {
  const out = new Map()
  for (const a of anchors) {
    if (!out.has(a.row)) out.set(a.row, new Set())
    out.get(a.row).add(a.col)
  }
  return out
}

async function addImageToWorkbook({ zip, drawing, drawingXml, drawingRelsXml, image, row, col, alt }) {
  const nextMediaIndex = nextImageIndex(zip)
  const mediaName = `image${nextMediaIndex}.${image.ext}`
  const mediaPath = `xl/media/${mediaName}`
  zip.file(mediaPath, image.buffer)

  const nextRid = nextRelationshipId(drawingRelsXml)
  const rel = `<Relationship Id="${nextRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/>`
  const updatedRels = drawingRelsXml.replace('</Relationships>', `${rel}</Relationships>`)
  const nextPicId = nextPictureId(drawingXml)
  const anchor = buildOneCellImageAnchor({ row, col, rid: nextRid, picId: nextPicId, alt })
  const updatedDrawing = drawingXml.replace('</xdr:wsDr>', `${anchor}</xdr:wsDr>`)
  drawing.anchors.push({ row, col, mediaPath })
  return { drawingXml: updatedDrawing, drawingRelsXml: updatedRels }
}

function buildOneCellImageAnchor({ row, col, rid, picId, alt }) {
  const safeAlt = escapeXml(alt)
  return `<xdr:oneCellAnchor><xdr:from><xdr:col>${col - 1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${IMAGE_WIDTH_PX * EMU_PER_PX}" cy="${IMAGE_HEIGHT_PX * EMU_PER_PX}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${picId}" name="${safeAlt}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${IMAGE_WIDTH_PX * EMU_PER_PX}" cy="${IMAGE_HEIGHT_PX * EMU_PER_PX}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`
}

function ensureHeader(sheetXml, col, header) {
  const rowRe = /<row\b([^>]*)r="1"([^>]*)>([\s\S]*?)<\/row>/
  const m = sheetXml.match(rowRe)
  if (!m) return sheetXml
  const ref = `${colToName(col)}1`
  if (m[0].includes(`r="${ref}"`)) return sheetXml
  const cell = `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(header)}</t></is></c>`
  const updatedRow = m[0].replace('</row>', `${cell}</row>`)
  return sheetXml.replace(m[0], updatedRow)
}

function writeInlineStringCell(sheetXml, row, col, value) {
  const rowXml = findRowXml(sheetXml, row)
  if (!rowXml) throw new Error(`找不到第 ${row} 行，无法写入文本`)
  const ref = `${colToName(col)}${row}`
  if (rowXml.includes(`r="${ref}"`)) {
    throw new Error(`拒绝覆盖已有单元格 ${ref}`)
  }
  const cell = `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`
  const updatedRow = rowXml.replace('</row>', `${cell}</row>`)
  return sheetXml.replace(rowXml, updatedRow)
}

function setRowCell(rows, row, col, value) {
  if (!rows.has(row)) rows.set(row, new Map())
  rows.get(row).set(col, value)
}

function ensureRowHeight(sheetXml, row, heightPx) {
  const heightPt = Math.round(heightPx * 0.75)
  const rowXml = findRowXml(sheetXml, row)
  if (!rowXml) return sheetXml
  let tag = rowXml.match(/^<row\b[^>]*>/)?.[0]
  if (!tag) return sheetXml
  tag = setOrAddAttr(tag, 'ht', String(heightPt))
  tag = setOrAddAttr(tag, 'customHeight', '1')
  return sheetXml.replace(rowXml, rowXml.replace(/^<row\b[^>]*>/, tag))
}

function findRowXml(sheetXml, row) {
  const re = new RegExp(`<row\\b(?=[^>]*\\br="${row}")[^>]*>[\\s\\S]*?<\\/row>`)
  return sheetXml.match(re)?.[0] || null
}

function ensureColumnWidth(sheetXml, col, width = 24) {
  const colNode = `<col min="${col}" max="${col}" width="${width}" customWidth="1"/>`
  if (sheetXml.includes(`<col min="${col}" max="${col}"`)) return sheetXml
  if (sheetXml.includes('<cols>')) return sheetXml.replace('</cols>', `${colNode}</cols>`)
  return sheetXml.replace('<sheetData>', `<cols>${colNode}</cols><sheetData>`)
}

function setOrAddAttr(tag, attr, value) {
  const attrRe = new RegExp(`(\\s)${attr}="[^"]*"`)
  if (attrRe.test(tag)) {
    return tag.replace(attrRe, `$1${attr}="${escapeXml(value)}"`)
  }
  return tag.replace(/>$/, ` ${attr}="${escapeXml(value)}">`)
}

function ensureImageContentTypes(xml) {
  let out = xml
  const defaults = [
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['jpg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ]
  for (const [ext, type] of defaults) {
    if (!new RegExp(`<Default[^>]*Extension="${ext}"`).test(out)) {
      out = out.replace('</Types>', `<Default Extension="${ext}" ContentType="${type}"/></Types>`)
    }
  }
  return out
}

function nextImageIndex(zip) {
  let max = 0
  for (const name of Object.keys(zip.files)) {
    const m = name.match(/^xl\/media\/image(\d+)\./)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

function nextRelationshipId(xml) {
  let max = 0
  for (const m of xml.matchAll(/\bId="rId(\d+)"/g)) max = Math.max(max, Number(m[1]))
  return `rId${max + 1}`
}

function nextPictureId(xml) {
  let max = 0
  for (const m of xml.matchAll(/<xdr:cNvPr\b[^>]*\bid="(\d+)"/g)) max = Math.max(max, Number(m[1]))
  return max + 1
}

function resolveRelationshipTarget(fromPath, target) {
  if (!target) throw new Error(`缺少 relationship target: ${fromPath}`)
  if (target.startsWith('/')) return target.replace(/^\//, '')
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), target))
}

function colNameToNumber(name) {
  let n = 0
  for (const ch of name) n = n * 26 + ch.charCodeAt(0) - 64
  return n
}

function colToName(num) {
  let n = num
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function mediaExt(filePath) {
  const ext = path.extname(filePath).replace('.', '').toLowerCase()
  return ext === 'jpg' ? 'jpeg' : ext || 'png'
}

function extFromMime(mime) {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpeg'
  if (mime.includes('webp')) return 'webp'
  return 'png'
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
