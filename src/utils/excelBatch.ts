import JSZip from 'jszip'

export type ParsedTeacherImage = {
  name: string
  blob: Blob
  url: string
}

export type ParsedBatchRow = {
  rowNumber: number
  level1: string
  level2: string
  level3: string
  title: string
  teacherImg: ParsedTeacherImage | null
}

type WorkbookInfo = {
  sheetPath: string
}

type DrawingInfo = {
  path: string
  relsPath: string
  anchors: Map<number, string>
}

const CELL_REF_RE = /^([A-Z]+)(\d+)$/

export async function parseBatchWorkbook(file: File): Promise<ParsedBatchRow[]> {
  if (/\.csv$/i.test(file.name)) {
    return parseCsv(await file.text())
  }
  if (!/\.xlsx$/i.test(file.name)) {
    throw new Error('当前仅支持 .xlsx 或 .csv 文件；如为 .xls，请先另存为 .xlsx。')
  }

  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const workbook = await loadWorkbook(zip)
  const sharedStrings = await loadSharedStrings(zip)
  const sheetXml = await getText(zip, workbook.sheetPath)
  const drawing = await loadDrawing(zip, workbook.sheetPath, sheetXml)
  const teacherImages = drawing ? await loadTeacherImagesByRow(zip, drawing) : new Map()
  const cellsByRow = parseSheetRows(sheetXml, sharedStrings)

  return Array.from(cellsByRow.entries())
    .filter(([rowNumber]) => rowNumber > 1)
    .map(([rowNumber, row]) => ({
      rowNumber,
      level1: row.A || '',
      level2: row.B || '',
      level3: row.C || '',
      title: row.D || '',
      teacherImg: teacherImages.get(rowNumber) || null,
    }))
    .filter((row) => row.level1 || row.level2 || row.level3 || row.title || row.teacherImg)
}

async function getText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path)
  if (!file) throw new Error(`xlsx 缺少文件: ${path}`)
  return file.async('text')
}

async function getBlob(zip: JSZip, path: string): Promise<Blob> {
  const file = zip.file(path)
  if (!file) throw new Error(`xlsx 缺少文件: ${path}`)
  return file.async('blob')
}

async function loadWorkbook(zip: JSZip): Promise<WorkbookInfo> {
  const workbookXml = await getText(zip, 'xl/workbook.xml')
  const relsXml = await getText(zip, 'xl/_rels/workbook.xml.rels')
  const firstSheetRelId = workbookXml.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1]
  if (!firstSheetRelId) throw new Error('xlsx 未找到工作表')
  const target = findRelTarget(relsXml, firstSheetRelId)
  if (!target) throw new Error('xlsx 未找到工作表关系')
  return { sheetPath: normalizeXlsxPath('xl', target) }
}

async function loadSharedStrings(zip: JSZip): Promise<string[]> {
  const file = zip.file('xl/sharedStrings.xml')
  if (!file) return []
  const xml = await file.async('text')
  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)).map((match) =>
    decodeXml(Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((m) => m[1]).join('')),
  )
}

function parseSheetRows(sheetXml: string, sharedStrings: string[]): Map<number, Record<string, string>> {
  const rows = new Map<number, Record<string, string>>()
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowXml = rowMatch[1]
    for (const match of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = match[1]
      const body = match[2] || ''
      const ref = attrs.match(/\br="([^"]+)"/)?.[1]
      if (!ref) continue
      const refMatch = ref.match(CELL_REF_RE)
      if (!refMatch) continue
      const [, col, rowText] = refMatch
      if (!['A', 'B', 'C', 'D', 'E'].includes(col)) continue
      const rowNumber = Number(rowText)
      const value = parseCellValue(attrs, body, sharedStrings)
      const row = rows.get(rowNumber) || {}
      row[col] = value
      rows.set(rowNumber, row)
    }
  }
  return rows
}

function parseCellValue(attrs: string, body: string, sharedStrings: string[]): string {
  const type = attrs.match(/\bt="([^"]+)"/)?.[1]
  if (type === 'inlineStr') {
    return decodeXml(Array.from(body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((m) => m[1]).join('')).trim()
  }
  const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || ''
  if (!raw) return ''
  if (type === 's') {
    return (sharedStrings[Number(raw)] || '').trim()
  }
  return decodeXml(raw).trim()
}

async function loadDrawing(zip: JSZip, sheetPath: string, sheetXml: string): Promise<DrawingInfo | null> {
  const drawingRelId = sheetXml.match(/<drawing\b[^>]*r:id="([^"]+)"/)?.[1]
  if (!drawingRelId) return null
  const sheetDir = dirname(sheetPath)
  const sheetRelsPath = `${sheetDir}/_rels/${basename(sheetPath)}.rels`
  const sheetRelsXml = await getText(zip, sheetRelsPath)
  const drawingTarget = findRelTarget(sheetRelsXml, drawingRelId)
  if (!drawingTarget) return null
  const drawingPath = normalizeXlsxPath(sheetDir, drawingTarget)
  const drawingXml = await getText(zip, drawingPath)
  const drawingRelsPath = `${dirname(drawingPath)}/_rels/${basename(drawingPath)}.rels`
  return {
    path: drawingPath,
    relsPath: drawingRelsPath,
    anchors: parseDrawingAnchors(drawingXml),
  }
}

function parseDrawingAnchors(drawingXml: string): Map<number, string> {
  const anchors = new Map<number, string>()
  const anchorRe = /<xdr:(?:twoCellAnchor|oneCellAnchor)\b[^>]*>([\s\S]*?)<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g
  for (const match of drawingXml.matchAll(anchorRe)) {
    const block = match[1]
    const rowText = block.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/)?.[1]
    const embed = block.match(/<a:blip\b[^>]*r:embed="([^"]+)"/)?.[1]
    if (rowText && embed) {
      anchors.set(Number(rowText) + 1, embed)
    }
  }
  return anchors
}

async function loadTeacherImagesByRow(zip: JSZip, drawing: DrawingInfo): Promise<Map<number, ParsedTeacherImage>> {
  const relsXml = await getText(zip, drawing.relsPath)
  const relTargets = parseRelTargets(relsXml)
  const images = new Map<number, ParsedTeacherImage>()
  for (const [rowNumber, relId] of drawing.anchors) {
    const target = relTargets.get(relId)
    if (!target) continue
    const path = normalizeXlsxPath(dirname(drawing.path), target)
    const blob = await getBlob(zip, path)
    const name = basename(path)
    images.set(rowNumber, {
      name,
      blob,
      url: URL.createObjectURL(blob),
    })
  }
  return images
}

function parseRelTargets(relsXml: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const rel of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = rel[1]
    const id = attrs.match(/\bId="([^"]+)"/)?.[1]
    const target = attrs.match(/\bTarget="([^"]+)"/)?.[1]
    if (id && target) map.set(id, target)
  }
  return map
}

function findRelTarget(relsXml: string, relId: string): string | null {
  return parseRelTargets(relsXml).get(relId) || null
}

function parseCsv(text: string): ParsedBatchRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line)
    return {
      rowNumber: index + 2,
      level1: cells[0] || '',
      level2: cells[1] || '',
      level3: cells[2] || '',
      title: cells[3] || '',
      teacherImg: null,
    }
  })
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    const next = line[i + 1]
    if (char === '"' && quoted && next === '"') {
      current += '"'
      i += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells
}

function normalizeXlsxPath(baseDir: string, target: string): string {
  const raw = target.startsWith('/') ? target.slice(1) : `${baseDir}/${target}`
  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return parts.join('/')
}

function dirname(path: string): string {
  return path.split('/').slice(0, -1).join('/')
}

function basename(path: string): string {
  return path.split('/').pop() || path
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}
