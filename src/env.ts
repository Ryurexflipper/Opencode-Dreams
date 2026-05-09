export interface DreamEnvironment {
  apiKey?: string
  reflectModel?: string
  dreamModel?: string
  logLevel?: string
}

export function readDreamEnvironment(): DreamEnvironment {
  return {
    apiKey: process.env.OPENCODE_DREAM_API_KEY,
    reflectModel: process.env.OPENCODE_DREAM_REFLECT_MODEL,
    dreamModel: process.env.OPENCODE_DREAM_DREAM_MODEL,
    logLevel: process.env.OPENCODE_DREAM_LOG_LEVEL,
  }
}
