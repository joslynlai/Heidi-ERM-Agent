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
  
  // Return true to indicate we'll send a response asynchronously
  return true
})

// Log that content script is loaded (helpful for debugging)
console.log('[Heidi Agent] Content script loaded')

