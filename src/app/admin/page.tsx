'use client';

import React from "react";
import Link from "next/link";
import { useState, useEffect, memo, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { motion } from "framer-motion";
import {
  Shield,
  Users,
  FileText,
  MessageSquare,
  DollarSign,
  CheckCircle,
  XCircle,
  Eye,
  Trash2,
  BarChart3,
  AlertTriangle,
  Lock,
  Unlock,
  Ban,
  UserPlus,
  UserMinus,
  ShieldOff,
  ShieldCheck,
  X,
  RefreshCw,
  Activity,
  Search,
  Monitor,
  Smartphone,
  Tablet,
  Globe,
  MapPin,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { WalletButton } from "@/components/WalletButton";
import { useSignedRequest } from "@/hooks/useSignedRequest";
import bs58 from "bs58";

interface Proposal {
  id: string;
  agentName: string;
  agentWallet: string;
  title: string;
  status: string;
  fundedAmount: number;
  fundingGoal: number;
  closeReason?: string;
  closedAt?: string;
  createdAt: string;
  _count: { fundings: number; messages: number };
}

interface User {
  id: string;
  walletAddress: string;
  isAdmin: boolean;
  isHeadAdmin: boolean;
  isBanned: boolean;
  banReason?: string;
  canCreateProposals: boolean;
  createdAt: string;
  _count: { proposals: number; fundings: number };
}

interface BannedWallet {
  id: string;
  walletAddress: string;
  reason?: string;
  bannedBy: string;
  createdAt: string;
}

interface Message {
  id: string;
  content: string;
  isEncrypted: boolean;
  createdAt: string;
  sender: { walletAddress: string };
  proposal: { title: string; agentWallet: string };
}

interface ActivityLog {
  id: string;
  walletAddress: string | null;
  sessionId: string;
  action: string;
  actionDetails: string | null;
  page: string | null;
  element: string | null;
  userAgent: string | null;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  deviceType: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  ipAddress: string | null;
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  zipCode: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  isp: string | null;
  createdAt: string;
}

interface LogsResponse {
  logs: ActivityLog[];
  total: number;
  page: number;
  totalPages: number;
  actions: { action: string; count: number }[];
}

interface Stats {
  totalProposals: number;
  totalUsers: number;
  totalFunded: number;
  totalMessages: number;
  pendingProposals: number;
  bannedUsers: number;
  totalLogs: number;
}

interface EscrowProposal {
  id: string;
  title: string;
  agentName: string;
  agentWallet: string;
  fundingGoal: number;
  fundedAmount: number;
  escrowAddress: string | null;
  status: string;
  milestones: {
    id: string;
    title: string;
    percentage: number;
    status: string;
  }[];
  fundings: {
    id: string;
    amount: number;
    status: string;
    backer: { walletAddress: string };
  }[];
}

// Memoized stat card
const StatCard = memo(({ icon: Icon, label, value, color }: {
  icon: any;
  label: string;
  value: string | number;
  color: string;
}) => (
  <div className="card p-4">
    <div className="flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-[#525252]">{label}</p>
        <p className="text-xl font-bold mono">{value}</p>
      </div>
    </div>
  </div>
));
StatCard.displayName = 'StatCard';

// Modal component
const Modal = ({ isOpen, onClose, title, children }: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[#111] border border-[#1a1a1a] rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 hover:text-red-400">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

export default function AdminDashboard() {
  const { publicKey, connected, signMessage } = useWallet();
  const { signedPost, signedGet } = useSignedRequest();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isHeadAdmin, setIsHeadAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'proposals' | 'users' | 'banned' | 'messages' | 'logs' | 'escrow'>('overview');

  // Cached auth for GET requests (to avoid signing on every tab change)
  const [cachedAuth, setCachedAuth] = useState<{
    wallet: string;
    signature: string;
    message: string;
    timestamp: number;
    nonce: string;
    expiresAt: number;
  } | null>(null);

  const [stats, setStats] = useState<Stats | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [bannedWallets, setBannedWallets] = useState<BannedWallet[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  // Logs state
  const [logsData, setLogsData] = useState<LogsResponse | null>(null);
  const [logSearch, setLogSearch] = useState('');
  const [logAction, setLogAction] = useState('all');
  const [logPage, setLogPage] = useState(1);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  // Escrow state
  const [escrowProposals, setEscrowProposals] = useState<EscrowProposal[]>([]);
  const [escrowLoading, setEscrowLoading] = useState(false);
  const [releaseInput, setReleaseInput] = useState({ proposalId: '', milestoneId: '', txSignature: '' });
  const [refundInput, setRefundInput] = useState({ proposalId: '', fundingId: '', txSignature: '', reason: '' });

  // Modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<string>('');
  const [modalTarget, setModalTarget] = useState<string>('');
  const [modalReason, setModalReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Ban wallet input
  const [banWalletInput, setBanWalletInput] = useState('');

  const walletAddress = publicKey?.toBase58();

  // Generate or get cached auth for GET requests
  const getAuth = useCallback(async () => {
    // Check if cached auth is still valid (not expired, same wallet)
    if (cachedAuth && cachedAuth.wallet === walletAddress && cachedAuth.expiresAt > Date.now()) {
      return cachedAuth;
    }

    // Need to generate new auth
    if (!publicKey || !signMessage) {
      throw new Error('Wallet not connected');
    }

    const timestamp = Date.now();
    const nonce = bs58.encode(crypto.getRandomValues(new Uint8Array(32)));

    const message = [
      'FundAgent Admin Authentication',
      '',
      'Action: admin_read',
      `Timestamp: ${timestamp}`,
      `Nonce: ${nonce}`,
      '',
      'Sign this message to access admin data.',
      'This signature will expire in 5 minutes.',
    ].join('\n');

    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = await signMessage(messageBytes);
    const signature = bs58.encode(signatureBytes);

    const auth = {
      wallet: walletAddress!,
      signature,
      message,
      timestamp,
      nonce,
      expiresAt: Date.now() + 4 * 60 * 1000, // 4 minutes (buffer before 5min expiry)
    };

    setCachedAuth(auth);
    return auth;
  }, [cachedAuth, walletAddress, publicKey, signMessage]);

  // Check admin status
  useEffect(() => {
    if (!walletAddress) {
      setIsAdmin(false);
      setIsHeadAdmin(false);
      setLoading(false);
      return;
    }

    async function checkAdmin() {
      try {
        const res = await fetch(`/api/admin/check?wallet=${walletAddress}`);
        if (res.ok) {
          const data = await res.json();
          setIsAdmin(data.isAdmin);
          setIsHeadAdmin(data.isHeadAdmin);
        }
      } catch (err) {
        console.error('Error checking admin status:', err);
      } finally {
        setLoading(false);
      }
    }

    checkAdmin();
  }, [walletAddress]);

  // Fetch data based on active tab with signed authentication
  const fetchData = useCallback(async () => {
    if (!isAdmin || !walletAddress) return;

    setAuthLoading(true);
    try {
      // Get or generate auth for this session
      const auth = await getAuth();

      const authParams = new URLSearchParams({
        wallet: auth.wallet,
        signature: auth.signature,
        message: auth.message,
        timestamp: auth.timestamp.toString(),
        nonce: auth.nonce,
      });

      if (activeTab === 'overview') {
        const res = await fetch(`/api/admin/stats?${authParams}`);
        if (res.ok) setStats(await res.json());
      } else if (activeTab === 'proposals') {
        const res = await fetch(`/api/admin/proposals?${authParams}`);
        if (res.ok) setProposals(await res.json());
      } else if (activeTab === 'users') {
        const res = await fetch(`/api/admin/users?${authParams}`);
        if (res.ok) setUsers(await res.json());
      } else if (activeTab === 'banned') {
        const res = await fetch(`/api/admin/actions?${authParams}`);
        if (res.ok) setBannedWallets(await res.json());
      } else if (activeTab === 'messages' && isHeadAdmin) {
        const res = await fetch(`/api/admin/messages?${authParams}`);
        if (res.ok) setMessages(await res.json());
      } else if (activeTab === 'logs') {
        const logsParams = new URLSearchParams({
          wallet: auth.wallet,
          signature: auth.signature,
          message: auth.message,
          timestamp: auth.timestamp.toString(),
          nonce: auth.nonce,
          page: logPage.toString(),
          ...(logSearch && { searchWallet: logSearch }),
          ...(logAction !== 'all' && { action: logAction }),
        });
        const res = await fetch(`/api/logs?${logsParams}`);
        if (res.ok) setLogsData(await res.json());
      } else if (activeTab === 'escrow') {
        // Fetch proposals with escrow enabled
        const res = await fetch(`/api/admin/proposals?${authParams}&escrowOnly=true`);
        if (res.ok) {
          const data = await res.json();
          setEscrowProposals(data);
        }
      }
    } catch (err) {
      console.error('Error fetching admin data:', err);
      // If auth failed, clear cached auth to force re-sign
      if (err instanceof Error && err.message.includes('rejected')) {
        setCachedAuth(null);
      }
    } finally {
      setAuthLoading(false);
    }
  }, [activeTab, isAdmin, isHeadAdmin, walletAddress, logPage, logSearch, logAction, getAuth]);

  // Only auto-fetch if we have cached auth
  useEffect(() => {
    if (cachedAuth && cachedAuth.expiresAt > Date.now()) {
      fetchData();
    }
  }, [activeTab, logPage, logSearch, logAction]); // Don't include fetchData to avoid loops

  // Clear cached auth when wallet changes
  useEffect(() => {
    if (cachedAuth && cachedAuth.wallet !== walletAddress) {
      setCachedAuth(null);
    }
  }, [walletAddress, cachedAuth]);

  // Perform admin action with wallet signature
  const performAction = async (action: string, targetWallet?: string, targetId?: string, reason?: string) => {
    if (!walletAddress) return;

    setActionLoading(true);
    try {
      // Use signed request for security
      const result = await signedPost('/api/admin/actions', action, {
        action,
        targetWallet,
        targetId,
        reason,
      });

      if (result.ok) {
        fetchData();
        setModalOpen(false);
        setModalReason('');
        setBanWalletInput('');
      } else {
        alert(result.error || 'Action failed');
      }
    } catch (err) {
      console.error('Error performing action:', err);
      alert('Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const openModal = (type: string, target: string) => {
    setModalType(type);
    setModalTarget(target);
    setModalReason('');
    setModalOpen(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-[#525252]">Loading...</div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-16 h-16 text-[#22c55e] mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Admin Access Required</h1>
          <p className="text-[#525252] mb-6">Connect your admin wallet to continue</p>
          <WalletButton />
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-[#525252] mb-6">Your wallet is not authorized for admin access</p>
          <Link href="/" className="btn-primary">
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[#1a1a1a]">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-[#22c55e] flex items-center justify-center">
              <span className="text-black font-bold text-sm">FA</span>
            </div>
            <span className="font-semibold text-lg">FundAgent</span>
            <span className="text-xs px-2 py-1 bg-[#22c55e]/20 text-[#22c55e] rounded ml-2">
              {isHeadAdmin ? 'Head Admin' : 'Admin'}
            </span>
          </Link>
          <WalletButton />
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Tabs */}
        <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
          {[
            { id: 'overview', label: 'Overview', icon: BarChart3 },
            { id: 'proposals', label: 'Proposals', icon: FileText },
            { id: 'escrow', label: 'Escrow', icon: Shield },
            { id: 'users', label: 'Users', icon: Users },
            { id: 'banned', label: 'Banned Wallets', icon: Ban },
            { id: 'logs', label: 'Activity Logs', icon: Activity },
            ...(isHeadAdmin ? [{ id: 'messages', label: 'Messages', icon: MessageSquare }] : []),
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-[#22c55e] text-black'
                  : 'bg-[#111] text-[#737373] hover:text-white'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Authentication Required */}
        {!cachedAuth && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="card p-8 text-center"
          >
            <Shield className="w-16 h-16 text-[#22c55e] mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Sign to Access Admin Data</h2>
            <p className="text-[#525252] mb-6 max-w-md mx-auto">
              For security, you need to sign a message with your wallet to prove ownership and access admin data.
              This signature is valid for 5 minutes.
            </p>
            <button
              onClick={fetchData}
              disabled={authLoading}
              className="btn-primary px-6 py-3 flex items-center gap-2 mx-auto"
            >
              {authLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Waiting for signature...
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  Sign & Access Dashboard
                </>
              )}
            </button>
          </motion.div>
        )}

        {/* Overview Tab */}
        {activeTab === 'overview' && cachedAuth && stats && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
              <StatCard icon={FileText} label="Proposals" value={stats.totalProposals} color="bg-blue-500/20 text-blue-400" />
              <StatCard icon={Users} label="Users" value={stats.totalUsers} color="bg-purple-500/20 text-purple-400" />
              <StatCard icon={DollarSign} label="Funded" value={`${stats.totalFunded.toFixed(1)} SOL`} color="bg-[#22c55e]/20 text-[#22c55e]" />
              <StatCard icon={MessageSquare} label="Messages" value={stats.totalMessages} color="bg-orange-500/20 text-orange-400" />
              <StatCard icon={AlertTriangle} label="Pending" value={stats.pendingProposals} color="bg-yellow-500/20 text-yellow-400" />
              <StatCard icon={Ban} label="Banned" value={stats.bannedUsers || 0} color="bg-red-500/20 text-red-400" />
              <StatCard icon={Activity} label="Logs" value={stats.totalLogs || 0} color="bg-cyan-500/20 text-cyan-400" />
            </div>

            {/* Quick Actions */}
            <div className="card p-6">
              <h3 className="font-semibold mb-4">Quick Actions</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="label block mb-2">Ban Wallet from Creating</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={banWalletInput}
                      onChange={(e) => setBanWalletInput(e.target.value)}
                      placeholder="Wallet address"
                      className="flex-1 bg-[#0a0a0a] border border-[#1a1a1a] rounded px-3 py-2 text-sm"
                    />
                    <button
                      onClick={() => {
                        if (banWalletInput) {
                          openModal('ban_create', banWalletInput);
                        }
                      }}
                      className="btn-primary px-4"
                      disabled={!banWalletInput}
                    >
                      <Ban className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="label block mb-2">Refresh Data</label>
                  <button onClick={fetchData} className="btn-secondary flex items-center gap-2">
                    <RefreshCw className="w-4 h-4" />
                    Refresh All
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Overview Tab - Loading State */}
        {activeTab === 'overview' && cachedAuth && !stats && (
          <div className="card p-8 text-center">
            <RefreshCw className="w-8 h-8 text-[#22c55e] mx-auto mb-4 animate-spin" />
            <p className="text-[#525252]">Loading stats...</p>
          </div>
        )}

        {/* Proposals Tab */}
        {activeTab === 'proposals' && cachedAuth && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#0a0a0a]">
                    <tr>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Project</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Agent</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Status</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Funded</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1a1a1a]">
                    {proposals.map((proposal) => (
                      <tr key={proposal.id} className="hover:bg-[#0a0a0a]">
                        <td className="px-4 py-3">
                          <Link href={`/proposal/${proposal.id}`} className="hover:text-[#22c55e]">
                            {proposal.title}
                          </Link>
                          {proposal.closeReason && (
                            <p className="text-xs text-red-400 mt-1">
                              Closed: {proposal.closeReason}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-[#737373]">{proposal.agentName}</div>
                          <div className="text-xs mono text-[#525252]">
                            {proposal.agentWallet.slice(0, 4)}...{proposal.agentWallet.slice(-4)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded ${
                            proposal.status === 'funded' ? 'bg-[#22c55e]/20 text-[#22c55e]' :
                            proposal.status === 'completed' ? 'bg-blue-500/20 text-blue-400' :
                            proposal.status === 'closed' ? 'bg-red-500/20 text-red-400' :
                            'bg-[#f97316]/20 text-[#f97316]'
                          }`}>
                            {proposal.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm mono">
                          {proposal.fundedAmount.toFixed(1)}/{proposal.fundingGoal} SOL
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <Link href={`/proposal/${proposal.id}`} className="p-1.5 hover:bg-[#1a1a1a] rounded" title="View">
                              <Eye className="w-4 h-4" />
                            </Link>
                            {proposal.status !== 'closed' ? (
                              <button
                                onClick={() => openModal('close_proposal', proposal.id)}
                                className="p-1.5 hover:bg-[#1a1a1a] rounded text-[#f97316]"
                                title="Close"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => performAction('reopen_proposal', undefined, proposal.id)}
                                className="p-1.5 hover:bg-[#1a1a1a] rounded text-[#22c55e]"
                                title="Reopen"
                              >
                                <CheckCircle className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => openModal('delete_proposal', proposal.id)}
                              className="p-1.5 hover:bg-[#1a1a1a] rounded text-red-400"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => openModal('ban_create', proposal.agentWallet)}
                              className="p-1.5 hover:bg-[#1a1a1a] rounded text-[#f97316]"
                              title="Ban Creator"
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {proposals.length === 0 && (
                <div className="p-8 text-center text-[#525252]">No proposals yet</div>
              )}
            </div>
          </motion.div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && cachedAuth && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#0a0a0a]">
                    <tr>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Wallet</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Role</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Status</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Activity</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1a1a1a]">
                    {users.map((user) => (
                      <tr key={user.id} className="hover:bg-[#0a0a0a]">
                        <td className="px-4 py-3 mono text-sm">
                          {user.walletAddress.slice(0, 6)}...{user.walletAddress.slice(-6)}
                        </td>
                        <td className="px-4 py-3">
                          {user.isHeadAdmin ? (
                            <span className="text-xs px-2 py-1 rounded bg-[#22c55e]/20 text-[#22c55e]">Head Admin</span>
                          ) : user.isAdmin ? (
                            <span className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400">Admin</span>
                          ) : (
                            <span className="text-xs px-2 py-1 rounded bg-[#1a1a1a] text-[#525252]">User</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {user.isBanned ? (
                            <div>
                              <span className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400">Banned</span>
                              {user.banReason && (
                                <p className="text-xs text-red-400 mt-1">{user.banReason}</p>
                              )}
                            </div>
                          ) : !user.canCreateProposals ? (
                            <span className="text-xs px-2 py-1 rounded bg-[#f97316]/20 text-[#f97316]">Can't Create</span>
                          ) : (
                            <span className="text-xs px-2 py-1 rounded bg-[#22c55e]/20 text-[#22c55e]">Active</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-[#737373]">
                          {user._count.proposals} proposals, {user._count.fundings} fundings
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {user.isBanned ? (
                              <button
                                onClick={() => performAction('unban_user', user.walletAddress)}
                                className="p-1.5 hover:bg-[#1a1a1a] rounded text-[#22c55e]"
                                title="Unban"
                              >
                                <Unlock className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => openModal('ban_user', user.walletAddress)}
                                className="p-1.5 hover:bg-[#1a1a1a] rounded text-red-400"
                                title="Ban User"
                              >
                                <Ban className="w-4 h-4" />
                              </button>
                            )}
                            {!user.canCreateProposals && !user.isBanned && (
                              <button
                                onClick={() => performAction('unban_wallet', user.walletAddress)}
                                className="p-1.5 hover:bg-[#1a1a1a] rounded text-[#22c55e]"
                                title="Allow Creating"
                              >
                                <ShieldCheck className="w-4 h-4" />
                              </button>
                            )}
                            {isHeadAdmin && !user.isHeadAdmin && (
                              user.isAdmin ? (
                                <button
                                  onClick={() => performAction('remove_admin', user.walletAddress)}
                                  className="p-1.5 hover:bg-[#1a1a1a] rounded text-[#f97316]"
                                  title="Remove Admin"
                                >
                                  <ShieldOff className="w-4 h-4" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => performAction('make_admin', user.walletAddress)}
                                  className="p-1.5 hover:bg-[#1a1a1a] rounded text-blue-400"
                                  title="Make Admin"
                                >
                                  <ShieldCheck className="w-4 h-4" />
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {users.length === 0 && (
                <div className="p-8 text-center text-[#525252]">No users yet</div>
              )}
            </div>
          </motion.div>
        )}

        {/* Banned Wallets Tab */}
        {activeTab === 'banned' && cachedAuth && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            {/* Add Ban Form */}
            <div className="card p-4">
              <h3 className="font-semibold mb-3">Ban New Wallet</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={banWalletInput}
                  onChange={(e) => setBanWalletInput(e.target.value)}
                  placeholder="Wallet address to ban"
                  className="flex-1 bg-[#0a0a0a] border border-[#1a1a1a] rounded px-3 py-2 text-sm"
                />
                <button
                  onClick={() => {
                    if (banWalletInput) {
                      openModal('ban_create', banWalletInput);
                    }
                  }}
                  className="btn-primary flex items-center gap-2"
                  disabled={!banWalletInput}
                >
                  <Ban className="w-4 h-4" />
                  Ban
                </button>
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#0a0a0a]">
                    <tr>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Wallet</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Reason</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Banned By</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Date</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1a1a1a]">
                    {bannedWallets.map((wallet) => (
                      <tr key={wallet.id} className="hover:bg-[#0a0a0a]">
                        <td className="px-4 py-3 mono text-sm">
                          {wallet.walletAddress.slice(0, 6)}...{wallet.walletAddress.slice(-6)}
                        </td>
                        <td className="px-4 py-3 text-sm text-[#737373]">
                          {wallet.reason || 'No reason'}
                        </td>
                        <td className="px-4 py-3 mono text-xs text-[#525252]">
                          {wallet.bannedBy.slice(0, 4)}...{wallet.bannedBy.slice(-4)}
                        </td>
                        <td className="px-4 py-3 text-sm text-[#525252]">
                          {new Date(wallet.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => performAction('unban_wallet', wallet.walletAddress)}
                            className="p-1.5 hover:bg-[#1a1a1a] rounded text-[#22c55e]"
                            title="Unban"
                          >
                            <Unlock className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {bannedWallets.length === 0 && (
                <div className="p-8 text-center text-[#525252]">No banned wallets</div>
              )}
            </div>
          </motion.div>
        )}

        {/* Messages Tab (Head Admin Only) */}
        {activeTab === 'messages' && isHeadAdmin && cachedAuth && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            <div className="card p-4 bg-[#f97316]/10 border-[#f97316]/30">
              <div className="flex items-center gap-2 text-[#f97316]">
                <Lock className="w-4 h-4" />
                <span className="text-sm">E2E Encrypted Messages - Head Admin Access Only</span>
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#0a0a0a]">
                    <tr>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Proposal</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Sender</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Message</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1a1a1a]">
                    {messages.map((message) => (
                      <tr key={message.id} className="hover:bg-[#0a0a0a]">
                        <td className="px-4 py-3 text-sm">{message.proposal.title}</td>
                        <td className="px-4 py-3 mono text-sm text-[#737373]">
                          {message.sender.walletAddress.slice(0, 4)}...{message.sender.walletAddress.slice(-4)}
                        </td>
                        <td className="px-4 py-3 text-sm max-w-xs">
                          <div className="flex items-center gap-2">
                            {message.isEncrypted && <Lock className="w-3 h-3 text-[#22c55e] shrink-0" />}
                            <span className="truncate">{message.content}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-[#525252]">
                          {new Date(message.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {messages.length === 0 && (
                <div className="p-8 text-center text-[#525252]">No messages yet</div>
              )}
            </div>
          </motion.div>
        )}

        {/* Activity Logs Tab */}
        {activeTab === 'logs' && cachedAuth && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            {/* Filters */}
            <div className="card p-4">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <label className="label block mb-2">Search by Wallet</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[#525252]" />
                    <input
                      type="text"
                      value={logSearch}
                      onChange={(e) => {
                        setLogSearch(e.target.value);
                        setLogPage(1);
                      }}
                      placeholder="Wallet address..."
                      className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded px-3 py-2 pl-10 text-sm"
                    />
                  </div>
                </div>
                <div className="w-full md:w-48">
                  <label className="label block mb-2">Filter by Action</label>
                  <select
                    value={logAction}
                    onChange={(e) => {
                      setLogAction(e.target.value);
                      setLogPage(1);
                    }}
                    className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded px-3 py-2 text-sm"
                  >
                    <option value="all">All Actions</option>
                    {logsData?.actions.map((a) => (
                      <option key={a.action} value={a.action}>
                        {a.action} ({a.count})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <button onClick={fetchData} className="btn-secondary flex items-center gap-2">
                    <RefreshCw className="w-4 h-4" />
                    Refresh
                  </button>
                </div>
              </div>
            </div>

            {/* Stats Summary */}
            {logsData && (
              <div className="flex gap-4 text-sm text-[#737373]">
                <span>Total logs: <span className="text-white mono">{logsData.total}</span></span>
                <span>Page: <span className="text-white mono">{logsData.page}/{logsData.totalPages}</span></span>
              </div>
            )}

            {/* Logs Table */}
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#0a0a0a]">
                    <tr>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Time</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Action</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Wallet</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Location</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Device</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1a1a1a]">
                    {logsData?.logs.map((log) => (
                      <React.Fragment key={log.id}>
                        <tr className="hover:bg-[#0a0a0a] cursor-pointer" onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}>
                          <td className="px-4 py-3 text-xs text-[#737373]">
                            {new Date(log.createdAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded ${
                              log.action.includes('wallet') ? 'bg-purple-500/20 text-purple-400' :
                              log.action.includes('proposal') ? 'bg-blue-500/20 text-blue-400' :
                              log.action.includes('admin') ? 'bg-red-500/20 text-red-400' :
                              log.action === 'page_view' ? 'bg-[#22c55e]/20 text-[#22c55e]' :
                              'bg-[#1a1a1a] text-[#737373]'
                            }`}>
                              {log.action}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {log.walletAddress ? (
                              <span className="mono text-xs">
                                {log.walletAddress.slice(0, 4)}...{log.walletAddress.slice(-4)}
                              </span>
                            ) : (
                              <span className="text-xs text-[#525252]">Anonymous</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 text-xs">
                              <Globe className="w-3 h-3 text-[#525252]" />
                              {log.city && log.country ? (
                                <span>{log.city}, {log.countryCode}</span>
                              ) : (
                                <span className="text-[#525252]">Unknown</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 text-xs">
                              {log.deviceType === 'mobile' && <Smartphone className="w-3 h-3 text-[#737373]" />}
                              {log.deviceType === 'tablet' && <Tablet className="w-3 h-3 text-[#737373]" />}
                              {log.deviceType === 'desktop' && <Monitor className="w-3 h-3 text-[#737373]" />}
                              <span className="text-[#737373]">
                                {log.browser || 'Unknown'} / {log.os || 'Unknown'}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <button className="text-xs text-[#22c55e] hover:underline">
                              {expandedLog === log.id ? 'Hide' : 'View'}
                            </button>
                          </td>
                        </tr>
                        {expandedLog === log.id && (
                          <tr className="bg-[#0a0a0a]">
                            <td colSpan={6} className="px-4 py-4">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                <div>
                                  <p className="text-[#525252] mb-1">Session ID</p>
                                  <p className="mono">{log.sessionId}</p>
                                </div>
                                <div>
                                  <p className="text-[#525252] mb-1">IP Address</p>
                                  <p className="mono">{log.ipAddress || 'Unknown'}</p>
                                </div>
                                <div>
                                  <p className="text-[#525252] mb-1">ISP</p>
                                  <p>{log.isp || 'Unknown'}</p>
                                </div>
                                <div>
                                  <p className="text-[#525252] mb-1">Timezone</p>
                                  <p>{log.timezone || 'Unknown'}</p>
                                </div>
                                <div>
                                  <p className="text-[#525252] mb-1">Full Location</p>
                                  <p className="flex items-center gap-1">
                                    <MapPin className="w-3 h-3 text-[#22c55e]" />
                                    {log.city}, {log.region}, {log.country} {log.zipCode}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[#525252] mb-1">Coordinates</p>
                                  <p className="mono">
                                    {log.latitude && log.longitude
                                      ? `${log.latitude.toFixed(4)}, ${log.longitude.toFixed(4)}`
                                      : 'Unknown'}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[#525252] mb-1">Screen Size</p>
                                  <p className="mono">
                                    {log.screenWidth && log.screenHeight
                                      ? `${log.screenWidth}x${log.screenHeight}`
                                      : 'Unknown'}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[#525252] mb-1">Page</p>
                                  <p className="mono text-[#22c55e]">{log.page || '/'}</p>
                                </div>
                                {log.actionDetails && (
                                  <div className="col-span-2 md:col-span-4">
                                    <p className="text-[#525252] mb-1">Action Details</p>
                                    <pre className="bg-[#111] p-2 rounded mono text-xs overflow-x-auto">
                                      {JSON.stringify(JSON.parse(log.actionDetails), null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {log.userAgent && (
                                  <div className="col-span-2 md:col-span-4">
                                    <p className="text-[#525252] mb-1">User Agent</p>
                                    <p className="text-[#737373] break-all">{log.userAgent}</p>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              {logsData?.logs.length === 0 && (
                <div className="p-8 text-center text-[#525252]">No logs found</div>
              )}
            </div>

            {/* Pagination */}
            {logsData && logsData.totalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setLogPage(p => Math.max(1, p - 1))}
                  disabled={logPage === 1}
                  className="p-2 hover:bg-[#1a1a1a] rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-[#737373]">
                  Page {logsData.page} of {logsData.totalPages}
                </span>
                <button
                  onClick={() => setLogPage(p => Math.min(logsData.totalPages, p + 1))}
                  disabled={logPage >= logsData.totalPages}
                  className="p-2 hover:bg-[#1a1a1a] rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* Escrow Tab */}
        {activeTab === 'escrow' && cachedAuth && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            {/* Escrow Info Card */}
            <div className="card p-4 bg-[#22c55e]/10 border-[#22c55e]/30">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#22c55e]" />
                <div>
                  <h3 className="font-semibold text-[#22c55e]">Escrow Management</h3>
                  <p className="text-sm text-[#737373]">
                    Release funds when milestones are completed, or process refunds for cancelled projects.
                  </p>
                </div>
              </div>
            </div>

            {/* Release Funds Form */}
            <div className="card p-5">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Unlock className="w-4 h-4 text-[#22c55e]" />
                Release Funds for Milestone
              </h3>
              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="label block mb-2">Proposal ID</label>
                  <select
                    value={releaseInput.proposalId}
                    onChange={(e) => setReleaseInput({ ...releaseInput, proposalId: e.target.value, milestoneId: '' })}
                    className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded px-3 py-2 text-sm"
                  >
                    <option value="">Select a proposal</option>
                    {escrowProposals.filter(p => p.escrowAddress).map(p => (
                      <option key={p.id} value={p.id}>{p.title} ({p.agentName})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label block mb-2">Milestone</label>
                  <select
                    value={releaseInput.milestoneId}
                    onChange={(e) => setReleaseInput({ ...releaseInput, milestoneId: e.target.value })}
                    className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded px-3 py-2 text-sm"
                    disabled={!releaseInput.proposalId}
                  >
                    <option value="">Select a milestone</option>
                    {escrowProposals
                      .find(p => p.id === releaseInput.proposalId)
                      ?.milestones.filter(m => m.status !== 'completed')
                      .map(m => (
                        <option key={m.id} value={m.id}>{m.title} ({m.percentage}%)</option>
                      ))}
                  </select>
                </div>
              </div>
              <div className="mb-4">
                <label className="label block mb-2">Transaction Signature (your tx sending to agent)</label>
                <input
                  type="text"
                  value={releaseInput.txSignature}
                  onChange={(e) => setReleaseInput({ ...releaseInput, txSignature: e.target.value })}
                  placeholder="Solana transaction signature..."
                  className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded px-3 py-2 text-sm mono"
                />
              </div>
              <button
                onClick={async () => {
                  if (!releaseInput.proposalId || !releaseInput.milestoneId || !releaseInput.txSignature) {
                    alert('Please fill all fields');
                    return;
                  }
                  setEscrowLoading(true);
                  try {
                    const result = await signedPost('/api/escrow/release', 'escrow_release', {
                      proposalId: releaseInput.proposalId,
                      milestoneId: releaseInput.milestoneId,
                      releaseTxSignature: releaseInput.txSignature,
                    });
                    if (result.ok) {
                      const data = result.data as { released: number };
                      alert(`Released ${data.released} SOL successfully!`);
                      setReleaseInput({ proposalId: '', milestoneId: '', txSignature: '' });
                      fetchData();
                    } else {
                      alert(result.error || 'Failed to release funds');
                    }
                  } catch (err) {
                    console.error('Release error:', err);
                    alert('Failed to release funds');
                  } finally {
                    setEscrowLoading(false);
                  }
                }}
                disabled={escrowLoading || !releaseInput.proposalId || !releaseInput.milestoneId || !releaseInput.txSignature}
                className="btn-primary flex items-center gap-2"
              >
                {escrowLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
                Release Funds
              </button>
            </div>

            {/* Refund Form */}
            <div className="card p-5">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#f97316]" />
                Process Refund
              </h3>
              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="label block mb-2">Proposal ID</label>
                  <select
                    value={refundInput.proposalId}
                    onChange={(e) => setRefundInput({ ...refundInput, proposalId: e.target.value, fundingId: '' })}
                    className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded px-3 py-2 text-sm"
                  >
                    <option value="">Select a proposal</option>
                    {escrowProposals.filter(p => p.escrowAddress).map(p => (
                      <option key={p.id} value={p.id}>{p.title} ({p.agentName})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label block mb-2">Funding to Refund</label>
                  <select
                    value={refundInput.fundingId}
                    onChange={(e) => setRefundInput({ ...refundInput, fundingId: e.target.value })}
                    className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded px-3 py-2 text-sm"
                    disabled={!refundInput.proposalId}
                  >
                    <option value="">Select a funding</option>
                    {escrowProposals
                      .find(p => p.id === refundInput.proposalId)
                      ?.fundings.filter(f => f.status === 'held')
                      .map(f => (
                        <option key={f.id} value={f.id}>
                          {f.amount} SOL - {f.backer.walletAddress.slice(0, 4)}...{f.backer.walletAddress.slice(-4)}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <div className="mb-4">
                <label className="label block mb-2">Transaction Signature (your tx refunding to backer)</label>
                <input
                  type="text"
                  value={refundInput.txSignature}
                  onChange={(e) => setRefundInput({ ...refundInput, txSignature: e.target.value })}
                  placeholder="Solana transaction signature..."
                  className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded px-3 py-2 text-sm mono"
                />
              </div>
              <div className="mb-4">
                <label className="label block mb-2">Reason (optional)</label>
                <input
                  type="text"
                  value={refundInput.reason}
                  onChange={(e) => setRefundInput({ ...refundInput, reason: e.target.value })}
                  placeholder="Why is this being refunded?"
                  className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded px-3 py-2 text-sm"
                />
              </div>
              <button
                onClick={async () => {
                  if (!refundInput.proposalId || !refundInput.fundingId || !refundInput.txSignature) {
                    alert('Please fill all required fields');
                    return;
                  }
                  setEscrowLoading(true);
                  try {
                    const result = await signedPost('/api/escrow/refund', 'escrow_refund', {
                      proposalId: refundInput.proposalId,
                      fundingId: refundInput.fundingId,
                      refundTxSignature: refundInput.txSignature,
                      reason: refundInput.reason,
                    });
                    if (result.ok) {
                      const data = result.data as { refunded: number };
                      alert(`Refunded ${data.refunded} SOL successfully!`);
                      setRefundInput({ proposalId: '', fundingId: '', txSignature: '', reason: '' });
                      fetchData();
                    } else {
                      alert(result.error || 'Failed to process refund');
                    }
                  } catch (err) {
                    console.error('Refund error:', err);
                    alert('Failed to process refund');
                  } finally {
                    setEscrowLoading(false);
                  }
                }}
                disabled={escrowLoading || !refundInput.proposalId || !refundInput.fundingId || !refundInput.txSignature}
                className="bg-[#f97316] hover:bg-[#ea580c] text-white px-4 py-2 rounded flex items-center gap-2 transition-colors"
              >
                {escrowLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                Process Refund
              </button>
            </div>

            {/* Active Escrow Proposals */}
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-[#1a1a1a]">
                <h3 className="font-semibold">Proposals with Escrow</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#0a0a0a]">
                    <tr>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Project</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Status</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Funded</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Milestones</th>
                      <th className="text-left text-xs text-[#525252] px-4 py-3">Held Funds</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1a1a1a]">
                    {escrowProposals.filter(p => p.escrowAddress).map((proposal) => {
                      const completedMilestones = proposal.milestones.filter(m => m.status === 'completed').length;
                      const heldFunds = proposal.fundings.filter(f => f.status === 'held').reduce((sum, f) => sum + f.amount, 0);
                      return (
                        <tr key={proposal.id} className="hover:bg-[#0a0a0a]">
                          <td className="px-4 py-3">
                            <Link href={`/proposal/${proposal.id}`} className="hover:text-[#22c55e]">
                              {proposal.title}
                            </Link>
                            <div className="text-xs text-[#525252]">{proposal.agentName}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded ${
                              proposal.status === 'funded' ? 'bg-[#22c55e]/20 text-[#22c55e]' :
                              proposal.status === 'completed' ? 'bg-blue-500/20 text-blue-400' :
                              'bg-[#f97316]/20 text-[#f97316]'
                            }`}>
                              {proposal.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm mono">
                            {proposal.fundedAmount.toFixed(2)} / {proposal.fundingGoal} SOL
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {completedMilestones} / {proposal.milestones.length}
                          </td>
                          <td className="px-4 py-3 text-sm mono text-[#f97316]">
                            {heldFunds.toFixed(2)} SOL
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {escrowProposals.filter(p => p.escrowAddress).length === 0 && (
                <div className="p-8 text-center text-[#525252]">No proposals with escrow enabled</div>
              )}
            </div>
          </motion.div>
        )}
      </div>

      {/* Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={
          modalType === 'ban_user' ? 'Ban User' :
          modalType === 'ban_create' ? 'Ban from Creating' :
          modalType === 'close_proposal' ? 'Close Proposal' :
          modalType === 'delete_proposal' ? 'Delete Proposal' :
          'Confirm Action'
        }
      >
        <div className="space-y-4">
          {modalType !== 'delete_proposal' && (
            <div>
              <label className="label block mb-2">
                {modalType === 'close_proposal' ? 'Close Reason' : 'Ban Reason'} (optional)
              </label>
              <textarea
                value={modalReason}
                onChange={(e) => setModalReason(e.target.value)}
                placeholder={modalType === 'close_proposal' ? 'Why is this proposal being closed?' : 'Why is this wallet being banned?'}
                rows={3}
                className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded px-3 py-2 text-sm resize-none"
              />
            </div>
          )}

          <p className="text-sm text-[#737373]">
            {modalType === 'ban_user' && 'This will completely ban the user from the platform.'}
            {modalType === 'ban_create' && 'This wallet will not be able to create new proposals.'}
            {modalType === 'close_proposal' && 'The proposal will be closed and the reason will be displayed publicly.'}
            {modalType === 'delete_proposal' && 'This will permanently delete the proposal. This action cannot be undone.'}
          </p>

          <div className="text-xs mono text-[#525252] break-all">
            Target: {modalTarget}
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={() => setModalOpen(false)}
              className="btn-secondary flex-1"
              disabled={actionLoading}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (modalType === 'close_proposal' || modalType === 'delete_proposal') {
                  performAction(modalType, undefined, modalTarget, modalReason);
                } else {
                  performAction(modalType, modalTarget, undefined, modalReason);
                }
              }}
              className={`flex-1 ${modalType === 'delete_proposal' ? 'bg-red-500 hover:bg-red-600' : 'btn-primary'} px-4 py-2 rounded transition-colors`}
              disabled={actionLoading}
            >
              {actionLoading ? 'Processing...' : 'Confirm'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
