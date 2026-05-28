import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  COVER_TEMPLATES,
  getTemplatesForTheme,
  type CoverTemplate,
  type CoverThemeSelection,
} from '../data/coverTemplates'
import { exportBatchImagesAsZip, generateBatchCover } from '../utils/batchCoverGeneration'
import { parseBatchWorkbook, type ParsedBatchRow } from '../utils/excelBatch'
import { resolvePreviewImageUrl } from '../utils/uploadImage'
import { useToast } from './Toast/ToastProvider'

type BatchRowStatus = 'idle' | 'blocked' | 'queued' | 'prompting' | 'imaging' | 'success' | 'failed'

type BatchTableRow = {
  id: string
  level1: string
  level2: string
  level3: string
  title: string
  teacherImg: ParsedBatchRow['teacherImg']
  templateId: string
  status: BatchRowStatus
  resultImg: string | null
  error: string
}

const sampleRows = [
  ['教育动态', '教育政策', '升学新政', '高校专项计划', ''],
  ['', '', '双减动态', '学前教育法落地争议', ''],
  ['学科知识', '学科同步', '学科语文', '高中语文知识全解', ''],
  ['', '', '', '小学语文', ''],
  ['', '', '学科数学', '高中数学', ''],
]

export function UploadPage() {
  const { showApiError } = useToast()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [fileName, setFileName] = useState('')
  const [tableData, setTableData] = useState<BatchTableRow[]>([])
  const [running, setRunning] = useState(false)
  const batchAbortRef = useRef<AbortController | null>(null)
  const batchStopReasonRef = useRef<'user' | null>(null)

  const hasRows = tableData.length > 0
  const hasSuccess = tableData.some((row) => row.status === 'success' && row.resultImg)
  const hasFailed = tableData.some((row) => row.status === 'failed')

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const rows = await parseBatchWorkbook(file)
      if (rows.length === 0) {
        showApiError({ title: '解析 Excel 失败', data: { hint: '未读取到有效数据行' } })
        return
      }
      setFileName(file.name)
      setTableData(rows.map(toBatchRow))
    } catch (err) {
      showApiError({
        title: '解析 Excel 失败',
        data: { message: err instanceof Error ? err.message : String(err) },
      })
    } finally {
      e.target.value = ''
    }
  }

  function toBatchRow(row: ParsedBatchRow): BatchTableRow {
    const theme = buildTheme(row)
    const candidates = getTemplateCandidates(theme, !!row.teacherImg)
    const template = pickRandom(candidates)
    const blocked = !template
    return {
      id: `row-${row.rowNumber}`,
      level1: row.level1,
      level2: row.level2,
      level3: row.level3,
      title: row.title.slice(0, 10),
      teacherImg: row.teacherImg,
      templateId: template?.id || '',
      status: blocked ? 'blocked' : 'idle',
      resultImg: null,
      error: blocked ? '该分类下仅支持真人模版，请额外上传一张老师图片。' : '',
    }
  }

  function updateRow(rowId: string, patch: Partial<BatchTableRow>) {
    setTableData((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)))
  }

  async function handleStartGenerate() {
    await generateRows(tableData.filter((row) => row.status === 'idle' || row.status === 'failed'))
  }

  async function handleRetryFailed() {
    await generateRows(tableData.filter((row) => row.status === 'failed'))
  }

  async function handleRegenerate(row: BatchTableRow) {
    await generateRows([row])
  }

  async function generateRows(rows: BatchTableRow[]) {
    const runnableRows = rows.filter((row) => row.status !== 'blocked' && getTemplate(row))
    if (runnableRows.length === 0) return
    batchAbortRef.current?.abort()
    const ac = new AbortController()
    batchAbortRef.current = ac
    batchStopReasonRef.current = null
    setRunning(true)
    setTableData((prev) =>
      prev.map((row) =>
        runnableRows.some((item) => item.id === row.id)
          ? { ...row, status: 'queued', resultImg: null, error: '' }
          : row,
      ),
    )
    try {
      for (const row of runnableRows) {
        if (ac.signal.aborted) break
        updateRow(row.id, { status: 'prompting', error: '' })
        try {
          const template = getTemplate(row)
          if (!template) throw new Error('未选择模板')
          const resultImg = await generateBatchCover({
            title: row.title,
            theme: buildTheme(row),
            template,
            teacherFile: row.teacherImg
              ? new File([row.teacherImg.blob], row.teacherImg.name, { type: row.teacherImg.blob.type })
              : null,
            signal: ac.signal,
            onPhase: (phase) => {
              updateRow(row.id, { status: phase === 'prompt' ? 'prompting' : 'imaging' })
            },
          })
          updateRow(row.id, { status: 'success', resultImg })
        } catch (err) {
          const stoppedByUser = err instanceof Error && err.name === 'AbortError' && batchStopReasonRef.current === 'user'
          updateRow(row.id, {
            status: 'failed',
            error: stoppedByUser ? '用户手动停止' : err instanceof Error ? err.message : String(err),
          })
          if (stoppedByUser) break
        }
      }
    } finally {
      if (batchStopReasonRef.current === 'user') {
        setTableData((prev) =>
          prev.map((row) =>
            row.status === 'queued' || row.status === 'prompting' || row.status === 'imaging'
              ? { ...row, status: 'failed', error: '用户手动停止' }
              : row,
          ),
        )
      }
      setRunning(false)
      batchAbortRef.current = null
      batchStopReasonRef.current = null
    }
  }

  function handleStopGenerate() {
    batchStopReasonRef.current = 'user'
    batchAbortRef.current?.abort()
  }

  async function handleExport() {
    try {
      await exportBatchImagesAsZip(tableData, `${fileName.replace(/\.[^.]+$/, '') || 'batch-covers'}.zip`)
    } catch (err) {
      showApiError({
        title: '批量导出失败',
        data: { message: err instanceof Error ? err.message : String(err) },
      })
    }
  }

  return hasRows ? (
    <main className="batchPage">
      <header className="batchPage__toolbar">
        <div className="batchPage__meta">
          <h2>{fileName}</h2>
          <span>共 {tableData.length} 行</span>
        </div>
        <div className="batchPage__actions">
          {running || !hasSuccess ? (
            <>
              <button
                className="batchPrimaryButton"
                type="button"
                disabled={running}
                onClick={() => inputRef.current?.click()}
              >
                重新上传
              </button>
              <button
                className="batchPrimaryButton"
                type="button"
                onClick={running ? handleStopGenerate : handleStartGenerate}
              >
                {running ? '生成中' : '开始生成'}
              </button>
            </>
          ) : (
            <>
              <button
                className="batchPrimaryButton"
                type="button"
                disabled={running || !hasFailed}
                onClick={handleRetryFailed}
              >
                批量重试
              </button>
              <button className="batchPrimaryButton" type="button" onClick={handleExport}>
                批量导出
              </button>
            </>
          )}
        </div>
      </header>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.csv"
        className="uploadPage__fileInput"
        onChange={handleFileChange}
      />
      <BatchTable
        rows={tableData}
        running={running}
        onTitleChange={(id, title) => updateRow(id, { title: title.slice(0, 10) })}
        onTemplateChange={(id, templateId) => updateRow(id, { templateId, status: 'idle', error: '' })}
        onRegenerate={handleRegenerate}
      />
    </main>
  ) : (
    <main className="uploadPage">
      <section className="uploadPage__example" aria-label="Excel 文件格式示例">
        <div className="uploadExample">
          <div className="uploadExample__header">
            <span>一级标签</span>
            <span>二级标签</span>
            <span>三级标签</span>
            <span>标题</span>
            <span>老师图</span>
          </div>
          {sampleRows.map((row, rowIndex) => (
            <div className="uploadExample__row" key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <span
                  key={`${rowIndex}-${cellIndex}`}
                  className={cellIndex === 3 ? 'uploadExample__titleCell' : ''}
                >
                  {cell}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="uploadPage__panel">
        <h2 className="uploadPage__title">批量生成</h2>
        <p className="uploadPage__desc">
          请根据参考左侧图片所示制作 Excel 文件，点击下方按钮上传文件
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv"
          className="uploadPage__fileInput"
          onChange={handleFileChange}
        />
        <button
          type="button"
          className="uploadPage__button"
          onClick={() => inputRef.current?.click()}
        >
          上传文件
        </button>
      </section>
    </main>
  )
}

function BatchTable({
  rows,
  running,
  onTitleChange,
  onTemplateChange,
  onRegenerate,
}: {
  rows: BatchTableRow[]
  running: boolean
  onTitleChange: (id: string, title: string) => void
  onTemplateChange: (id: string, templateId: string) => void
  onRegenerate: (row: BatchTableRow) => void
}) {
  return (
    <div className="batchTableWrap">
      <table className="batchTable">
        <thead>
          <tr>
            <th>一级标签</th>
            <th>二级标签</th>
            <th>三级标签</th>
            <th>标题</th>
            <th>老师图</th>
            <th>模版</th>
            <th>生成结果</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <BatchTableRowView
              key={row.id}
              row={row}
              running={running}
              onTitleChange={onTitleChange}
              onTemplateChange={onTemplateChange}
              onRegenerate={onRegenerate}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BatchTableRowView({
  row,
  running,
  onTitleChange,
  onTemplateChange,
  onRegenerate,
}: {
  row: BatchTableRow
  running: boolean
  onTitleChange: (id: string, title: string) => void
  onTemplateChange: (id: string, templateId: string) => void
  onRegenerate: (row: BatchTableRow) => void
}) {
  const candidates = getTemplateCandidates(buildTheme(row), !!row.teacherImg)
  const template = getTemplate(row)

  return (
    <tr className={row.status === 'success' ? 'batchTable__row--success' : ''}>
      <td>{row.level1}</td>
      <td>{row.level2}</td>
      <td>{row.level3}</td>
      <td>
        <textarea
          className="batchTitleInput"
          value={row.title}
          maxLength={10}
          onChange={(e) => onTitleChange(row.id, e.target.value)}
        />
      </td>
      <td>
        {row.teacherImg ? (
          <a className="batchLink batchTeacherLink" href={row.teacherImg.url} target="_blank" rel="noreferrer">
            {row.teacherImg.name}
            <img src={row.teacherImg.url} alt="" />
          </a>
        ) : (
          <span className="batchMuted">-</span>
        )}
      </td>
      <td>
        {candidates.length > 0 ? (
          <TemplatePicker
            templates={candidates}
            selectedTemplate={template}
            onChange={(templateId) => onTemplateChange(row.id, templateId)}
          />
        ) : (
          <span className="batchErrorText">{row.error}</span>
        )}
      </td>
      <td>
        <BatchResult row={row} />
      </td>
      <td>
        {row.status === 'success' ? (
          <button
            className="batchTextButton"
            type="button"
            disabled={running}
            onClick={() => onRegenerate(row)}
          >
            重新生成
          </button>
        ) : (
          <span className="batchMuted">-</span>
        )}
      </td>
    </tr>
  )
}

function TemplatePicker({
  templates,
  selectedTemplate,
  onChange,
}: {
  templates: CoverTemplate[]
  selectedTemplate: CoverTemplate | null
  onChange: (templateId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (target instanceof Node && pickerRef.current?.contains(target)) return
      setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  return (
    <div className="batchTemplatePicker" ref={pickerRef}>
      <button
        type="button"
        className="batchTemplatePicker__trigger"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{selectedTemplate?.name || '选择模版'}</span>
      </button>
      {selectedTemplate && !open ? (
        <div className="batchTemplatePicker__hoverPreview" aria-hidden>
          <img src={selectedTemplate.imageUrl} alt="" />
        </div>
      ) : null}
      {open ? (
        <div className="batchTemplatePicker__menu">
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className={`batchTemplatePicker__option${tpl.id === selectedTemplate?.id ? ' batchTemplatePicker__option--active' : ''}`}
              onClick={() => {
                onChange(tpl.id)
                setOpen(false)
              }}
            >
              <img src={tpl.imageUrl} alt="" />
              <span>{tpl.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function BatchResult({ row }: { row: BatchTableRow }) {
  if (row.status === 'queued') {
    return <span className="batchGenerating">排队中</span>
  }
  if (row.status === 'prompting') {
    return <span className="batchGenerating">生成提示词中</span>
  }
  if (row.status === 'imaging') {
    return <span className="batchGenerating">生成图片中</span>
  }
  if (row.status === 'success' && row.resultImg) {
    return (
      <img
        className="batchResultImage"
        src={resolvePreviewImageUrl(row.resultImg)}
        alt={`${row.title} 生成结果`}
      />
    )
  }
  if (row.status === 'failed') {
    return (
      <span className="batchErrorText" title={row.error}>
        生成失败：{row.error}
      </span>
    )
  }
  if (row.status === 'blocked') {
    return <span>未生成</span>
  }
  return <span>未生成</span>
}

function buildTheme(row: Pick<BatchTableRow, 'level1' | 'level2' | 'level3'>): CoverThemeSelection {
  return {
    level1: row.level1,
    level2: row.level2,
    level3: row.level3,
  }
}

function getTemplate(row: Pick<BatchTableRow, 'templateId'>): CoverTemplate | null {
  return COVER_TEMPLATES.find((tpl) => tpl.id === row.templateId) || null
}

function getTemplateCandidates(theme: CoverThemeSelection, hasTeacherImage: boolean): CoverTemplate[] {
  const matched = getTemplatesForTheme(theme)
  if (hasTeacherImage) {
    const realPersonTemplates = matched.filter((tpl) => tpl.requiresReferenceImage)
    return realPersonTemplates.length > 0 ? realPersonTemplates : matched.filter((tpl) => !tpl.requiresReferenceImage)
  }
  return matched.filter((tpl) => !tpl.requiresReferenceImage)
}

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null
  return items[Math.floor(Math.random() * items.length)]
}
