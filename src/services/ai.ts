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
 */
export async function generateMapping(
  note: string,
  formSchema: FormSchema,
  apiKey: string
): Promise<FieldMapping> {
  // Initialize Gemini client
  const genAI = new GoogleGenerativeAI(apiKey)
  
  const model = genAI.getGenerativeModel({ 
    model: 'gemini-2.5-pro',
    systemInstruction: `You are an expert medical data entry agent. Your goal is to map a doctor's unstructured note to a structured EMR form.

Important guidelines:
- Only map fields where you have clear, confident data from the note
- Use the exact field ID as the key in your response
- For date fields, use YYYY-MM-DD format
- For select/dropdown fields, match the value to one of the available options
- For checkboxes, use "true" or "false"
- Do not guess or fabricate data - only include fields you can confidently fill`
  })

  const prompt = `Context: Here is the JSON schema of the visible inputs on the OpenEMR page:
${JSON.stringify(formSchema.fields, null, 2)}

Task: Map the following clinical note to the field IDs above. Return ONLY a valid JSON object where keys are the field "id" (or "name" if id is empty) and values are the text to fill. Do not include markdown formatting, code blocks, or explanations.

Clinical Note:
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
