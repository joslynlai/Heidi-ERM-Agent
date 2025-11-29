import { GoogleGenerativeAI } from '@google/generative-ai'

interface FormField {
  id: string
  name: string
  type: string
  placeholder: string
  label: string
  tagName: string
  options?: string[]
}

interface FormSchema {
  url: string
  title: string
  fields: FormField[]
  timestamp: number
}

interface FieldMapping {
  [fieldId: string]: string
}

/**
 * Step context types - helps AI understand what form it's filling
 */
export type StepContext = 
  | 'encounter_form'    // Initial encounter/visit metadata
  | 'soap_form'         // SOAP note (Subjective, Objective, Assessment, Plan)
  | 'patient_info'      // Patient demographics
  | 'vitals'            // Vital signs
  | undefined           // Generic - no specific context

/**
 * Context-specific instructions for the AI
 */
const CONTEXT_INSTRUCTIONS: Record<string, string> = {
  encounter_form: `You are filling the ENCOUNTER FORM (visit metadata).
Focus on: Reason for visit, facility, provider, date of service, billing codes.
DO NOT fill clinical findings here - those go in the SOAP form later.`,

  soap_form: `You are filling the SOAP NOTE form.
- Subjective: Patient's complaints, history, symptoms in their own words
- Objective: Vital signs, physical exam findings, lab results
- Assessment: Diagnosis, clinical impressions, ICD codes
- Plan: Treatment plan, medications, follow-up instructions
Map the clinical note sections appropriately to S, O, A, P fields.`,

  patient_info: `You are filling PATIENT DEMOGRAPHICS.
Focus on: Name, DOB, gender, address, phone, insurance, emergency contact.
Only fill fields where you have explicit data.`,

  vitals: `You are filling VITAL SIGNS.
Focus on: Blood pressure, heart rate, temperature, weight, height, O2 sat, respiratory rate.
Use appropriate units. Leave blank if not mentioned.`,
}

/**
 * Extract JSON from Gemini's response, handling markdown code blocks
 */
function extractJSON(text: string): FieldMapping {
  // Remove markdown code blocks if present
  let cleaned = text.trim()
  
  // Handle ```json ... ``` blocks
  const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonBlockMatch) {
    cleaned = jsonBlockMatch[1].trim()
  }
  
  // Handle cases where response starts with text before JSON
  const jsonStartIndex = cleaned.indexOf('{')
  const jsonEndIndex = cleaned.lastIndexOf('}')
  
  if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
    cleaned = cleaned.substring(jsonStartIndex, jsonEndIndex + 1)
  }
  
  try {
    return JSON.parse(cleaned)
  } catch (error) {
    console.error('[Heidi Agent] Failed to parse JSON:', cleaned)
    throw new Error('Failed to parse AI response as JSON')
  }
}

/**
 * Generate a mapping from clinical note to form fields using Gemini
 * 
 * @param note - The Heidi clinical note
 * @param formSchema - Schema of visible form fields
 * @param apiKey - Gemini API key
 * @param context - Optional step context (e.g., 'soap_form', 'encounter_form')
 */
export async function generateMapping(
  note: string,
  formSchema: FormSchema,
  apiKey: string,
  context?: StepContext
): Promise<FieldMapping> {
  // Initialize Gemini client
  const genAI = new GoogleGenerativeAI(apiKey)
  
  // Build context-specific instructions
  const contextInstruction = context && CONTEXT_INSTRUCTIONS[context] 
    ? `\n\nCURRENT FORM CONTEXT:\n${CONTEXT_INSTRUCTIONS[context]}`
    : ''
  
  const model = genAI.getGenerativeModel({ 
    model: 'gemini-2.5-pro',
    systemInstruction: `You are an expert medical data entry agent. Your goal is to map a doctor's unstructured clinical note to a structured EMR form.

Important guidelines:
- Only map fields where you have clear, confident data from the note
- Use the exact field ID as the key in your response
- For date fields, use YYYY-MM-DD format
- For select/dropdown fields, match the value to one of the available options
- For checkboxes, use "true" or "false"
- Do not guess or fabricate data - only include fields you can confidently fill
- If a field doesn't have relevant data in the note, DO NOT include it${contextInstruction}`
  })

  // Build the context-aware prompt
  const contextLabel = context 
    ? `We are currently filling the ${context.replace(/_/g, ' ').toUpperCase()}.`
    : 'We are filling an EMR form.'

  const prompt = `CONTEXT: ${contextLabel}

VISIBLE FORM FIELDS:
${JSON.stringify(formSchema.fields, null, 2)}

TASK: Map the following clinical note to the field IDs above. Return ONLY a valid JSON object where keys are the field "id" (or "name" if id is empty) and values are the text to fill. Do not include markdown formatting, code blocks, or explanations.

CLINICAL NOTE:
${note}`

  const result = await model.generateContent(prompt)
  const response = result.response
  const text = response.text()

  if (!text) {
    throw new Error('No text response from AI')
  }

  // Parse and return the JSON mapping
  return extractJSON(text)
}
