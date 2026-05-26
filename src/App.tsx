import { SchemeTwoPage } from './components/SchemeTwoPage'

export default function App() {
  return (
    <div className="demoPage">
      <header className="navBar">
        <div className="navBar__leading" aria-hidden />
        <h1 className="navBar__title">封面设计</h1>
        <div className="navBar__trailing" aria-hidden />
      </header>

      <SchemeTwoPage />
    </div>
  )
}
