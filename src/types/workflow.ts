/**
 * Workflow Types for Heidi EMR Agent
 * 
 * Hybrid approach:
 * - NAVIGATE_* actions use hardcoded selectors (stable OpenEMR UI)
 * - AI_AUTO_FILL uses dynamic AI scanning (variable patient data)
 */

export type StepAction = 
  | 'NAVIGATE_CLICK'    // Click a specific element by selector
  | 'NAVIGATE_WAIT'     // Wait for an element to appear (page load/transition)
  | 'NAVIGATE_CLICK_IFRAME' // Click inside an iframe
  | 'AI_AUTO_FILL'      // Scan page dynamically + fill with Heidi note
  | 'DEBUG_SCAN';       // Scan and log all interactive elements (for finding selectors)

export type StepStatus = 
  | 'pending' 
  | 'running' 
  | 'success' 
  | 'failed' 
  | 'skipped';

export interface WorkflowStep {
  id: number;
  description: string;
  action: StepAction;
  
  // For NAVIGATE_* actions - the CSS selector to target
  selector?: string;
  
  // For clicks inside iframes
  iframeSelector?: string;
  
  // For AI_AUTO_FILL - helps AI understand context
  context?: 'encounter_form' | 'soap_form' | 'patient_info' | 'vitals';
  
  // Optional: wait time after action (ms)
  waitAfter?: number;
  
  // Optional: max wait time for NAVIGATE_WAIT (ms)
  timeout?: number;
}

export interface WorkflowExecution {
  workflowName: string;
  currentStepIndex: number;
  steps: WorkflowStep[];
  status: 'idle' | 'running' | 'completed' | 'failed';
  stepStatuses: StepStatus[];
  error?: string;
}

export interface WorkflowConfig {
  name: string;
  description: string;
  version: string;
  steps: WorkflowStep[];
}

// Result of executing a single step
export interface StepResult {
  success: boolean;
  message: string;
  data?: unknown;
}

