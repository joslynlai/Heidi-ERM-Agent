import { useState, useCallback, useRef } from 'react'
import { generateMapping } from './services/ai'
import { WorkflowExecutor } from './services/workflow-executor'
import { SOAP_WORKFLOW, DEBUG_WORKFLOW, QUICK_FILL_WORKFLOW } from './workflows/soap-workflow'
import { WorkflowStep, StepStatus, WorkflowConfig } from './types/workflow'

// Available workflows
const WORKFLOWS: Record<string, WorkflowConfig> = {
  'debug': DEBUG_WORKFLOW,
  'soap': SOAP_WORKFLOW,
  'quick': QUICK_FILL_WORKFLOW,
}

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

type AppMode = 'quick-fill' | 'workflow'
type AppStatus = 'idle' | 'scanning' | 'mapping' | 'filling' | 'running' | 'done' | 'error'

function App() {
  const [apiKey, setApiKey] = useState('')
  const [note, setNote] = useState('')
  const [mode, setMode] = useState<AppMode>('quick-fill')
  const [status, setStatus] = useState<AppStatus>('idle')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [showDebug, setShowDebug] = useState(true)
  
  // Workflow state
  const [selectedWorkflowKey, setSelectedWorkflowKey] = useState<string>('debug')
  const [currentStepIndex, setCurrentStepIndex] = useState(-1)
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>([])
  const executorRef = useRef<WorkflowExecutor | null>(null)
  
  const selectedWorkflow = WORKFLOWS[selectedWorkflowKey]

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

  // ============ QUICK FILL MODE ============
  
  const scanAllFrames = async (tabId: number): Promise<FormField[]> => {
    // Inject and execute scanning in all frames
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const fields: Array<{
          id: string; name: string; type: string; placeholder: string
          label: string; tagName: string; options?: string[]
        }> = []
        
        const isVisible = (el: HTMLElement) => {
          const style = window.getComputedStyle(el)
          if (style.display === 'none' || style.visibility === 'hidden') return false
          const rect = el.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        }
        
        const findLabel = (el: HTMLElement) => {
          if (el.id) {
            const label = document.querySelector(`label[for="${el.id}"]`)
            if (label?.textContent) return label.textContent.trim()
          }
          const parent = el.closest('label')
          if (parent) {
            const clone = parent.cloneNode(true) as HTMLElement
            clone.querySelectorAll('input, select, textarea').forEach(i => i.remove())
            if (clone.textContent?.trim()) return clone.textContent.trim()
          }
          const prev = el.previousElementSibling
          if (prev?.tagName === 'LABEL') return prev.textContent?.trim() || ''
          if (el.parentElement?.tagName === 'TD') {
            const prevTd = el.parentElement.previousElementSibling
            if (prevTd?.textContent) return prevTd.textContent.trim()
          }
          return el.getAttribute('aria-label') || el.getAttribute('title') || ''
        }
        
        document.querySelectorAll('input, textarea, select').forEach((el) => {
          const htmlEl = el as HTMLElement
          if (!isVisible(htmlEl)) return
          if (el.tagName === 'INPUT') {
            const type = (el as HTMLInputElement).type.toLowerCase()
            if (['hidden', 'submit', 'button', 'reset', 'file'].includes(type)) return
          }
          
          fields.push({
            id: el.id || '',
            name: (el as HTMLInputElement).name || '',
            type: el.tagName === 'INPUT' ? (el as HTMLInputElement).type || 'text' : el.tagName.toLowerCase(),
            placeholder: (el as HTMLInputElement).placeholder || '',
            label: findLabel(htmlEl),
            tagName: el.tagName.toLowerCase(),
            options: el.tagName === 'SELECT' 
              ? Array.from((el as HTMLSelectElement).options).map(o => o.text.trim()).filter(Boolean)
              : undefined
          })
        })
        
        return fields
      }
    })
    
    const allFields: FormField[] = []
    results.forEach((result, index) => {
      if (result.result && Array.isArray(result.result)) {
        addLog(`  📄 Frame ${index + 1}: Found ${result.result.length} fields`, 'debug')
        allFields.push(...result.result)
      }
    })
    
    return allFields
  }

  const handleQuickFill = async () => {
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
      setStatus('scanning')
      addLog('📡 Step 1: Scanning page for form fields (including iframes)...')

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) throw new Error('No active tab found')

      const allFields = await scanAllFrames(tab.id)
      
      const schema = {
        url: tab.url || '',
        title: tab.title || '',
        fields: allFields,
        timestamp: Date.now()
      }
      
      addLog(`✅ Found ${schema.fields.length} form fields across all frames`, 'success')
      
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
      
      Object.entries(mapping).forEach(([fieldId, value]) => {
        addLog(`  → ${fieldId}: "${value}"`, 'debug')
      })

      setStatus('filling')
      addLog('✏️ Step 3: Filling form fields across all frames...')

      const fillResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: (mappingArg: Record<string, string>) => {
          const result = { filled: [] as string[], failed: [] as string[] }
          
          const dispatchEvents = (el: HTMLElement) => {
            el.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
            el.dispatchEvent(new InputEvent('input', { bubbles: true }))
            el.dispatchEvent(new Event('change', { bubbles: true }))
            el.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
          }
          
          const highlight = (el: HTMLElement) => {
            el.style.border = '2px solid #00d4aa'
            el.style.boxShadow = '0 0 8px rgba(0, 212, 170, 0.5)'
            setTimeout(() => { el.style.border = ''; el.style.boxShadow = '' }, 2000)
          }
          
          for (const [fieldId, value] of Object.entries(mappingArg)) {
            const el = document.getElementById(fieldId) || 
                       document.querySelector(`[name="${fieldId}"]`) as HTMLElement
            if (!el) continue
            
            try {
              el.focus()
              if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                el.value = value
                dispatchEvents(el)
                highlight(el)
                result.filled.push(fieldId)
              } else if (el instanceof HTMLSelectElement) {
                for (const opt of el.options) {
                  if (opt.value === value || opt.text.toLowerCase().includes(value.toLowerCase())) {
                    el.value = opt.value
                    dispatchEvents(el)
                    highlight(el)
                    result.filled.push(fieldId)
                    break
                  }
                }
              }
            } catch {
              result.failed.push(fieldId)
            }
          }
          return result
        },
        args: [mapping]
      })
      
      const aggregated = { filled: [] as string[], failed: [] as string[], notFound: [] as string[] }
      const processed = new Set<string>()
      
      fillResults.forEach((r) => {
        r.result?.filled.forEach((f: string) => {
          if (!processed.has(f)) { aggregated.filled.push(f); processed.add(f) }
        })
        r.result?.failed.forEach((f: string) => {
          if (!processed.has(f)) { aggregated.failed.push(f); processed.add(f) }
        })
      })
      
      Object.keys(mapping).forEach(fieldId => {
        if (!processed.has(fieldId)) aggregated.notFound.push(fieldId)
      })
      
      addLog('📋 FILL RESULT:', 'debug', aggregated)
      
      if (aggregated.filled.length > 0) {
        addLog(`✅ Successfully filled: ${aggregated.filled.join(', ')}`, 'success')
      }
      if (aggregated.failed.length > 0) {
        addLog(`⚠️ Failed to fill: ${aggregated.failed.join(', ')}`, 'error')
      }
      if (aggregated.notFound.length > 0) {
        addLog(`❌ Fields not found: ${aggregated.notFound.join(', ')}`, 'error')
      }

      setStatus('done')
      addLog('🎉 Auto-fill complete!', 'success')

    } catch (error) {
      setStatus('error')
      const message = error instanceof Error ? error.message : 'Unknown error'
      addLog(`❌ Error: ${message}`, 'error')
      console.error('[Heidi Agent] Error:', error)
    }
  }

  // ============ WORKFLOW MODE ============
  
  const isDebugWorkflow = selectedWorkflowKey === 'debug'
  
  const handleRunWorkflow = async () => {
    // Debug workflow doesn't need API key or note
    if (!isDebugWorkflow) {
      if (!apiKey.trim()) {
        addLog('Please enter your Gemini API key', 'error')
        return
      }
      if (!note.trim()) {
        addLog('Please paste a clinical note', 'error')
        return
      }
    }

    clearLogs()
    setStatus('running')
    setCurrentStepIndex(0)
    setStepStatuses(selectedWorkflow.steps.map(() => 'pending'))

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) throw new Error('No active tab found')

      const executor = new WorkflowExecutor(tab.id, note || '', apiKey || '', {
        onStepStart: (step: WorkflowStep) => {
          setCurrentStepIndex(step.id - 1)
          setStepStatuses(prev => {
            const next = [...prev]
            next[step.id - 1] = 'running'
            return next
          })
        },
        onStepComplete: (step: WorkflowStep, result) => {
          setStepStatuses(prev => {
            const next = [...prev]
            next[step.id - 1] = result.success ? 'success' : 'failed'
            return next
          })
        },
        onLog: addLog
      })

      executorRef.current = executor
      
      const success = await executor.executeWorkflow(selectedWorkflow)
      
      setStatus(success ? 'done' : 'error')
      setCurrentStepIndex(-1)
      
    } catch (error) {
      setStatus('error')
      const message = error instanceof Error ? error.message : 'Unknown error'
      addLog(`❌ Workflow error: ${message}`, 'error')
    }
  }

  const handleAbortWorkflow = () => {
    if (executorRef.current) {
      executorRef.current.abort()
      addLog('⛔ Aborting workflow...', 'error')
    }
  }

  // ============ UI ============
  
  const isProcessing = ['scanning', 'mapping', 'filling', 'running'].includes(status)
  // Debug workflow doesn't need API key or note
  const canSubmit = isDebugWorkflow 
    ? !isProcessing 
    : (apiKey.trim() && note.trim() && !isProcessing)

  const copyLogsToClipboard = () => {
    const logText = logs.map(log => {
      let text = `[${log.timestamp.toLocaleTimeString()}] ${log.message}`
      if (log.data) text += '\n' + JSON.stringify(log.data, null, 2)
      return text
    }).join('\n')
    navigator.clipboard.writeText(logText)
    addLog('📋 Logs copied to clipboard!', 'success')
  }

  const getStepStatusIcon = (status: StepStatus) => {
    switch (status) {
      case 'pending': return '⏸️'
      case 'running': return '▶️'
      case 'success': return '✅'
      case 'failed': return '❌'
      case 'skipped': return '⏭️'
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Heidi Agent</h1>
        <p className="subtitle">OpenEMR Form Assistant</p>
      </header>

      <main className="main">
        {/* Mode Toggle */}
        <div className="mode-toggle">
          <button 
            className={`mode-btn ${mode === 'quick-fill' ? 'active' : ''}`}
            onClick={() => setMode('quick-fill')}
            disabled={isProcessing}
          >
            ⚡ Quick Fill
          </button>
          <button 
            className={`mode-btn ${mode === 'workflow' ? 'active' : ''}`}
            onClick={() => setMode('workflow')}
            disabled={isProcessing}
          >
            🔄 Workflow
          </button>
        </div>

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
          <label htmlFor="note-input">Heidi Clinical Note</label>
          <textarea
            id="note-input"
            placeholder="Paste your Heidi note here..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={isProcessing}
          />
        </section>

        {/* Workflow Selection and Steps Preview */}
        {mode === 'workflow' && (
          <section className="workflow-section">
            <div className="workflow-selector">
              <label htmlFor="workflow-select">Select Workflow</label>
              <select
                id="workflow-select"
                value={selectedWorkflowKey}
                onChange={(e) => setSelectedWorkflowKey(e.target.value)}
                disabled={isProcessing}
              >
                <option value="debug">🔍 Debug: Find Selectors (Run First!)</option>
                <option value="soap">📋 SOAP Note Workflow</option>
                <option value="quick">⚡ Quick Fill Current Page</option>
              </select>
            </div>
            
            {isDebugWorkflow && (
              <div className="debug-notice">
                💡 <strong>Debug Mode:</strong> This will scan the page and show all buttons, links, and form elements. 
                Use this to find the correct selectors for your OpenEMR.
              </div>
            )}
            
            <div className="workflow-steps">
              <label>Steps: {selectedWorkflow.name}</label>
              <div className="steps-list">
                {selectedWorkflow.steps.map((step, index) => (
                  <div 
                    key={step.id} 
                    className={`step-item ${currentStepIndex === index ? 'current' : ''} ${stepStatuses[index] || ''}`}
                  >
                    <span className="step-icon">
                      {stepStatuses[index] ? getStepStatusIcon(stepStatuses[index]) : `${step.id}.`}
                    </span>
                    <span className="step-desc">{step.description}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <div className="actions">
          {mode === 'quick-fill' ? (
            <button 
              className="btn btn-primary" 
              disabled={!canSubmit}
              onClick={handleQuickFill}
            >
              {isProcessing ? (
                <>
                  <span className="spinner"></span>
                  {status === 'scanning' && 'Scanning...'}
                  {status === 'mapping' && 'Mapping...'}
                  {status === 'filling' && 'Filling...'}
                </>
              ) : (
                '⚡ Auto-Fill This Page'
              )}
            </button>
          ) : (
            <>
              <button 
                className="btn btn-primary" 
                disabled={!canSubmit}
                onClick={handleRunWorkflow}
              >
                {status === 'running' ? (
                  <>
                    <span className="spinner"></span>
                    Running Step {currentStepIndex + 1}...
                  </>
                ) : (
                  '🚀 Run Full Workflow'
                )}
              </button>
              {status === 'running' && (
                <button 
                  className="btn btn-danger"
                  onClick={handleAbortWorkflow}
                >
                  ⛔ Abort
                </button>
              )}
            </>
          )}
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
