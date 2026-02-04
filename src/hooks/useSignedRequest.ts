'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useCallback } from 'react';
import bs58 from 'bs58';

/**
 * Hook for making signed API requests
 * Uses the connected wallet to sign authentication challenges
 */
export function useSignedRequest() {
  const { publicKey, signMessage } = useWallet();

  /**
   * Generate authentication data with wallet signature
   */
  const generateAuth = useCallback(async (action: string) => {
    if (!publicKey || !signMessage) {
      throw new Error('Wallet not connected or does not support signing');
    }

    const walletAddress = publicKey.toBase58();
    const timestamp = Date.now();
    const nonce = bs58.encode(crypto.getRandomValues(new Uint8Array(32)));

    const message = [
      'FundAgent Authentication',
      '',
      `Action: ${action}`,
      `Timestamp: ${timestamp}`,
      `Nonce: ${nonce}`,
      '',
      'Sign this message to prove wallet ownership.',
      'This signature will expire in 5 minutes.',
    ].join('\n');

    // Sign the message with the wallet
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = await signMessage(messageBytes);
    const signature = bs58.encode(signatureBytes);

    return {
      walletAddress,
      signature,
      message,
      timestamp,
      nonce,
    };
  }, [publicKey, signMessage]);

  /**
   * Make a signed POST request
   */
  const signedPost = useCallback(async <T>(
    url: string,
    action: string,
    data: Record<string, unknown>
  ): Promise<{ ok: boolean; data?: T; error?: string }> => {
    try {
      const auth = await generateAuth(action);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth,
          ...data,
        }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        return { ok: false, error: responseData.error || 'Request failed' };
      }

      return { ok: true, data: responseData };
    } catch (error) {
      if (error instanceof Error && error.message.includes('User rejected')) {
        return { ok: false, error: 'Signature request was rejected' };
      }
      console.error('Signed request error:', error);
      return { ok: false, error: 'Request failed' };
    }
  }, [generateAuth]);

  /**
   * Make a signed PATCH request
   */
  const signedPatch = useCallback(async <T>(
    url: string,
    action: string,
    data: Record<string, unknown>
  ): Promise<{ ok: boolean; data?: T; error?: string }> => {
    try {
      const auth = await generateAuth(action);

      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth,
          ...data,
        }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        return { ok: false, error: responseData.error || 'Request failed' };
      }

      return { ok: true, data: responseData };
    } catch (error) {
      if (error instanceof Error && error.message.includes('User rejected')) {
        return { ok: false, error: 'Signature request was rejected' };
      }
      console.error('Signed request error:', error);
      return { ok: false, error: 'Request failed' };
    }
  }, [generateAuth]);

  /**
   * Make a signed GET request (auth params in query string)
   */
  const signedGet = useCallback(async <T>(
    url: string,
    action: string,
    extraParams?: Record<string, string>
  ): Promise<{ ok: boolean; data?: T; error?: string }> => {
    try {
      const auth = await generateAuth(action);

      // Build query params with auth data
      const params = new URLSearchParams({
        wallet: auth.walletAddress,
        signature: auth.signature,
        message: auth.message,
        timestamp: auth.timestamp.toString(),
        nonce: auth.nonce,
        ...extraParams,
      });

      const response = await fetch(`${url}?${params}`);
      const responseData = await response.json();

      if (!response.ok) {
        return { ok: false, error: responseData.error || 'Request failed' };
      }

      return { ok: true, data: responseData };
    } catch (error) {
      if (error instanceof Error && error.message.includes('User rejected')) {
        return { ok: false, error: 'Signature request was rejected' };
      }
      console.error('Signed GET request error:', error);
      return { ok: false, error: 'Request failed' };
    }
  }, [generateAuth]);

  return {
    generateAuth,
    signedPost,
    signedPatch,
    signedGet,
    canSign: !!publicKey && !!signMessage,
  };
}
