/**
 * Configuration manager for the MCP server
 * Validates required environment variables and exports config settings
 */
import { envSchema, Config } from './types.js';
import { ZodError } from 'zod';

// Validate environment variables
function validateEnv() {
  try {
    // Parse and validate environment variables
    return envSchema.parse(process.env);
  } catch (error: unknown) {
    // Format and display validation errors
    console.error('[ERROR] Environment validation failed:');
    if (error instanceof ZodError) {
      error.issues.forEach((err) => {
        console.error(`- ${err.path.join('.')}: ${err.message}`);
      });
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}

// Get validated environment variables
const env = validateEnv();

// Application configuration with validated environment variables
const config: Config = {
  tempoApi: {
    baseUrl: 'https://api.tempo.io/4',
    token: env.TEMPO_API_TOKEN,
  },
  server: {
    name: 'tempo-mcp-server',
    version: '2.0.0',
  },
};

export default config;
