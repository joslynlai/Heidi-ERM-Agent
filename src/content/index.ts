// Content script for scanning OpenEMR form fields

interface FormField {
  id: string
  name: string
  type: string
  placeholder: string
  label: string
  tagName: string
  options?: string[] // For select elements
}

interface ScanResult {
  url: string
  title: string
  fields: FormField[]
  timestamp: number
}

interface FillMapping {
  [fieldId: string]: string
}

interface FillResult {
  filled: string[]
  failed: string[]
  notFound: string[]
}

/**
 * Check if an element is visible in the viewport
 */
function isElementVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element)
  
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false
  }
  
  const rect = element.getBoundingClientRect()
  
  // Check if element has dimensions
  if (rect.width === 0 || rect.height === 0) {
    return false
  }
  
  return true
}

/**
 * Find the associated label text for a form element
 */
function findLabelText(element: HTMLElement): string {
  const id = element.id
  
  // Method 1: Look for label[for="id"]
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`)
    if (label && label.textContent) {
      return label.textContent.trim()
    }
  }
  
  // Method 2: Check if element is inside a label
  const parentLabel = element.closest('label')
  if (parentLabel) {
    // Get text content excluding the input element itself
    const clone = parentLabel.cloneNode(true) as HTMLElement
    const inputs = clone.querySelectorAll('input, select, textarea')
    inputs.forEach(input => input.remove())
    const text = clone.textContent?.trim()
    if (text) {
      return text
    }
  }
  
  // Method 3: Look for preceding label sibling
  const previousSibling = element.previousElementSibling
  if (previousSibling?.tagName === 'LABEL' && previousSibling.textContent) {
    return previousSibling.textContent.trim()
  }
  
  // Method 4: Look for parent's preceding text or label
  const parent = element.parentElement
  if (parent) {
    const prevElement = parent.previousElementSibling
    if (prevElement?.tagName === 'LABEL' && prevElement.textContent) {
      return prevElement.textContent.trim()
    }
    
    // Check for text in a preceding table cell (common in OpenEMR)
    if (parent.tagName === 'TD') {
      const prevTd = parent.previousElementSibling
      if (prevTd && prevTd.textContent) {
        return prevTd.textContent.trim()
      }
    }
  }
  
  // Method 5: Look for aria-label or aria-labelledby
  const ariaLabel = element.getAttribute('aria-label')
  if (ariaLabel) {
    return ariaLabel.trim()
  }
  
  const ariaLabelledBy = element.getAttribute('aria-labelledby')
  if (ariaLabelledBy) {
    const labelElement = document.getElementById(ariaLabelledBy)
    if (labelElement && labelElement.textContent) {
      return labelElement.textContent.trim()
    }
  }
  
  // Method 6: Use title attribute as fallback
  const title = element.getAttribute('title')
  if (title) {
    return title.trim()
  }
  
  return ''
}

/**
 * Extract options from a select element
 */
function getSelectOptions(select: HTMLSelectElement): string[] {
  const options: string[] = []
  
  for (const option of select.options) {
    if (option.value && option.text) {
      options.push(option.text.trim())
    }
  }
  
  return options
}

/**
 * Add visual indicator to show field was filled
 */
function addFilledIndicator(element: HTMLElement): void {
  // Store original styles
  const originalBorder = element.style.border
  const originalBoxShadow = element.style.boxShadow
  const originalTransition = element.style.transition
  
  // Apply success indicator
  element.style.transition = 'border 0.3s ease, box-shadow 0.3s ease'
  element.style.border = '2px solid #00d4aa'
  element.style.boxShadow = '0 0 8px rgba(0, 212, 170, 0.5)'
  
  // Fade out the indicator after 2 seconds
  setTimeout(() => {
    element.style.border = originalBorder || ''
    element.style.boxShadow = originalBoxShadow || ''
    
    // Clean up transition after animation
    setTimeout(() => {
      element.style.transition = originalTransition || ''
    }, 300)
  }, 2000)
}

/**
 * Dispatch proper events to ensure OpenEMR detects the value change
 */
function dispatchInputEvents(element: HTMLElement): void {
  // Focus event
  element.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
  
  // Input event (for real-time listeners)
  element.dispatchEvent(new InputEvent('input', { 
    bubbles: true, 
    cancelable: true,
    inputType: 'insertText'
  }))
  
  // Change event (for form validation)
  element.dispatchEvent(new Event('change', { bubbles: true }))
  
  // Blur event (triggers validation in many frameworks)
  element.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
}

/**
 * Fill a single form field with proper event dispatching
 */
function fillField(element: HTMLElement, value: string): boolean {
  try {
    // Focus the element first
    element.focus()
    
    if (element instanceof HTMLInputElement) {
      const inputType = element.type.toLowerCase()
      
      if (inputType === 'checkbox') {
        // Handle checkbox - set checked state based on truthy value
        const shouldCheck = ['true', '1', 'yes', 'on'].includes(value.toLowerCase())
        if (element.checked !== shouldCheck) {
          element.checked = shouldCheck
          dispatchInputEvents(element)
        }
      } else if (inputType === 'radio') {
        // Handle radio - check if value matches
        if (element.value === value || element.id === value) {
          element.checked = true
          dispatchInputEvents(element)
        }
      } else if (inputType === 'date') {
        // Handle date input - expects YYYY-MM-DD format
        element.value = value
        dispatchInputEvents(element)
      } else {
        // Handle text, email, number, etc.
        element.value = value
        dispatchInputEvents(element)
      }
    } else if (element instanceof HTMLTextAreaElement) {
      element.value = value
      dispatchInputEvents(element)
    } else if (element instanceof HTMLSelectElement) {
      // Handle select - try to match by value or text
      let matched = false
      
      // First try exact value match
      for (const option of element.options) {
        if (option.value === value) {
          element.value = option.value
          matched = true
          break
        }
      }
      
      // Then try case-insensitive text match
      if (!matched) {
        const lowerValue = value.toLowerCase()
        for (const option of element.options) {
          if (option.text.toLowerCase() === lowerValue || 
              option.text.toLowerCase().includes(lowerValue)) {
            element.value = option.value
            matched = true
            break
          }
        }
      }
      
      if (matched) {
        dispatchInputEvents(element)
      } else {
        return false
      }
    }
    
    // Add visual indicator
    addFilledIndicator(element)
    
    return true
  } catch (error) {
    console.error(`[Heidi Agent] Error filling field:`, error)
    return false
  }
}

/**
 * Fill multiple form fields from a mapping object
 */
function fillForm(mapping: FillMapping): FillResult {
  const result: FillResult = {
    filled: [],
    failed: [],
    notFound: []
  }
  
  for (const [fieldId, value] of Object.entries(mapping)) {
    // Try to find element by ID first
    let element = document.getElementById(fieldId)
    
    // If not found by ID, try by name
    if (!element) {
      element = document.querySelector(`[name="${fieldId}"]`) as HTMLElement
    }
    
    if (!element) {
      result.notFound.push(fieldId)
      console.warn(`[Heidi Agent] Field not found: ${fieldId}`)
      continue
    }
    
    // Check if it's a valid form element
    if (!(element instanceof HTMLInputElement || 
          element instanceof HTMLTextAreaElement || 
          element instanceof HTMLSelectElement)) {
      result.failed.push(fieldId)
      console.warn(`[Heidi Agent] Element is not a form field: ${fieldId}`)
      continue
    }
    
    const success = fillField(element, value)
    
    if (success) {
      result.filled.push(fieldId)
      console.log(`[Heidi Agent] Filled field: ${fieldId}`)
    } else {
      result.failed.push(fieldId)
      console.warn(`[Heidi Agent] Failed to fill field: ${fieldId}`)
    }
  }
  
  return result
}

/**
 * Scan the page for all visible form fields
 */
function scanPage(): ScanResult {
  const fields: FormField[] = []
  
  // Select all form elements
  const inputs = document.querySelectorAll('input, textarea, select')
  
  inputs.forEach((element) => {
    const htmlElement = element as HTMLElement
    
    // Skip hidden and invisible elements
    if (!isElementVisible(htmlElement)) {
      return
    }
    
    // Skip certain input types that aren't user-fillable
    if (element.tagName === 'INPUT') {
      const inputType = (element as HTMLInputElement).type.toLowerCase()
      if (['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(inputType)) {
        return
      }
    }
    
    const field: FormField = {
      id: element.id || '',
      name: (element as HTMLInputElement).name || '',
      type: element.tagName === 'INPUT' 
        ? (element as HTMLInputElement).type || 'text'
        : element.tagName.toLowerCase(),
      placeholder: (element as HTMLInputElement).placeholder || '',
      label: findLabelText(htmlElement),
      tagName: element.tagName.toLowerCase(),
    }
    
    // Add options for select elements
    if (element.tagName === 'SELECT') {
      field.options = getSelectOptions(element as HTMLSelectElement)
    }
    
    // Only include fields that have some identifying information
    if (field.id || field.name || field.label || field.placeholder) {
      fields.push(field)
    }
  })
  
  return {
    url: window.location.href,
    title: document.title,
    fields,
    timestamp: Date.now(),
  }
}

/**
 * Listen for messages from the extension
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Respond to ping to confirm script is loaded
  if (message.type === 'PING') {
    sendResponse({ success: true, message: 'Content script is ready' })
    return true
  }

  if (message.type === 'SCAN_PAGE') {
    try {
      const result = scanPage()
      sendResponse({ success: true, data: result })
    } catch (error) {
      sendResponse({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      })
    }
  }
  
  if (message.type === 'FILL_FORM') {
    try {
      const mapping = message.mapping as FillMapping
      
      if (!mapping || typeof mapping !== 'object') {
        sendResponse({ 
          success: false, 
          error: 'Invalid mapping provided' 
        })
        return true
      }
      
      const result = fillForm(mapping)
      
      sendResponse({ 
        success: true, 
        data: result,
        message: `Filled ${result.filled.length} fields, ${result.failed.length} failed, ${result.notFound.length} not found`
      })
    } catch (error) {
      sendResponse({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      })
    }
  }
  
  // Return true to indicate we'll send a response asynchronously
  return true
})

// Log that content script is loaded (helpful for debugging)
console.log('[Heidi Agent] Content script loaded')

