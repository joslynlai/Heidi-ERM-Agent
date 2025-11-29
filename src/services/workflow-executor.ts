import { WorkflowStep, StepResult, WorkflowConfig } from '../types/workflow'
import { generateMapping } from './ai'

/**
 * Workflow Executor Service
 * 
 * Executes workflow steps in sequence:
 * - NAVIGATE_* steps use hardcoded selectors
 * - AI_AUTO_FILL steps use dynamic AI scanning
 */

export interface ExecutorCallbacks {
  onStepStart: (step: WorkflowStep) => void
  onStepComplete: (step: WorkflowStep, result: StepResult) => void
  onLog: (message: string, type: 'info' | 'success' | 'error' | 'debug') => void
}

export class WorkflowExecutor {
  private tabId: number
  private heidiNote: string
  private apiKey: string
  private callbacks: ExecutorCallbacks
  private aborted: boolean = false

  constructor(
    tabId: number,
    heidiNote: string,
    apiKey: string,
    callbacks: ExecutorCallbacks
  ) {
    this.tabId = tabId
    this.heidiNote = heidiNote
    this.apiKey = apiKey
    this.callbacks = callbacks
  }

  abort() {
    this.aborted = true
  }

  async executeWorkflow(workflow: WorkflowConfig): Promise<boolean> {
    this.callbacks.onLog(`🚀 Starting workflow: ${workflow.name}`, 'info')
    
    for (const step of workflow.steps) {
      if (this.aborted) {
        this.callbacks.onLog('⛔ Workflow aborted by user', 'error')
        return false
      }

      this.callbacks.onStepStart(step)
      
      try {
        const result = await this.executeStep(step)
        this.callbacks.onStepComplete(step, result)
        
        if (!result.success) {
          this.callbacks.onLog(`❌ Step ${step.id} failed: ${result.message}`, 'error')
          return false
        }
        
        // Wait after step if specified
        if (step.waitAfter) {
          await this.sleep(step.waitAfter)
        }
        
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        this.callbacks.onLog(`❌ Step ${step.id} error: ${message}`, 'error')
        this.callbacks.onStepComplete(step, { success: false, message })
        return false
      }
    }
    
    this.callbacks.onLog('✅ Workflow completed successfully!', 'success')
    return true
  }

  private async executeStep(step: WorkflowStep): Promise<StepResult> {
    this.callbacks.onLog(`▶️ ${step.description}`, 'info')

    switch (step.action) {
      case 'NAVIGATE_CLICK':
        return this.executeClick(step)
      
      case 'NAVIGATE_CLICK_IFRAME':
        return this.executeClickIframe(step)
      
      case 'NAVIGATE_WAIT':
        return this.executeWait(step)
      
      case 'AI_AUTO_FILL':
        return this.executeAutoFill(step)
      
      case 'DEBUG_SCAN':
        return this.executeDebugScan()
      
      default:
        return { success: false, message: `Unknown action: ${step.action}` }
    }
  }

  /**
   * Click an element in the main page
   */
  private async executeClick(step: WorkflowStep): Promise<StepResult> {
    if (!step.selector) {
      return { success: false, message: 'No selector provided for click action' }
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: this.tabId },
      func: (selector: string) => {
        const element = document.querySelector(selector) as HTMLElement
        if (!element) {
          return { found: false, message: `Element not found: ${selector}` }
        }
        element.click()
        return { found: true, message: 'Clicked successfully' }
      },
      args: [step.selector]
    })

    const result = results[0]?.result
    if (result?.found) {
      this.callbacks.onLog(`  ✓ Clicked: ${step.selector}`, 'debug')
      return { success: true, message: result.message }
    } else {
      return { success: false, message: result?.message || 'Click failed' }
    }
  }

  /**
   * Click an element inside an iframe
   */
  private async executeClickIframe(step: WorkflowStep): Promise<StepResult> {
    if (!step.selector) {
      return { success: false, message: 'No selector provided for click action' }
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: this.tabId, allFrames: true },
      func: (selector: string) => {
        const element = document.querySelector(selector) as HTMLElement
        if (!element) {
          return { found: false }
        }
        element.click()
        return { found: true, clicked: true }
      },
      args: [step.selector]
    })

    // Check if any frame found and clicked the element
    const clicked = results.some(r => r.result?.found && r.result?.clicked)
    
    if (clicked) {
      this.callbacks.onLog(`  ✓ Clicked in iframe: ${step.selector}`, 'debug')
      return { success: true, message: 'Clicked in iframe' }
    } else {
      return { success: false, message: `Element not found in any frame: ${step.selector}` }
    }
  }

  /**
   * Wait for an element to appear
   */
  private async executeWait(step: WorkflowStep): Promise<StepResult> {
    if (!step.selector) {
      return { success: false, message: 'No selector provided for wait action' }
    }

    const timeout = step.timeout || 5000
    const startTime = Date.now()
    const pollInterval = 500

    this.callbacks.onLog(`  ⏳ Waiting up to ${timeout/1000}s for: ${step.selector}`, 'debug')

    while (Date.now() - startTime < timeout) {
      if (this.aborted) {
        return { success: false, message: 'Aborted' }
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId: this.tabId, allFrames: true },
        func: (selector: string) => {
          const element = document.querySelector(selector)
          return { 
            found: !!element,
            frameUrl: window.location.href.substring(0, 50)
          }
        },
        args: [step.selector]
      })

      const found = results.some(r => r.result?.found)
      
      if (found) {
        this.callbacks.onLog(`  ✓ Element appeared: ${step.selector}`, 'debug')
        return { success: true, message: 'Element found' }
      }

      await this.sleep(pollInterval)
    }

    // Timeout - let's debug what's on the page
    this.callbacks.onLog(`  ⚠️ Timeout! Debugging page structure...`, 'debug')
    
    const debugResults = await chrome.scripting.executeScript({
      target: { tabId: this.tabId, allFrames: true },
      func: () => {
        // Find potential navigation elements
        const navElements: string[] = []
        
        // Look for common menu/category patterns
        document.querySelectorAll('[id*="category"], [class*="category"], [id*="menu"], [class*="menu"], [id*="Clinical"], [class*="Clinical"], a, button').forEach((el) => {
          if (el.id || el.className) {
            const text = el.textContent?.trim().substring(0, 30) || ''
            navElements.push(`${el.tagName}#${el.id || '(no-id)'}.${(el.className?.toString() || '').substring(0, 20)} "${text}"`)
          }
        })
        
        return {
          url: window.location.href.substring(0, 80),
          title: document.title,
          elementsFound: navElements.slice(0, 15) // Limit output
        }
      }
    })

    // Log what we found
    debugResults.forEach((result, idx) => {
      if (result.result) {
        this.callbacks.onLog(`  📄 Frame ${idx + 1}: ${result.result.url}`, 'debug')
        if (result.result.elementsFound?.length > 0) {
          result.result.elementsFound.forEach((el: string) => {
            this.callbacks.onLog(`     - ${el}`, 'debug')
          })
        }
      }
    })

    return { success: false, message: `Timeout waiting for: ${step.selector}` }
  }

  /**
   * Scan page and auto-fill using AI
   */
  private async executeAutoFill(step: WorkflowStep): Promise<StepResult> {
    const contextLabel = step.context ? step.context.replace(/_/g, ' ').toUpperCase() : 'form'
    this.callbacks.onLog(`  📡 Scanning ${contextLabel} for fields...`, 'debug')

    // Scan all frames for form fields
    const scanResults = await chrome.scripting.executeScript({
      target: { tabId: this.tabId, allFrames: true },
      func: () => {
        const fields: Array<{
          id: string
          name: string
          type: string
          placeholder: string
          label: string
          tagName: string
          options?: string[]
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
          if (parent?.textContent) return parent.textContent.trim()
          const prev = el.previousElementSibling
          if (prev?.tagName === 'LABEL') return prev.textContent?.trim() || ''
          return el.getAttribute('aria-label') || el.getAttribute('title') || ''
        }
        
        document.querySelectorAll('input, textarea, select').forEach((el) => {
          const htmlEl = el as HTMLElement
          if (!isVisible(htmlEl)) return
          if (el.tagName === 'INPUT') {
            const type = (el as HTMLInputElement).type.toLowerCase()
            if (['hidden', 'submit', 'button', 'reset', 'file'].includes(type)) return
          }
          
          const field = {
            id: el.id || '',
            name: (el as HTMLInputElement).name || '',
            type: el.tagName === 'INPUT' ? (el as HTMLInputElement).type || 'text' : el.tagName.toLowerCase(),
            placeholder: (el as HTMLInputElement).placeholder || '',
            label: findLabel(htmlEl),
            tagName: el.tagName.toLowerCase(),
            options: el.tagName === 'SELECT' 
              ? Array.from((el as HTMLSelectElement).options).map(o => o.text.trim()).filter(Boolean)
              : undefined
          }
          
          if (field.id || field.name || field.label || field.placeholder) {
            fields.push(field)
          }
        })
        
        return fields
      }
    })

    // Aggregate fields from all frames
    const allFields = scanResults.flatMap(r => r.result || [])
    
    if (allFields.length === 0) {
      return { success: false, message: 'No form fields found' }
    }

    this.callbacks.onLog(`  📋 Found ${allFields.length} fields`, 'debug')

    // Generate AI mapping with step context
    this.callbacks.onLog(`  🤖 Generating AI mapping for ${contextLabel}...`, 'debug')
    
    const schema = {
      url: '',
      title: '',
      fields: allFields,
      timestamp: Date.now()
    }

    // Pass context to AI so it knows what type of form it's filling
    const mapping = await generateMapping(this.heidiNote, schema, this.apiKey, step.context)
    const mappedCount = Object.keys(mapping).length

    if (mappedCount === 0) {
      this.callbacks.onLog(`  ⚠️ AI couldn't map any fields`, 'error')
      return { success: true, message: 'No fields to fill (AI found no matches)' }
    }

    this.callbacks.onLog(`  🎯 Mapped ${mappedCount} fields`, 'debug')

    // Fill the fields across all frames
    const fillResults = await chrome.scripting.executeScript({
      target: { tabId: this.tabId, allFrames: true },
      func: (mappingArg: Record<string, string>) => {
        const filled: string[] = []
        
        const dispatchEvents = (el: HTMLElement) => {
          el.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
          el.dispatchEvent(new InputEvent('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          el.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
        }
        
        const highlight = (el: HTMLElement) => {
          el.style.border = '2px solid #00d4aa'
          el.style.boxShadow = '0 0 8px rgba(0, 212, 170, 0.5)'
          setTimeout(() => {
            el.style.border = ''
            el.style.boxShadow = ''
          }, 2000)
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
              filled.push(fieldId)
            } else if (el instanceof HTMLSelectElement) {
              for (const opt of el.options) {
                if (opt.value === value || opt.text.toLowerCase().includes(value.toLowerCase())) {
                  el.value = opt.value
                  dispatchEvents(el)
                  highlight(el)
                  filled.push(fieldId)
                  break
                }
              }
            }
          } catch { /* ignore */ }
        }
        
        return { filled }
      },
      args: [mapping]
    })

    const filledFields = fillResults.flatMap(r => r.result?.filled || [])
    
    this.callbacks.onLog(`  ✅ Filled ${filledFields.length} fields: ${filledFields.join(', ')}`, 'success')
    
    return { 
      success: true, 
      message: `Filled ${filledFields.length} fields`,
      data: { filled: filledFields, mapping }
    }
  }

  /**
   * Debug scan - logs all interactive elements to help find selectors
   */
  private async executeDebugScan(): Promise<StepResult> {
    this.callbacks.onLog('🔍 Scanning all frames for interactive elements...', 'info')
    
    const results = await chrome.scripting.executeScript({
      target: { tabId: this.tabId, allFrames: true },
      func: () => {
        const elements: {
          buttons: string[]
          links: string[]
          inputs: string[]
          selects: string[]
        } = { buttons: [], links: [], inputs: [], selects: [] }
        
        // Helper to create selector string
        const describeElement = (el: Element): string => {
          const tag = el.tagName
          const id = el.id ? `#${el.id}` : ''
          const classes = el.className?.toString()?.split(' ').filter(Boolean).slice(0, 2).map(c => `.${c}`).join('') || ''
          const name = el.getAttribute('name') ? `[name="${el.getAttribute('name')}"]` : ''
          const type = el.getAttribute('type') ? `[type="${el.getAttribute('type')}"]` : ''
          const value = el.getAttribute('value')?.substring(0, 15) || ''
          const text = el.textContent?.trim().substring(0, 20) || ''
          const onclick = el.getAttribute('onclick') ? '[onclick]' : ''
          
          return `${tag}${id}${classes}${name}${type}${onclick} "${value || text}"`
        }
        
        // Find all buttons
        document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]').forEach(el => {
          elements.buttons.push(describeElement(el))
        })
        
        // Find all links
        document.querySelectorAll('a[href], [onclick]').forEach(el => {
          if (el.tagName === 'A' || el.getAttribute('onclick')) {
            const text = el.textContent?.trim().substring(0, 30) || ''
            if (text) {
              elements.links.push(describeElement(el))
            }
          }
        })
        
        // Find form inputs
        document.querySelectorAll('input:not([type="hidden"]), textarea').forEach(el => {
          elements.inputs.push(describeElement(el))
        })
        
        // Find selects
        document.querySelectorAll('select').forEach(el => {
          elements.selects.push(describeElement(el))
        })
        
        return {
          url: window.location.href,
          elements
        }
      }
    })

    // Log results from each frame
    results.forEach((result, frameIndex) => {
      if (!result.result) return
      
      const { url, elements } = result.result
      this.callbacks.onLog(`\n📄 Frame ${frameIndex + 1}: ${url.substring(0, 60)}...`, 'info')
      
      if (elements.buttons.length > 0) {
        this.callbacks.onLog('  🔘 BUTTONS:', 'debug')
        elements.buttons.slice(0, 10).forEach((btn: string) => {
          this.callbacks.onLog(`     ${btn}`, 'debug')
        })
      }
      
      if (elements.links.length > 0) {
        this.callbacks.onLog('  🔗 LINKS:', 'debug')
        elements.links.slice(0, 10).forEach((link: string) => {
          this.callbacks.onLog(`     ${link}`, 'debug')
        })
      }
      
      if (elements.inputs.length > 0) {
        this.callbacks.onLog(`  📝 INPUTS: ${elements.inputs.length} found`, 'debug')
      }
      
      if (elements.selects.length > 0) {
        this.callbacks.onLog(`  📋 SELECTS: ${elements.selects.length} found`, 'debug')
      }
    })
    
    this.callbacks.onLog('\n💡 TIP: Copy a selector from above and update soap-workflow.ts', 'info')
    
    return { 
      success: true, 
      message: 'Debug scan complete - check logs above for selectors' 
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

