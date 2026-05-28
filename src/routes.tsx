import type { ComponentType } from 'react'
import { BatchGeneratePage, BatchPreviewPage, BatchResultPage } from './components/BatchPlaceholderPages'
import { SchemeTwoPage } from './components/SchemeTwoPage'
import { UploadPage } from './components/UploadPage'

export type AppRoute = {
  path: string
  title: string
  component: ComponentType
}

export const appRoutes: AppRoute[] = [
  {
    path: '/',
    title: '单张生成',
    component: SchemeTwoPage,
  },
  {
    path: '/batch/upload',
    title: '上传 Excel',
    component: UploadPage,
  },
  {
    path: '/batch/preview',
    title: '数据预览',
    component: BatchPreviewPage,
  },
  {
    path: '/batch/generate',
    title: '批量生成',
    component: BatchGeneratePage,
  },
  {
    path: '/batch/result',
    title: '批量结果',
    component: BatchResultPage,
  },
]

export function getRouteByPath(pathname: string) {
  return appRoutes.find((route) => route.path === pathname) ?? appRoutes[0]
}
