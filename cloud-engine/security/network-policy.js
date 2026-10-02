/**
 * 24-HOUR CLOUD ENGINE — Network Policy / SSRF Protection
 * cloud-engine/security/network-policy.js
 *
 * Because users can configure custom RTMP/RTMPS destinations,
 * we validate all network destinations to prevent SSRF.
 *
 * Protected against:
 *   - localhost / loopback (127.0.0.1, ::1)
 *   - link-local addresses (169.254.x.x, fe80::)
 *   - private/internal network targets (10.x, 172.16-31.x, 192.168.x)
 *   - cloud metadata endpoints (169.254.169.254, 100.100.100.200)
 *   - malformed URLs
 *   - protocol abuse
 *
 * Allowed exceptions:
 *   - localhost only when explicitly running in devMode
 *   - Configurable per deployment
 *
 * Stage 13 — Multi-User Security + Isolation Hardening
 */

import { SECURITY_ERROR_CODE } from './security-errors.js';

/* ═══════════════════════════════════
   BLOCKED IP RANGES (parsed to prefix checks)
═══════════════════════════════════ */

// Blocked IPv4 ranges
const BLOCKED_IPV4_PREFIXES = [
  '127.',         // Loopback
  '10.',          // Private class A
  '0.',           // Reserved
  '169.254.',     // Link-local / AWS metadata
  '100.64.',      // Shared address space (RFC 6598)
  '100.65.',
  '100.66.',
  '100.67.',
  '100.68.',
  '100.69.',
  '100.70.',
  '100.71.',
  '100.72.',
  '100.73.',
  '100.74.',
  '100.75.',
  '100.76.',
  '100.77.',
  '100.78.',
  '100.79.',
  '100.80.',
  '100.81.',
  '100.82.',
  '100.83.',
  '100.84.',
  '100.85.',
  '100.86.',
  '100.87.',
  '100.88.',
  '100.89.',
  '100.90.',
  '100.91.',
  '100.92.',
  '100.93.',
  '100.94.',
  '100.95.',
  '100.96.',
  '100.97.',
  '100.98.',
  '100.99.',
  '100.100.',
  '100.101.',
  '100.102.',
  '100.103.',
  '100.104.',
  '100.105.',
  '100.106.',
  '100.107.',
  '100.108.',
  '100.109.',
  '100.110.',
  '100.111.',
  '100.112.',
  '100.113.',
  '100.114.',
  '100.115.',
  '100.116.',
  '100.117.',
  '100.118.',
  '100.119.',
  '100.120.',
  '100.121.',
  '100.122.',
  '100.123.',
  '100.124.',
  '100.125.',
  '100.126.',
  '100.127.',
  '192.168.',     // Private class C
  '198.18.',      // Benchmarking
  '198.19.',
  '255.',         // Broadcast
];

// Private 172.16.0.0/12 range — 172.16.x.x through 172.31.x.x
function _isPrivate172(hostname) {
  const match = hostname.match(/^172\.(\d{1,3})\./);
  if (match) {
    const octet = parseInt(match[1], 10);
    if (octet >= 16 && octet <= 31) return true;
  }
  return false;
}

// Specific blocked hostnames
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  '169.254.169.254',   // AWS EC2 metadata
  '100.100.100.200',   // Alibaba Cloud metadata
  'metadata.internal', // GCP metadata variant
]);

// IPv6 blocked prefixes
const BLOCKED_IPV6_PREFIXES = [
  '::1',          // Loopback
  'fc',           // Unique local
  'fd',           // Unique local
  'fe80',         // Link-local
];

/* ═══════════════════════════════════
   NETWORK DESTINATION VALIDATOR
═══════════════════════════════════ */

/**
 * Validate a network destination URL for SSRF safety.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {boolean} [opts.devMode]  If true, allow localhost connections
 * @returns {{ valid: boolean, reason?: string, code?: string }}
 */
export function validateNetworkDestination(url, opts = {}) {
  const { devMode = false } = opts;

  if (!url || typeof url !== 'string') {
    return { valid: false, reason: 'URL is required.', code: SECURITY_ERROR_CODE.MALFORMED_URL };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: 'Malformed URL.', code: SECURITY_ERROR_CODE.MALFORMED_URL };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Dev mode exception — only for explicit development environments
  if (devMode) {
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return { valid: true, devModeException: true };
    }
  }

  // Check blocked hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return {
      valid:  false,
      reason: `Blocked hostname: "${hostname}"`,
      code:   SECURITY_ERROR_CODE.SSRF_BLOCKED,
    };
  }

  // Check IPv4 blocked prefixes
  for (const prefix of BLOCKED_IPV4_PREFIXES) {
    if (hostname.startsWith(prefix)) {
      const isLoopback = hostname.startsWith('127.');
      return {
        valid:  false,
        reason: `Blocked address range: "${hostname}"`,
        code:   isLoopback
          ? SECURITY_ERROR_CODE.LOCALHOST_BLOCKED
          : (hostname.startsWith('169.254.')
            ? SECURITY_ERROR_CODE.METADATA_ENDPOINT_BLOCKED
            : SECURITY_ERROR_CODE.PRIVATE_NETWORK_BLOCKED),
      };
    }
  }

  // Check private 172.16-31.x.x range
  if (_isPrivate172(hostname)) {
    return {
      valid:  false,
      reason: `Blocked private network address: "${hostname}"`,
      code:   SECURITY_ERROR_CODE.PRIVATE_NETWORK_BLOCKED,
    };
  }

  // Check IPv6 blocked prefixes
  const hostnameNoSquare = hostname.replace(/^\[|\]$/g, '');
  for (const prefix of BLOCKED_IPV6_PREFIXES) {
    if (hostnameNoSquare.startsWith(prefix)) {
      return {
        valid:  false,
        reason: `Blocked IPv6 address: "${hostname}"`,
        code:   SECURITY_ERROR_CODE.SSRF_BLOCKED,
      };
    }
  }

  return { valid: true };
}

/**
 * Check if a hostname is a valid public RTMP streaming server.
 * Less strict than SSRF check — just verifies it's not a blocked range.
 * @param {string} hostname
 * @param {boolean} [devMode]
 * @returns {boolean}
 */
export function isAllowedStreamingHost(hostname, devMode = false) {
  const result = validateNetworkDestination(`rtmp://${hostname}/stream`, { devMode });
  return result.valid;
}
