import type { MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

const contentSecurityPolicy = {
  defaultSrc: ["'self'"],
  baseUri: ["'none'"],
  connectSrc: ["'self'", 'https://challenges.cloudflare.com'],
  fontSrc: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  frameSrc: ['https://challenges.cloudflare.com'],
  imgSrc: ["'self'", 'data:'],
  objectSrc: ["'none'"],
  scriptSrc: [
    "'self'",
    'https://challenges.cloudflare.com',
    'https://static.cloudflareinsights.com',
  ],
  styleSrc: ["'self'", "'unsafe-inline'"],
  upgradeInsecureRequests: [],
};

export const securityHeaders: MiddlewareHandler = secureHeaders({
  contentSecurityPolicy,
  crossOriginOpenerPolicy: 'same-origin',
  crossOriginResourcePolicy: 'same-origin',
  originAgentCluster: '?1',
  permissionsPolicy: {
    camera: [],
    geolocation: [],
    microphone: [],
    payment: [],
    usb: [],
  },
  referrerPolicy: 'strict-origin-when-cross-origin',
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  xContentTypeOptions: 'nosniff',
  xDnsPrefetchControl: 'off',
  xDownloadOptions: 'noopen',
  xFrameOptions: 'DENY',
  xPermittedCrossDomainPolicies: 'none',
  xXssProtection: '0',
});
