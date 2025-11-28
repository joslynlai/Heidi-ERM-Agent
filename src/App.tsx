import { useState } from 'react'

function App() {
  const [note, setNote] = useState('')

  return (
    <div className="app">
      <header className="header">
        <h1>Heidi Agent</h1>
        <p className="subtitle">OpenEMR Form Assistant</p>
      </header>

      <main className="main">
        <section className="note-section">
          <label htmlFor="note-input">Clinical Note</label>
          <textarea
            id="note-input"
            placeholder="Paste your Heidi note here..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </section>

        <div className="actions">
          <button className="btn btn-secondary">
            Scan Page
          </button>
          <button className="btn btn-primary" disabled={!note.trim()}>
            Auto-Fill Form
          </button>
        </div>
      </main>
    </div>
  )
}

export default App

