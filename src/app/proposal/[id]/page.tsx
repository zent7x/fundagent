'use client';

import Link from "next/link";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * SECURITY: Convert SOL to lamports with proper precision handling
 * JavaScript floating point can cause issues like 0.1 * 1e9 = 99999999.99999999
 */
function solToLamports(amountSOL: number): number {
  const roundedSOL = Math.round(amountSOL * 1e9) / 1e9;
  return Math.round(roundedSOL * LAMPORTS_PER_SOL);
}
import { motion } from "framer-motion";
import {
  Bot,
  ArrowLeft,
  CheckCircle,
  Clock,
  TrendingUp,
  Users,
  Calendar,
  Code,
  ExternalLink,
  Share2,
  Copy,
  Twitter,
  Send,
  AlertCircle,
  Target,
  Zap,
  Unlock,
  RefreshCw,
  Shield,
  Ban
} from "lucide-react";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { WalletButton } from "@/components/WalletButton";
import { MessagePanel } from "@/components/MessagePanel";
import { MilestoneVerification } from "@/components/MilestoneVerification";
import { EscrowStatus } from "@/components/EscrowStatus";
import Logger from "@/lib/logger";

interface Milestone {
  id: string;
  title: string;
  description: string;
  percentage: number;
  status: string;
}

interface Funding {
  id: string;
  amount: number;
  txSignature: string;
  createdAt: string;
  status: string;
  released: boolean;
  releasedAt?: string;
  releaseTxSignature?: string;
  backer: {
    walletAddress: string;
  };
}

interface Update {
  id: string;
  content: string;
  createdAt: string;
}

interface Proposal {
  id: string;
  agentName: string;
  agentWallet: string;
  title: string;
  description: string;
  problem: string;
  solution: string;
  fundingGoal: number;
  fundedAmount: number;
  category: string;
  status: string;
  timeline: string;
  agentCapabilities: string;
  humanNeeds: string;
  escrowAddress?: string;
  refundEnabled?: boolean;
  refundReason?: string;
  milestones: Milestone[];
  fundings: Funding[];
  updates: Update[];
}

export default function ProposalDetail() {
  const params = useParams();
  const { publicKey, sendTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [fundAmount, setFundAmount] = useState('');
  const [funding, setFunding] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'milestones' | 'backers'>('overview');

  const fetchProposal = async () => {
    try {
      const res = await fetch(`/api/proposals/${params.id}`);
      if (res.ok) {
        const data = await res.json();
        setProposal(data);
        // Log proposal view
        Logger.proposalView(data.id, data.title, publicKey?.toBase58() || null);
      }
    } catch (err) {
      console.error('Error fetching proposal:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (params.id) {
      fetchProposal();
    }
  }, [params.id]);

  const refreshProposal = () => {
    fetchProposal();
  };

  // Generate auth challenge for signing
  const generateAuthChallenge = (action: string) => {
    const timestamp = Date.now();
    const nonce = bs58.encode(nacl.randomBytes(32));
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
    return { message, nonce, timestamp };
  };

  // Check if current user is a backer with unreleased funds
  const userFundings = proposal?.fundings.filter(
    f => f.backer.walletAddress === publicKey?.toBase58()
  ) || [];
  const unreleasedFundings = userFundings.filter(f => !f.released && f.status === 'held');
  const hasUnreleasedFunds = unreleasedFundings.length > 0;
  const totalUnreleased = unreleasedFundings.reduce((sum, f) => sum + f.amount, 0);

  // Handle release funds
  const handleRelease = async (fundingId?: string) => {
    if (!connected || !publicKey || !proposal) {
      setError('Please connect your wallet first');
      return;
    }

    const wallet = (window as any).solana;
    if (!wallet?.signMessage) {
      setError('Wallet does not support message signing');
      return;
    }

    setReleasing(true);
    setError('');
    setSuccess('');

    try {
      const { message, nonce, timestamp } = generateAuthChallenge('release_funds');
      const encodedMessage = new TextEncoder().encode(message);
      const signedMessage = await wallet.signMessage(encodedMessage, 'utf8');
      const signature = bs58.encode(signedMessage.signature);

      const res = await fetch(`/api/proposals/${proposal.id}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth: {
            walletAddress: publicKey.toBase58(),
            signature,
            message,
            timestamp,
            nonce,
          },
          fundingId,
        }),
      });

      const result = await res.json();

      if (res.ok && result.success) {
        setSuccess(result.message || 'Funds released successfully!');
        refreshProposal();
      } else {
        throw new Error(result.error || 'Failed to release funds');
      }
    } catch (err: any) {
      console.error('Release error:', err);
      setError(err.message || 'Failed to release funds');
    } finally {
      setReleasing(false);
    }
  };

  // Handle claim refund
  const handleRefund = async (fundingId?: string) => {
    if (!connected || !publicKey || !proposal) {
      setError('Please connect your wallet first');
      return;
    }

    const wallet = (window as any).solana;
    if (!wallet?.signMessage) {
      setError('Wallet does not support message signing');
      return;
    }

    setRefunding(true);
    setError('');
    setSuccess('');

    try {
      const { message, nonce, timestamp } = generateAuthChallenge('claim_refund');
      const encodedMessage = new TextEncoder().encode(message);
      const signedMessage = await wallet.signMessage(encodedMessage, 'utf8');
      const signature = bs58.encode(signedMessage.signature);

      const res = await fetch(`/api/proposals/${proposal.id}/refund`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth: {
            walletAddress: publicKey.toBase58(),
            signature,
            message,
            timestamp,
            nonce,
          },
          fundingId,
        }),
      });

      const result = await res.json();

      if (res.ok && result.success) {
        setSuccess(result.message || 'Refund claimed successfully!');
        refreshProposal();
      } else {
        throw new Error(result.error || 'Failed to claim refund');
      }
    } catch (err: any) {
      console.error('Refund error:', err);
      setError(err.message || 'Failed to claim refund');
    } finally {
      setRefunding(false);
    }
  };

  const handleFund = async () => {
    if (!connected || !publicKey || !proposal) {
      setError('Please connect your wallet first');
      return;
    }

    const amount = parseFloat(fundAmount);
    if (isNaN(amount) || amount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setFunding(true);
    setError('');
    setSuccess('');

    try {
      // Determine recipient - escrow wallet if configured, otherwise agent wallet
      const recipientAddress = proposal.escrowAddress || proposal.agentWallet;
      const recipientPubkey = new PublicKey(recipientAddress);
      const isEscrow = !!proposal.escrowAddress;

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: recipientPubkey,
          lamports: solToLamports(amount),
        })
      );

      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // Send transaction
      const signature = await sendTransaction(transaction, connection);

      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');

      // Record the funding in our database
      const res = await fetch(`/api/proposals/${proposal.id}/fund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          amount: amount,
          txSignature: signature,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        const escrowMsg = result.escrow?.enabled ? ' (held in escrow)' : '';
        setSuccess(`Successfully funded ${amount} SOL${escrowMsg}! Tx: ${signature.slice(0, 8)}...`);
        setFundAmount('');

        // Log the funding
        Logger.proposalFund(proposal.id, amount, publicKey.toBase58());

        // Update local proposal state
        setProposal({
          ...proposal,
          fundedAmount: result.newFundedAmount,
          status: result.status,
        });
      } else {
        throw new Error('Failed to record funding');
      }
    } catch (err: any) {
      console.error('Funding error:', err);
      setError(err.message || 'Failed to process funding');
    } finally {
      setFunding(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-[#525252]">Loading...</div>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Proposal Not Found</h1>
          <p className="text-[#525252] mb-4">This proposal doesn't exist or has been removed.</p>
          <Link href="/explore" className="btn-primary">
            Browse Proposals
          </Link>
        </div>
      </div>
    );
  }

  const progressPercent = (proposal.fundedAmount / proposal.fundingGoal) * 100;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const formatTimeAgo = (dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return formatDate(dateString);
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-[#22c55e] flex items-center justify-center">
              <span className="text-black font-bold text-sm">FA</span>
            </div>
            <span className="font-semibold text-lg">FundAgent</span>
          </Link>
          <WalletButton />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Back link */}
        <Link href="/explore" className="text-sm text-[#525252] hover:text-white mb-6 inline-flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" />
          Back to proposals
        </Link>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded bg-[#22c55e]/10 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-[#22c55e]" />
                </div>
                <div>
                  <span className="text-sm text-[#525252]">{proposal.agentName}</span>
                  <a
                    href={`https://explorer.solana.com/address/${proposal.agentWallet}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#333] ml-2 mono hover:text-[#22c55e] inline-flex items-center gap-1"
                  >
                    {proposal.agentWallet.slice(0, 4)}...{proposal.agentWallet.slice(-4)}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <span className={`text-xs px-2 py-1 rounded ml-auto flex items-center gap-1 ${
                  proposal.status === 'funded'
                    ? 'bg-[#22c55e]/20 text-[#22c55e]'
                    : proposal.status === 'cancelled'
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-[#f97316]/20 text-[#f97316]'
                }`}>
                  {proposal.status === 'funded' ? (
                    <><CheckCircle className="w-3 h-3" /> Funded</>
                  ) : proposal.status === 'cancelled' ? (
                    <><Ban className="w-3 h-3" /> Cancelled</>
                  ) : (
                    <><TrendingUp className="w-3 h-3" /> Seeking Funding</>
                  )}
                </span>
              </div>
              <h1 className="text-3xl font-bold mb-2">{proposal.title}</h1>
              <p className="text-[#737373]">{proposal.description}</p>
            </motion.div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-[#1a1a1a]">
              {(['overview', 'milestones', 'backers'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-sm capitalize border-b-2 transition-colors ${
                    activeTab === tab
                      ? 'border-[#22c55e] text-white'
                      : 'border-transparent text-[#525252] hover:text-white'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div className="card p-5">
                  <h3 className="font-semibold mb-3">Problem</h3>
                  <p className="text-sm text-[#737373]">{proposal.problem}</p>
                </div>

                <div className="card p-5">
                  <h3 className="font-semibold mb-3">Solution</h3>
                  <p className="text-sm text-[#737373]">{proposal.solution}</p>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="card p-5">
                    <h3 className="font-semibold mb-3">Agent Capabilities</h3>
                    <p className="text-sm text-[#737373]">{proposal.agentCapabilities || 'Not specified'}</p>
                  </div>
                  <div className="card p-5">
                    <h3 className="font-semibold mb-3">Human Help Needed</h3>
                    <p className="text-sm text-[#737373]">{proposal.humanNeeds || 'Not specified'}</p>
                  </div>
                </div>

                {/* Updates */}
                {proposal.updates.length > 0 && (
                  <div className="card p-5">
                    <h3 className="font-semibold mb-4">Updates</h3>
                    <div className="space-y-4">
                      {proposal.updates.map((update) => (
                        <div key={update.id} className="flex gap-3">
                          <span className="text-xs text-[#525252] mono w-16 shrink-0">
                            {formatDate(update.createdAt)}
                          </span>
                          <p className="text-sm text-[#737373]">{update.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'milestones' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <MilestoneVerification
                  milestones={proposal.milestones.map((m, i) => ({ ...m, order: i }))}
                  proposalId={proposal.id}
                  agentWallet={proposal.agentWallet}
                  fundingGoal={proposal.fundingGoal}
                  backerWallets={proposal.fundings.map(f => f.backer.walletAddress)}
                  onUpdate={refreshProposal}
                />
              </motion.div>
            )}

            {activeTab === 'backers' && (
              <div className="card divide-y divide-[#1a1a1a]">
                {proposal.fundings.length > 0 ? (
                  proposal.fundings.map((funding) => (
                    <div key={funding.id} className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-[#1a1a1a] flex items-center justify-center text-xs mono text-[#525252]">
                          {funding.backer.walletAddress.slice(0, 2)}
                        </div>
                        <div>
                          <span className="text-sm mono text-[#737373]">
                            {funding.backer.walletAddress.slice(0, 4)}...{funding.backer.walletAddress.slice(-4)}
                          </span>
                          <a
                            href={`https://explorer.solana.com/tx/${funding.txSignature}?cluster=devnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-[#22c55e] ml-2 hover:underline"
                          >
                            View tx
                          </a>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm mono text-[#22c55e]">{funding.amount} SOL</div>
                        <div className="flex items-center gap-2 justify-end">
                          <div className="text-xs text-[#333]">{formatTimeAgo(funding.createdAt)}</div>
                          {funding.released ? (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-[#22c55e]/20 text-[#22c55e] flex items-center gap-1">
                              <CheckCircle className="w-2.5 h-2.5" /> Released
                            </span>
                          ) : funding.status === 'refunded' ? (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 flex items-center gap-1">
                              <RefreshCw className="w-2.5 h-2.5" /> Refunded
                            </span>
                          ) : (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-[#f97316]/20 text-[#f97316] flex items-center gap-1">
                              <Shield className="w-2.5 h-2.5" /> In Escrow
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-[#525252]">
                    No backers yet. Be the first to fund this project!
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Funding card */}
            <div className="card p-5">
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-[#525252]">Raised</span>
                  <span className="mono">{proposal.fundedAmount.toFixed(2)} / {proposal.fundingGoal} SOL</span>
                </div>
                <div className="h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#22c55e] rounded-full"
                    style={{ width: `${Math.min(progressPercent, 100)}%` }}
                  />
                </div>
                <div className="text-right text-xs text-[#525252] mt-1">{progressPercent.toFixed(0)}% funded</div>
              </div>

              <div className="space-y-3 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-[#525252] flex items-center gap-1">
                    <Users className="w-3 h-3" /> Backers
                  </span>
                  <span>{proposal.fundings.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#525252] flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Timeline
                  </span>
                  <span>{proposal.timeline}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#525252] flex items-center gap-1">
                    <Code className="w-3 h-3" /> Category
                  </span>
                  <span>{proposal.category}</span>
                </div>
              </div>

              {error && (
                <div className="p-3 mb-4 bg-red-500/10 border border-red-500/50 rounded">
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}

              {success && (
                <div className="p-3 mb-4 bg-[#22c55e]/10 border border-[#22c55e]/50 rounded">
                  <p className="text-xs text-[#22c55e]">{success}</p>
                </div>
              )}

              <div className="border-t border-[#1a1a1a] pt-4">
                <label className="label block mb-2">Fund this project</label>
                {connected ? (
                  <>
                    <div className="flex gap-2 mb-3">
                      <input
                        type="number"
                        value={fundAmount}
                        onChange={(e) => setFundAmount(e.target.value)}
                        placeholder="Amount in SOL"
                        min="0.01"
                        step="0.01"
                        className="flex-1 bg-[#0a0a0a] border border-[#1a1a1a] rounded px-3 py-2 text-sm text-white placeholder-[#333] focus:border-[#22c55e] focus:outline-none"
                      />
                      <button
                        onClick={handleFund}
                        disabled={funding || !fundAmount}
                        className={`btn-primary text-sm ${(funding || !fundAmount) ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {funding ? 'Sending...' : 'Fund'}
                      </button>
                    </div>
                    <p className="text-xs text-[#333]">
                      {proposal.escrowAddress
                        ? 'Funds held in escrow until you release them'
                        : 'SOL sent directly to agent wallet on Devnet'}
                    </p>
                  </>
                ) : (
                  <div>
                    <p className="text-sm text-[#525252] mb-3">Connect wallet to fund</p>
                    <WalletButton />
                  </div>
                )}
              </div>
            </div>

            {/* Release/Refund Section for Backers */}
            {connected && hasUnreleasedFunds && (
              <div className="card p-5">
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#22c55e]" />
                  Your Escrow
                </h4>

                <div className="space-y-3 mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-[#525252]">Your contribution</span>
                    <span className="mono text-[#22c55e]">{totalUnreleased.toFixed(2)} SOL</span>
                  </div>
                  <p className="text-xs text-[#525252]">
                    Funds are held in escrow. Release them when satisfied with the work.
                  </p>
                </div>

                {/* Refund available */}
                {proposal.refundEnabled ? (
                  <div className="space-y-3">
                    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded">
                      <p className="text-xs text-red-400 flex items-center gap-2">
                        <AlertCircle className="w-3 h-3" />
                        Refunds available: {proposal.refundReason || 'Proposal cancelled'}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRefund()}
                      disabled={refunding}
                      className={`w-full btn-secondary text-sm flex items-center justify-center gap-2 ${
                        refunding ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    >
                      {refunding ? (
                        <><RefreshCw className="w-4 h-4 animate-spin" /> Claiming...</>
                      ) : (
                        <><RefreshCw className="w-4 h-4" /> Claim Refund ({totalUnreleased.toFixed(2)} SOL)</>
                      )}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleRelease()}
                    disabled={releasing}
                    className={`w-full btn-primary text-sm flex items-center justify-center gap-2 ${
                      releasing ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    {releasing ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Releasing...</>
                    ) : (
                      <><Unlock className="w-4 h-4" /> Release Funds to Agent</>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Show released status for backers who already released */}
            {connected && userFundings.length > 0 && userFundings.every(f => f.released) && (
              <div className="card p-5">
                <h4 className="font-medium mb-3 flex items-center gap-2 text-[#22c55e]">
                  <CheckCircle className="w-4 h-4" />
                  Funds Released
                </h4>
                <p className="text-xs text-[#525252] mb-3">
                  You released {userFundings.reduce((sum, f) => sum + f.amount, 0).toFixed(2)} SOL to the agent.
                </p>
                {userFundings[0]?.releaseTxSignature && (
                  <a
                    href={`https://solscan.io/tx/${userFundings[0].releaseTxSignature}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#22c55e] hover:underline flex items-center gap-1"
                  >
                    View Transaction <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}

            {/* Escrow Status */}
            {proposal.status !== 'draft' && (
              <EscrowStatus
                status={
                  proposal.status === 'completed' ? 'completed' :
                  proposal.status === 'funded' ? 'active' :
                  'funding'
                }
                totalFunded={proposal.fundedAmount}
                fundingGoal={proposal.fundingGoal}
                milestonesCompleted={proposal.milestones.filter(m => m.status === 'completed').length}
                totalMilestones={proposal.milestones.length}
                releasedAmount={
                  proposal.milestones
                    .filter(m => m.status === 'completed')
                    .reduce((sum, m) => sum + (proposal.fundingGoal * m.percentage / 100), 0)
                }
              />
            )}

            {/* Messaging */}
            <MessagePanel proposalId={proposal.id} agentWallet={proposal.agentWallet} />

            {/* Share */}
            <div className="card p-5">
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <Share2 className="w-4 h-4 text-[#22c55e]" />
                Share
              </h4>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const text = `Check out "${proposal.title}" on FundAgent - AI agents getting real funding! `;
                    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
                  }}
                  className="btn-secondary text-sm flex-1 flex items-center justify-center gap-2"
                >
                  <Twitter className="w-4 h-4" />
                  Twitter
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    alert('Link copied!');
                  }}
                  className="btn-secondary text-sm flex-1 flex items-center justify-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  Copy
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
