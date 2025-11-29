import { WorkflowConfig } from '../types/workflow'

/**
 * SOAP Note Workflow
 * 
 * Navigate from Patient Encounter page to SOAP form and fill it
 * 
 * Selectors updated from actual OpenEMR HTML inspection.
 */

export const SOAP_WORKFLOW: WorkflowConfig = {
  name: 'Navigate to SOAP Form',
  description: 'Fill encounter form, navigate to Clinical > SOAP, fill SOAP note',
  version: '2.0',
  
  steps: [
    // ===== STEP 1: Fill Encounter Form (AI Dynamic) =====
    {
      id: 1,
      action: 'AI_AUTO_FILL',
      description: '🤖 AI: Filling Encounter Form...',
      context: 'encounter_form',
      waitAfter: 1000,
    },
    
    // ===== STEP 2: Click Save Button (Encounter) =====
    // Source: <button id="saveEncounter" type="button" class="btn btn-primary btn-save">Save</button>
    {
      id: 2,
      action: 'NAVIGATE_CLICK_IFRAME',
      description: '💾 Nav: Saving Encounter...',
      selector: '#saveEncounter, button#saveEncounter, button.btn-save[type="button"]',
      waitAfter: 2000,
    },
    
    // ===== STEP 3: Wait for Clinical Menu =====
    // Source: <a id="category_Clinical" class="nav-link dropdown-toggle">Clinical</a>
    {
      id: 3,
      action: 'NAVIGATE_WAIT',
      description: '⏳ Nav: Waiting for page to stabilize...',
      selector: '#category_Clinical, a#category_Clinical, a.nav-link.dropdown-toggle',
      timeout: 10000,
    },
    
    // ===== STEP 4: Click Clinical Dropdown =====
    // Source: <a id="category_Clinical" class="nav-link dropdown-toggle" role="button" data-toggle="dropdown">Clinical</a>
    // Note: Uses NAVIGATE_CLICK_IFRAME because menu is inside an iframe
    {
      id: 4,
      action: 'NAVIGATE_CLICK_IFRAME',
      description: '📂 Nav: Opening Clinical menu...',
      selector: '#category_Clinical, a#category_Clinical',
      waitAfter: 500,
    },
    
    // ===== STEP 5: Click SOAP Option =====
    // Source: <a onclick="openNewForm(...soap...)">SOAP</a>
    // Note: Uses NAVIGATE_CLICK_IFRAME because dropdown is inside an iframe
    {
      id: 5,
      action: 'NAVIGATE_CLICK_IFRAME',
      description: '📝 Nav: Selecting SOAP...',
      selector: 'a[onclick*="soap"], a.dropdown-item[onclick*="soap"], a[onclick*="SOAP"]',
      waitAfter: 2000,
    },
    
    // ===== STEP 6: Wait for SOAP Form =====
    {
      id: 6,
      action: 'NAVIGATE_WAIT',
      description: '⏳ Nav: Waiting for SOAP form...',
      selector: [
        'textarea[name*="subjective"]',
        'textarea[name*="objective"]', 
        'textarea[name*="assessment"]',
        'textarea[name*="plan"]',
        '#subjective',
        '#objective',
        '#assessment', 
        '#plan',
        'form[name*="soap"]',
        'button[name="Submit"]'
      ].join(', '),
      timeout: 8000,
    },
    
    // ===== STEP 7: Fill SOAP Form (AI Dynamic) =====
    {
      id: 7,
      action: 'AI_AUTO_FILL',
      description: '🤖 AI: Filling SOAP Note...',
      context: 'soap_form',
      waitAfter: 1000,
    },
    
    // ===== STEP 8: Save SOAP Form =====
    // Source: <button type="submit" class="btn btn-primary btn-save" name="Submit">Save</button>
    {
      id: 8,
      action: 'NAVIGATE_CLICK_IFRAME',
      description: '💾 Nav: Saving SOAP Note...',
      selector: 'button[name="Submit"], button[type="submit"].btn-save, button[type="submit"][name="Submit"]',
      waitAfter: 1000,
    },
  ],
}

/**
 * Simplified workflow - just AI fill current page
 */
export const QUICK_FILL_WORKFLOW: WorkflowConfig = {
  name: 'Quick Fill Current Page',
  description: 'Just fill the current form with AI',
  version: '1.0',
  steps: [
    {
      id: 1,
      action: 'AI_AUTO_FILL',
      description: '🤖 AI: Analyzing and filling form...',
      waitAfter: 500,
    },
  ],
}

/**
 * Debug workflow - helps identify selectors
 * Run this FIRST to find the correct selectors for your OpenEMR
 */
export const DEBUG_WORKFLOW: WorkflowConfig = {
  name: '🔍 Debug: Find Selectors',
  description: 'Scans page and logs all buttons, links, and form elements',
  version: '1.0',
  steps: [
    {
      id: 1,
      action: 'DEBUG_SCAN',
      description: '🔍 Scanning page for buttons, links, inputs...',
    },
  ],
}

/**
 * Get a subset of steps for testing
 */
export function getTestWorkflow(stepCount: number = 3): WorkflowConfig {
  return {
    ...SOAP_WORKFLOW,
    name: 'Test Workflow',
    steps: SOAP_WORKFLOW.steps.slice(0, stepCount),
  }
}

/**
 * Create a custom workflow starting from a specific step
 */
export function createWorkflowFromStep(startStep: number): WorkflowConfig {
  const steps = SOAP_WORKFLOW.steps.filter(s => s.id >= startStep)
  return {
    ...SOAP_WORKFLOW,
    name: `SOAP Workflow (from step ${startStep})`,
    steps: steps.map((step, index) => ({ ...step, id: index + 1 })),
  }
}
