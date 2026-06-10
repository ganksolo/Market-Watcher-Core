import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';

export const logger = pino({
  level,
  redact: {
    paths: [
      'authorization',
      'token',
      'password',
      'X_BEARER_TOKEN',
      '*.token',
      '*.authorization',
      '*.X_BEARER_TOKEN',
      '*.password',
    ],
    censor: '[REDACTED]',
  },
  transport: process.stdout.isTTY
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});
