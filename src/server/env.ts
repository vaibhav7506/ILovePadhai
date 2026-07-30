import { z } from 'zod';

const runtimeVariablesSchema = z
  .object({
    APP_ENV: z.enum(['local', 'preview', 'production']),
    PRODUCT_NAME: z.string().min(1).max(60),
    PRODUCT_DESCRIPTION: z.string().min(1).max(180),
    TURNSTILE_MODE: z.enum(['off', 'enforced']),
    TURNSTILE_HOSTNAMES: z.string(),
    TURNSTILE_SECRET_KEY: z.string().min(20).optional(),
    ADMIN_MODE: z.enum(['local', 'access']).default('local'),
    ACCESS_TEAM_DOMAIN: z.url().optional(),
    ACCESS_AUD: z.string().min(10).optional(),
    ATTEMPT_SIGNING_SECRET: z.string().min(32).optional(),
    GROQ_ENABLED: z.enum(['off', 'on']).default('off'),
    GROQ_MODEL: z.string().min(3).max(120).default('llama-3.3-70b-versatile'),
    GROQ_VERIFICATION_MODEL: z.string().min(3).max(120).default('openai/gpt-oss-20b'),
    GROQ_API_KEY: z.string().min(20).optional(),
    AI_GENERATION_ENABLED: z.enum(['off', 'on']).default('on'),
    AI_VISITOR_DAILY_LIMIT: z.coerce.number().int().min(1).max(100).default(5),
    AI_GLOBAL_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(1).max(100000).default(500),
    AI_GLOBAL_DAILY_TOKEN_LIMIT: z.coerce
      .number()
      .int()
      .min(1000)
      .max(100000000)
      .default(2_000_000),
  })
  .superRefine((value, context) => {
    if (value.TURNSTILE_MODE === 'enforced' && !value.TURNSTILE_SECRET_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['TURNSTILE_SECRET_KEY'],
        message: 'TURNSTILE_SECRET_KEY is required when Turnstile is enforced.',
      });
    }
    if (value.ADMIN_MODE === 'access' && (!value.ACCESS_TEAM_DOMAIN || !value.ACCESS_AUD)) {
      context.addIssue({
        code: 'custom',
        path: ['ACCESS_TEAM_DOMAIN'],
        message: 'Cloudflare Access team domain and audience are required in access mode.',
      });
    }
    if (value.GROQ_ENABLED === 'on' && !value.GROQ_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['GROQ_API_KEY'],
        message: 'GROQ_API_KEY is required only when Groq is enabled.',
      });
    }
  });

export type RuntimeVariables = z.infer<typeof runtimeVariablesSchema>;

export function validateRuntimeEnvironment(env: Env): RuntimeVariables {
  return runtimeVariablesSchema.parse(env);
}
