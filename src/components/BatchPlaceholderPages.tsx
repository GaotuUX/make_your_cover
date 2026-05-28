function BatchPlaceholderPage({ title }: { title: string }) {
  return (
    <main className="uploadPage">
      <section className="uploadPage__panel">
        <h2 className="uploadPage__title">{title}</h2>
        <p className="uploadPage__desc">该步骤将在后续批量生成流程中接入。</p>
      </section>
    </main>
  )
}

export function BatchPreviewPage() {
  return <BatchPlaceholderPage title="数据预览" />
}

export function BatchGeneratePage() {
  return <BatchPlaceholderPage title="批量生成中" />
}

export function BatchResultPage() {
  return <BatchPlaceholderPage title="批量结果" />
}
