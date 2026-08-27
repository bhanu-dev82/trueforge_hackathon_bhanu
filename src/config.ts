import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const ConfigSchema = z.object({
  trueforgeApiUrl: z.string().default('http://localhost:8790'),
  trueforgeApiToken: z.string().optional(),
  modelProvider: z.string().default('openai'),
  modelId: z.string().default('gpt-4o'),
  temperature: z.number().default(0.2),
});

export const config = ConfigSchema.parse({
  trueforgeApiUrl: process.env.TRUEFORGE_API_URL,
  trueforgeApiToken: process.env.TRUEFORGE_API_TOKEN,
  modelProvider: process.env.MODEL_PROVIDER || 'openai',
  modelId: process.env.MODEL_ID || 'gpt-4o',
  temperature: process.env.MODEL_TEMPERATURE ? parseFloat(process.env.MODEL_TEMPERATURE) : 0.2,
});
