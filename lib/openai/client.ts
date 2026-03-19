import OpenAI from 'openai'

// OpenAI client configuration
export function getOpenAIClientOrThrow() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OpenAI is not configured (missing OPENAI_API_KEY)')
  return new OpenAI({ apiKey })
}