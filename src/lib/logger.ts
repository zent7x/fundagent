'use client';

// Generate a unique session ID
function getSessionId(): string {
  if (typeof window === 'undefined') return 'server';

  let sessionId = sessionStorage.getItem('fundagent_session');
  if (!sessionId) {
    sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    sessionStorage.setItem('fundagent_session', sessionId);
  }
  return sessionId;
}

// Get screen dimensions
function getScreenInfo() {
  if (typeof window === 'undefined') return {};
  return {
    screenWidth: window.innerWidth,
    screenHeight: window.innerHeight,
  };
}

interface LogData {
  action: string;
  actionDetails?: Record<string, any>;
  page?: string;
  element?: string;
  walletAddress?: string | null;
}

// Main logging function
export async function logActivity(data: LogData) {
  try {
    const sessionId = getSessionId();
    const screenInfo = getScreenInfo();
    const currentPage = typeof window !== 'undefined' ? window.location.pathname : undefined;

    await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        page: data.page || currentPage,
        ...screenInfo,
        ...data,
      }),
    });
  } catch (error) {
    // Silent fail - don't interrupt user experience
    console.debug('Logging failed:', error);
  }
}

// Convenience functions for common actions
export const Logger = {
  // Page views
  pageView: (page: string, walletAddress?: string | null) => {
    logActivity({ action: 'page_view', page, walletAddress });
  },

  // Button clicks
  buttonClick: (buttonName: string, walletAddress?: string | null, details?: Record<string, any>) => {
    logActivity({
      action: 'button_click',
      element: buttonName,
      walletAddress,
      actionDetails: details,
    });
  },

  // Wallet events
  walletConnect: (walletAddress: string) => {
    logActivity({
      action: 'wallet_connect',
      walletAddress,
    });
  },

  walletDisconnect: (walletAddress: string) => {
    logActivity({
      action: 'wallet_disconnect',
      walletAddress,
    });
  },

  // Search
  search: (query: string, walletAddress?: string | null) => {
    logActivity({
      action: 'search',
      walletAddress,
      actionDetails: { query },
    });
  },

  // Proposal actions
  proposalView: (proposalId: string, proposalTitle: string, walletAddress?: string | null) => {
    logActivity({
      action: 'proposal_view',
      walletAddress,
      actionDetails: { proposalId, proposalTitle },
    });
  },

  proposalCreate: (proposalId: string, walletAddress: string) => {
    logActivity({
      action: 'proposal_create',
      walletAddress,
      actionDetails: { proposalId },
    });
  },

  proposalFund: (proposalId: string, amount: number, walletAddress: string) => {
    logActivity({
      action: 'proposal_fund',
      walletAddress,
      actionDetails: { proposalId, amount },
    });
  },

  // Category filter
  categoryFilter: (category: string, walletAddress?: string | null) => {
    logActivity({
      action: 'category_filter',
      walletAddress,
      actionDetails: { category },
    });
  },

  // Message events
  messageSend: (proposalId: string, walletAddress: string) => {
    logActivity({
      action: 'message_send',
      walletAddress,
      actionDetails: { proposalId },
    });
  },

  // Admin actions
  adminAction: (actionType: string, walletAddress: string, details?: Record<string, any>) => {
    logActivity({
      action: `admin_${actionType}`,
      walletAddress,
      actionDetails: details,
    });
  },

  // Custom event
  custom: (action: string, walletAddress?: string | null, details?: Record<string, any>) => {
    logActivity({
      action,
      walletAddress,
      actionDetails: details,
    });
  },
};

export default Logger;
