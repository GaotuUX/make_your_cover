/**
 * 标题背景:按 Figma 设计稿 151-150
 * - 网格图:顶部 96px 棋盘图案，使用 Vercel Blob 永久链接
 * - 渐变:CSS linear-gradient(#12a0fe → transparent)
 */
const TITLE_GRID_BLOB_URL =
  'https://q0jfcgvixtrtdlwj.public.blob.vercel-storage.com/uploads/1774319853899-Frame%202033198987-QFWlecdbLdn3JZdOwdgDCijRGg6fue.png'

const envUrl = import.meta.env.VITE_TITLE_GRID_URL as string | undefined
export const titleGridUrl: string = (envUrl && envUrl.startsWith('http')) ? envUrl : TITLE_GRID_BLOB_URL
