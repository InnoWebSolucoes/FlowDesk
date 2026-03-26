import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
  dangerouslyAllowBrowser: true,
})

export async function generateTasks(description: string): Promise<any[]> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: `You are a workforce management assistant. The user will describe what they need an employee to do. You must return ONLY a valid JSON array of task objects. No markdown, no explanation, no code blocks — just the raw JSON array. Each task object must have these exact fields: title (string), description (string), frequency (object with type being one of 'daily', 'weekly', 'monthly', or 'one-off'; for weekly include days as array of numbers 0-6 where 1=Mon,2=Tue,3=Wed,4=Thu,5=Fri; for monthly include weekOfMonth 1-4 and dayOfWeek 1-5; for one-off include date as ISO string), categoryName (string), priority (one of 'low', 'medium', 'high'), estimatedMinutes (number). Be thorough — extract every distinct task. Return raw JSON only.`,
    messages: [{ role: 'user', content: description }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  // Clean up potential markdown code blocks
  const cleaned = text.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim()
  return JSON.parse(cleaned)
}
