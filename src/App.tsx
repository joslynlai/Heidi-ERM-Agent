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

  // Inject content script into all frames
  const injectContentScript = async (tabId: number): Promise<void> => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content.js']
      })
      // Small delay to ensure scripts are ready
      await new Promise(resolve => setTimeout(resolve, 100))
    } catch (error) {
      console.log('[Heidi Agent] Script injection note:', error)
    }
  }

  // Scan all frames and aggregate results
  const scanAllFrames = async (tabId: number): Promise<FormField[]> => {
    // Inject scripts into all frames first
    await injectContentScript(tabId)
    
    // Execute scanning function in all frames
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        // This function runs in each frame
        const fields: Array<{
          id: string
          name: string
          type: string
          placeholder: string
          label: string
          tagName: string
          options?: string[]
          frameUrl?: string
        }> = []
        
        const isElementVisible = (element: HTMLElement): boolean => {
          const style = window.getComputedStyle(element)
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false
          }
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        }
        
        const findLabelText = (element: HTMLElement): string => {
          const id = element.id
          if (id) {
            const label = document.querySelector(`label[for="${id}"]`)
            if (label?.textContent) return label.textContent.trim()
          }
          const parentLabel = element.closest('label')
          if (parentLabel) {
            const clone = parentLabel.cloneNode(true) as HTMLElement
            clone.querySelectorAll('input, select, textarea').forEach(el => el.remove())
            if (clone.textContent?.trim()) return clone.textContent.trim()
          }
          const prev = element.previousElementSibling
          if (prev?.tagName === 'LABEL' && prev.textContent) return prev.textContent.trim()
          const parent = element.parentElement
          if (parent?.tagName === 'TD') {
            const prevTd = parent.previousElementSibling
            if (prevTd?.textContent) return prevTd.textContent.trim()
          }
          return element.getAttribute('aria-label') || element.getAttribute('title') || ''
        }
        
        const inputs = document.querySelectorAll('input, textarea, select')
        inputs.forEach((element) => {
          const el = element as HTMLElement
          if (!isElementVisible(el)) return
          
          if (element.tagName === 'INPUT') {
            const type = (element as HTMLInputElement).type.toLowerCase()
            if (['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(type)) return
          }
          
          const field = {
            id: element.id || '',
            name: (element as HTMLInputElement).name || '',
            type: element.tagName === 'INPUT' 
              ? (element as HTMLInputElement).type || 'text'
              : element.tagName.toLowerCase(),
            placeholder: (element as HTMLInputElement).placeholder || '',
            label: findLabelText(el),
            tagName: element.tagName.toLowerCase(),
            options: element.tagName === 'SELECT' 
              ? Array.from((element as HTMLSelectElement).options).map(o => o.text.trim()).filter(Boolean)
              : undefined,
            frameUrl: window.location.href
          }
          
          if (field.id || field.name || field.label || field.placeholder) {
            fields.push(field)
          }
        })
        
        return fields
      }
    })
    
    // Aggregate fields from all frames
    const allFields: FormField[] = []
    results.forEach((result, index) => {
      if (result.result && Array.isArray(result.result)) {
        addLog(`  📄 Frame ${index + 1}: Found ${result.result.length} fields`, 'debug')
        allFields.push(...result.result)
      }
    })
    
    return allFields
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
      // Step A: Scan the page (including all iframes)
      setStatus('scanning')
      addLog('📡 Step 1: Scanning page for form fields (including iframes)...')

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      
      if (!tab?.id) {
        throw new Error('No active tab found')
      }

      // Scan all frames and aggregate results
      const allFields = await scanAllFrames(tab.id)
      
      const schema = {
        url: tab.url || '',
        title: tab.title || '',
        fields: allFields,
        timestamp: Date.now()
      }
      
      addLog(`✅ Found ${schema.fields.length} form fields across all frames`, 'success')
      
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

      // Step C: Fill the form across all frames
      setStatus('filling')
      addLog('✏️ Step 3: Filling form fields across all frames...')

      // Execute fill in all frames
      const fillResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: (mappingArg: Record<string, string>) => {
          const result = { filled: [] as string[], failed: [] as string[], notFound: [] as string[] }
          
          const dispatchEvents = (el: HTMLElement) => {
            el.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
            el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }))
            el.dispatchEvent(new Event('change', { bubbles: true }))
            el.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
          }
          
          const addIndicator = (el: HTMLElement) => {
            const orig = { border: el.style.border, boxShadow: el.style.boxShadow }
            el.style.border = '2px solid #00d4aa'
            el.style.boxShadow = '0 0 8px rgba(0, 212, 170, 0.5)'
            setTimeout(() => {
              el.style.border = orig.border
              el.style.boxShadow = orig.boxShadow
            }, 2000)
          }
          
          for (const [fieldId, value] of Object.entries(mappingArg)) {
            let element = document.getElementById(fieldId) || 
                          document.querySelector(`[name="${fieldId}"]`) as HTMLElement
            
            if (!element) {
              // Field not in this frame, skip (might be in another frame)
              continue
            }
            
            try {
              element.focus()
              
              if (element instanceof HTMLInputElement) {
                const type = element.type.toLowerCase()
                if (type === 'checkbox') {
                  element.checked = ['true', '1', 'yes', 'on'].includes(value.toLowerCase())
                } else if (type === 'radio') {
                  if (element.value === value) element.checked = true
                } else {
                  element.value = value
                }
                dispatchEvents(element)
              } else if (element instanceof HTMLTextAreaElement) {
                element.value = value
                dispatchEvents(element)
              } else if (element instanceof HTMLSelectElement) {
                // Try exact value match
                let matched = false
                for (const opt of element.options) {
                  if (opt.value === value || opt.text.toLowerCase().includes(value.toLowerCase())) {
                    element.value = opt.value
                    matched = true
                    break
                  }
                }
                if (matched) dispatchEvents(element)
                else {
                  result.failed.push(fieldId)
                  continue
                }
              }
              
              addIndicator(element)
              result.filled.push(fieldId)
            } catch {
              result.failed.push(fieldId)
            }
          }
          
          return result
        },
        args: [mapping]
      })
      
      // Aggregate fill results from all frames
      const aggregatedResult = { filled: [] as string[], failed: [] as string[], notFound: [] as string[] }
      const processedFields = new Set<string>()
      
      fillResults.forEach((frameResult) => {
        if (frameResult.result) {
          frameResult.result.filled.forEach((f: string) => {
            if (!processedFields.has(f)) {
              aggregatedResult.filled.push(f)
              processedFields.add(f)
            }
          })
          frameResult.result.failed.forEach((f: string) => {
            if (!processedFields.has(f)) {
              aggregatedResult.failed.push(f)
              processedFields.add(f)
            }
          })
        }
      })
      
      // Find fields that weren't found in any frame
      Object.keys(mapping).forEach(fieldId => {
        if (!processedFields.has(fieldId)) {
          aggregatedResult.notFound.push(fieldId)
        }
      })
      
      addLog('📋 FILL RESULT:', 'debug', aggregatedResult)
      
      if (aggregatedResult.filled.length > 0) {
        addLog(`✅ Successfully filled: ${aggregatedResult.filled.join(', ')}`, 'success')
      }
      
      if (aggregatedResult.failed.length > 0) {
        addLog(`⚠️ Failed to fill: ${aggregatedResult.failed.join(', ')}`, 'error')
      }
      if (aggregatedResult.notFound.length > 0) {
        addLog(`❌ Fields not found in any frame: ${aggregatedResult.notFound.join(', ')}`, 'error')
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
