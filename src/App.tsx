import { useState, useCallback } from 'react'
import { generateMapping } from './services/ai'

interface LogEntry {
  id: number
  message: string
  type: 'info' | 'success' | 'error' | 'debug'
  timestamp: Date
  data?: unknown
}

interface FormField {
  id: string
  name: string
  type: string
  placeholder: string
  label: string
  tagName: string
  options?: string[]
}

function App() {
  const [apiKey, setApiKey] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<'idle' | 'scanning' | 'mapping' | 'filling' | 'done' | 'error'>('idle')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [showDebug, setShowDebug] = useState(true)

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info', data?: unknown) => {
    setLogs(prev => [...prev, {
      id: Date.now() + Math.random(),
      message,
      type,
      timestamp: new Date(),
      data
    }])
  }, [])

  const clearLogs = useCallback(() => {
    setLogs([])
  }, [])

  // Ensure content script is injected and ready
  const ensureContentScript = async (tabId: number): Promise<void> => {
    try {
      // Try to ping the content script first
      await chrome.tabs.sendMessage(tabId, { type: 'PING' })
    } catch {
      // Content script not loaded, inject it
      addLog('Injecting content script...')
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      })
      // Small delay to ensure script is ready
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  const handleAutoFill = async () => {
    // Validation
    if (!apiKey.trim()) {
      addLog('Please enter your Gemini API key', 'error')
      return
    }
    if (!note.trim()) {
      addLog('Please paste a clinical note', 'error')
      return
    }

    clearLogs()
    
    try {
      // Step A: Scan the page
      setStatus('scanning')
      addLog('📡 Step 1: Scanning page for form fields...')

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      
      if (!tab?.id) {
        throw new Error('No active tab found')
      }

      // Ensure content script is loaded
      await ensureContentScript(tab.id)

      const scanResponse = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_PAGE' })
      
      if (!scanResponse.success) {
        throw new Error(scanResponse.error || 'Failed to scan page')
      }

      const schema = scanResponse.data
      addLog(`✅ Found ${schema.fields.length} form fields on page`, 'success')
      
      // Log each field found
      if (schema.fields.length > 0) {
        addLog('📋 SCAN RESULT - Fields detected:', 'debug', schema.fields)
        schema.fields.forEach((field: FormField, index: number) => {
          const identifier = field.id || field.name || '(no id/name)'
          const label = field.label || field.placeholder || '(no label)'
          addLog(`  ${index + 1}. [${field.type}] ${identifier} → "${label}"`, 'debug')
        })
      }
      
      if (schema.fields.length === 0) {
        throw new Error('No form fields found on this page')
      }

      // Step B: Generate mapping using AI
      setStatus('mapping')
      addLog('🤖 Step 2: Sending to Gemini AI for analysis...')
      addLog(`📝 Note preview: "${note.substring(0, 100)}${note.length > 100 ? '...' : ''}"`, 'debug')
      
      const mapping = await generateMapping(note, schema, apiKey)
      const fieldCount = Object.keys(mapping).length
      
      addLog('📋 AI MAPPING RESULT:', 'debug', mapping)
      
      if (fieldCount === 0) {
        addLog('⚠️ AI returned empty mapping - no fields matched', 'error')
        throw new Error('AI could not map any fields from the note. Check debug logs above.')
      }
      
      addLog(`✅ AI mapped ${fieldCount} fields from note`, 'success')
      
      // Log each mapping
      Object.entries(mapping).forEach(([fieldId, value]) => {
        addLog(`  → ${fieldId}: "${value}"`, 'debug')
      })

      // Step C: Fill the form
      setStatus('filling')
      addLog('✏️ Step 3: Filling form fields...')

      const fillResponse = await chrome.tabs.sendMessage(tab.id, { 
        type: 'FILL_FORM', 
        mapping 
      })

      if (!fillResponse.success) {
        throw new Error(fillResponse.error || 'Failed to fill form')
      }

      const result = fillResponse.data
      addLog('📋 FILL RESULT:', 'debug', result)
      
      if (result.filled.length > 0) {
        addLog(`✅ Successfully filled: ${result.filled.join(', ')}`, 'success')
      }
      
      if (result.failed.length > 0) {
        addLog(`⚠️ Failed to fill: ${result.failed.join(', ')}`, 'error')
      }
      if (result.notFound.length > 0) {
        addLog(`❌ Fields not found on page: ${result.notFound.join(', ')}`, 'error')
        addLog('💡 Tip: AI returned field IDs that don\'t exist. Check scan result above for valid IDs.', 'info')
      }

      setStatus('done')
      addLog('🎉 Auto-fill complete!', 'success')

    } catch (error) {
      setStatus('error')
      const message = error instanceof Error ? error.message : 'An unknown error occurred'
      addLog(`❌ Error: ${message}`, 'error')
      console.error('[Heidi Agent] Error:', error)
    }
  }

  const isProcessing = status === 'scanning' || status === 'mapping' || status === 'filling'
  const canSubmit = apiKey.trim() && note.trim() && !isProcessing

  const copyLogsToClipboard = () => {
    const logText = logs.map(log => {
      let text = `[${log.timestamp.toLocaleTimeString()}] ${log.message}`
      if (log.data) {
        text += '\n' + JSON.stringify(log.data, null, 2)
      }
      return text
    }).join('\n')
    navigator.clipboard.writeText(logText)
    addLog('📋 Logs copied to clipboard!', 'success')
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Heidi Agent</h1>
        <p className="subtitle">OpenEMR Form Assistant</p>
      </header>

      <main className="main">
        <section className="input-section">
          <label htmlFor="api-key">Gemini API Key</label>
          <input
            id="api-key"
            type="password"
            placeholder="AIza..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={isProcessing}
          />
        </section>

        <section className="note-section">
          <label htmlFor="note-input">Clinical Note</label>
          <textarea
            id="note-input"
            placeholder="Paste your Heidi note here..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={isProcessing}
          />
        </section>

        <div className="actions">
          <button 
            className="btn btn-primary" 
            disabled={!canSubmit}
            onClick={handleAutoFill}
          >
            {isProcessing ? (
              <>
                <span className="spinner"></span>
                {status === 'scanning' && 'Scanning...'}
                {status === 'mapping' && 'Mapping...'}
                {status === 'filling' && 'Filling...'}
              </>
            ) : (
              'Auto-Fill Form'
            )}
          </button>
        </div>

        {logs.length > 0 && (
          <section className="log-section">
            <div className="log-header">
              <label>Activity Log</label>
              <div className="log-actions">
                <label className="debug-toggle">
                  <input 
                    type="checkbox" 
                    checked={showDebug} 
                    onChange={(e) => setShowDebug(e.target.checked)} 
                  />
                  Debug
                </label>
                <button className="btn-clear" onClick={copyLogsToClipboard}>Copy</button>
                <button className="btn-clear" onClick={clearLogs}>Clear</button>
              </div>
            </div>
            <div className="log-container">
              {logs
                .filter(log => showDebug || log.type !== 'debug')
                .map((log) => (
                <div key={log.id} className={`log-entry log-${log.type}`}>
                  <span className="log-time">
                    {log.timestamp.toLocaleTimeString()}
                  </span>
                  <div className="log-content">
                    <span className="log-message">{log.message}</span>
                    {log.data !== undefined && showDebug && (
                      <pre className="log-data">{JSON.stringify(log.data, null, 2)}</pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
