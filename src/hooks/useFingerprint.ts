/**
 * Client-side Fingerprinting Hook
 *
 * Generates a device fingerprint to help identify users across sessions.
 * This fingerprint is sent with API requests to help detect:
 * - Proxy/VPN users trying to evade blocks
 * - Automated attacks rotating IPs
 * - Ban evasion attempts
 *
 * Privacy note: This is used for security purposes only.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';

interface FingerprintData {
  fingerprint: string;
  components: {
    screenResolution: string;
    colorDepth: number;
    timezone: string;
    language: string;
    platform: string;
    cookiesEnabled: boolean;
    doNotTrack: string | null;
    plugins: string;
    canvas: string;
    webgl: string;
    fonts: string;
  };
}

/**
 * Generate a hash from string (simple but effective)
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Get canvas fingerprint
 */
function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-canvas';

    canvas.width = 200;
    canvas.height = 50;

    // Draw text with specific styling
    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('FundAgent.io', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('Security', 4, 17);

    return simpleHash(canvas.toDataURL());
  } catch {
    return 'canvas-error';
  }
}

/**
 * Get WebGL fingerprint
 */
function getWebGLFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return 'no-webgl';

    const webgl = gl as WebGLRenderingContext;
    const debugInfo = webgl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return 'no-debug-info';

    const vendor = webgl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
    const renderer = webgl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);

    return simpleHash(`${vendor}~${renderer}`);
  } catch {
    return 'webgl-error';
  }
}

/**
 * Get installed fonts fingerprint
 */
function getFontsFingerprint(): string {
  const baseFonts = ['monospace', 'sans-serif', 'serif'];
  const testFonts = [
    'Arial',
    'Courier New',
    'Georgia',
    'Times New Roman',
    'Verdana',
    'Helvetica',
    'Comic Sans MS',
    'Impact',
    'Trebuchet MS',
  ];

  const testString = 'mmmmmmmmmmlli';
  const testSize = '72px';
  const detected: string[] = [];

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'no-ctx';

  const getWidth = (font: string): number => {
    ctx.font = `${testSize} ${font}`;
    return ctx.measureText(testString).width;
  };

  const baseWidths = baseFonts.map(getWidth);

  for (const font of testFonts) {
    for (let i = 0; i < baseFonts.length; i++) {
      const width = getWidth(`'${font}', ${baseFonts[i]}`);
      if (width !== baseWidths[i]) {
        detected.push(font);
        break;
      }
    }
  }

  return simpleHash(detected.join(','));
}

/**
 * Get plugins fingerprint
 */
function getPluginsFingerprint(): string {
  if (!navigator.plugins) return 'no-plugins';

  const plugins = Array.from(navigator.plugins)
    .map((p) => `${p.name}:${p.filename}`)
    .sort()
    .join(',');

  return simpleHash(plugins || 'empty');
}

/**
 * Generate complete fingerprint
 */
function generateFingerprint(): FingerprintData {
  const components = {
    screenResolution: `${screen.width}x${screen.height}x${screen.colorDepth}`,
    colorDepth: screen.colorDepth,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    platform: navigator.platform,
    cookiesEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack,
    plugins: getPluginsFingerprint(),
    canvas: getCanvasFingerprint(),
    webgl: getWebGLFingerprint(),
    fonts: getFontsFingerprint(),
  };

  // Combine all components into a fingerprint
  const fingerprintString = Object.values(components).join('|');
  const fingerprint = simpleHash(fingerprintString);

  return { fingerprint, components };
}

/**
 * Hook to get device fingerprint
 */
export function useFingerprint() {
  const [fingerprintData, setFingerprintData] = useState<FingerprintData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Generate fingerprint on client side only
    if (typeof window !== 'undefined') {
      const data = generateFingerprint();
      setFingerprintData(data);
      setIsLoading(false);

      // Store in sessionStorage for API requests
      sessionStorage.setItem('device_fingerprint', data.fingerprint);
    }
  }, []);

  /**
   * Get headers to include with API requests
   */
  const getSecurityHeaders = useCallback(() => {
    if (!fingerprintData) return {};

    return {
      'X-Device-Fingerprint': fingerprintData.fingerprint,
      'X-Screen-Resolution': fingerprintData.components.screenResolution,
      'X-Timezone': fingerprintData.components.timezone,
      'X-Color-Depth': String(fingerprintData.components.colorDepth),
    };
  }, [fingerprintData]);

  return {
    fingerprint: fingerprintData?.fingerprint || null,
    components: fingerprintData?.components || null,
    isLoading,
    getSecurityHeaders,
  };
}

/**
 * Get stored fingerprint (for use outside React)
 */
export function getStoredFingerprint(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('device_fingerprint');
}

/**
 * Create a fetch wrapper that includes security headers
 */
export function createSecureFetch() {
  const fingerprint = getStoredFingerprint();

  return (url: string, options: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(options.headers);

    if (fingerprint) {
      headers.set('X-Device-Fingerprint', fingerprint);
    }

    // Add screen info
    if (typeof window !== 'undefined') {
      headers.set('X-Screen-Resolution', `${screen.width}x${screen.height}`);
      headers.set('X-Timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
      headers.set('X-Color-Depth', String(screen.colorDepth));
    }

    return fetch(url, {
      ...options,
      headers,
    });
  };
}
