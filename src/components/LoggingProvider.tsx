'use client';

import { useEffect, createContext, useContext, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import Logger from '@/lib/logger';

// Context for accessing logger
const LoggingContext = createContext<typeof Logger>(Logger);

export const useLogger = () => useContext(LoggingContext);

export function LoggingProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { publicKey, connected } = useWallet();
  const prevConnected = useRef(connected);
  const sessionStartLogged = useRef(false);

  const walletAddress = publicKey?.toBase58() || null;

  // Track session start (first visit)
  useEffect(() => {
    if (!sessionStartLogged.current) {
      sessionStartLogged.current = true;
      Logger.custom('session_start', walletAddress, {
        entryPage: pathname,
        referrer: typeof document !== 'undefined' ? document.referrer : null,
        timestamp: new Date().toISOString(),
      });
    }
  }, []);

  // Track page views
  useEffect(() => {
    Logger.pageView(pathname, walletAddress);
  }, [pathname, walletAddress]);

  // Track wallet connect/disconnect
  useEffect(() => {
    if (connected && !prevConnected.current && walletAddress) {
      Logger.walletConnect(walletAddress);
    } else if (!connected && prevConnected.current) {
      Logger.custom('wallet_disconnect', walletAddress);
    }
    prevConnected.current = connected;
  }, [connected, walletAddress]);

  // Track page visibility changes (tab focus/blur)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        Logger.custom('page_blur', walletAddress, { page: pathname });
      } else if (document.visibilityState === 'visible') {
        Logger.custom('page_focus', walletAddress, { page: pathname });
      }
    };

    // Track session end (page unload)
    const handleBeforeUnload = () => {
      // Use sendBeacon for reliable logging on page unload
      const data = JSON.stringify({
        action: 'session_end',
        walletAddress,
        sessionId: sessionStorage.getItem('fundagent_session'),
        page: pathname,
        actionDetails: { exitPage: pathname },
      });

      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/logs', data);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [pathname, walletAddress]);

  return (
    <LoggingContext.Provider value={Logger}>
      {children}
    </LoggingContext.Provider>
  );
}

export default LoggingProvider;
