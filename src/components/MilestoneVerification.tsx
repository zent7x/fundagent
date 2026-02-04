'use client';

import { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle,
  Clock,
  Target,
  Upload,
  ExternalLink,
  AlertCircle,
  Zap,
  Send,
  XCircle
} from 'lucide-react';

interface Milestone {
  id: string;
  title: string;
  description: string;
  percentage: number;
  status: string;
  order: number;
}

interface MilestoneVerificationProps {
  milestones: Milestone[];
  proposalId: string;
  agentWallet: string;
  fundingGoal: number;
  backerWallets?: string[];
  onUpdate: () => void;
}

export function MilestoneVerification({
  milestones,
  proposalId,
  agentWallet,
  fundingGoal,
  backerWallets = [],
  onUpdate
}: MilestoneVerificationProps) {
  const { publicKey, connected } = useWallet();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [deliverables, setDeliverables] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [expandedMilestone, setExpandedMilestone] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const walletAddress = publicKey?.toBase58();
  const isAgent = connected && walletAddress === agentWallet;
  const isBacker = connected && walletAddress !== agentWallet && backerWallets.includes(walletAddress || '');

  const handleSubmitMilestone = async (milestoneId: string) => {
    if (!connected || !publicKey) return;

    setSubmitting(milestoneId);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          milestoneId,
          walletAddress: publicKey.toBase58(),
          deliverables,
          proofUrl,
        }),
      });

      if (res.ok) {
        setSuccess('Milestone submitted for verification!');
        setDeliverables('');
        setProofUrl('');
        setExpandedMilestone(null);
        onUpdate();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to submit milestone');
      }
    } catch (err) {
      setError('Failed to submit milestone');
    } finally {
      setSubmitting(null);
    }
  };

  const handleVerifyMilestone = async (milestoneId: string, action: 'complete' | 'reject') => {
    if (!connected || !publicKey) return;

    setVerifying(milestoneId);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/milestones', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          milestoneId,
          action,
          walletAddress: publicKey.toBase58(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (action === 'complete') {
          setSuccess(`Milestone verified! ${data.releaseAmount?.toFixed(2)} SOL released.`);
        } else {
          setSuccess('Milestone sent back for revision.');
        }
        onUpdate();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to verify milestone');
      }
    } catch (err) {
      setError('Failed to verify milestone');
    } finally {
      setVerifying(null);
    }
  };

  const getNextMilestone = () => {
    return milestones.find(m => m.status === 'pending');
  };

  const nextMilestone = getNextMilestone();

  return (
    <div className="space-y-4">
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 bg-red-500/10 border border-red-500/50 rounded flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 text-red-400" />
          <p className="text-sm text-red-400">{error}</p>
        </motion.div>
      )}

      {success && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 bg-[#22c55e]/10 border border-[#22c55e]/50 rounded flex items-center gap-2"
        >
          <CheckCircle className="w-4 h-4 text-[#22c55e]" />
          <p className="text-sm text-[#22c55e]">{success}</p>
        </motion.div>
      )}

      {milestones.map((milestone, i) => {
        const releaseAmount = (fundingGoal * milestone.percentage) / 100;
        const isExpanded = expandedMilestone === milestone.id;
        const canSubmit = isAgent && milestone.status === 'pending' && milestone.id === nextMilestone?.id;
        const canVerify = isBacker && milestone.status === 'in_progress';

        return (
          <motion.div
            key={milestone.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className={`card overflow-hidden ${
              milestone.status === 'in_progress' ? 'border-[#f97316]/50' : ''
            }`}
          >
            <div className="p-5">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    milestone.status === 'completed' ? 'bg-[#22c55e] text-black' :
                    milestone.status === 'in_progress' ? 'bg-[#f97316] text-black' :
                    'bg-[#1a1a1a] text-[#525252]'
                  }`}>
                    {milestone.status === 'completed' ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : milestone.status === 'in_progress' ? (
                      <Clock className="w-5 h-5" />
                    ) : (
                      <Target className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <h4 className="font-medium">{milestone.title}</h4>
                    <p className="text-sm text-[#525252]">{milestone.description}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-sm mono text-[#22c55e] flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    {releaseAmount.toFixed(2)} SOL
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded inline-flex items-center gap-1 mt-1 ${
                    milestone.status === 'completed' ? 'bg-[#22c55e]/20 text-[#22c55e]' :
                    milestone.status === 'in_progress' ? 'bg-[#f97316]/20 text-[#f97316]' :
                    'bg-[#1a1a1a] text-[#525252]'
                  }`}>
                    {milestone.status === 'completed' && <CheckCircle className="w-3 h-3" />}
                    {milestone.status === 'in_progress' && <Clock className="w-3 h-3" />}
                    {milestone.status === 'pending' && <Target className="w-3 h-3" />}
                    {milestone.status === 'in_progress' ? 'Pending Review' : milestone.status}
                  </span>
                </div>
              </div>

              {/* Agent: Submit milestone */}
              {canSubmit && (
                <div className="mt-4 pt-4 border-t border-[#1a1a1a]">
                  {!isExpanded ? (
                    <button
                      onClick={() => setExpandedMilestone(milestone.id)}
                      className="btn-primary w-full flex items-center justify-center gap-2"
                    >
                      <Upload className="w-4 h-4" />
                      Submit for Verification
                    </button>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="space-y-3"
                    >
                      <div>
                        <label className="label block mb-1">Deliverables</label>
                        <textarea
                          value={deliverables}
                          onChange={(e) => setDeliverables(e.target.value)}
                          placeholder="Describe what you've completed..."
                          rows={3}
                          className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded px-3 py-2 text-sm text-white placeholder-[#333] focus:border-[#22c55e] focus:outline-none resize-none"
                        />
                      </div>
                      <div>
                        <label className="label block mb-1">Proof URL (optional)</label>
                        <input
                          type="url"
                          value={proofUrl}
                          onChange={(e) => setProofUrl(e.target.value)}
                          placeholder="https://github.com/... or demo link"
                          className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded px-3 py-2 text-sm text-white placeholder-[#333] focus:border-[#22c55e] focus:outline-none"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setExpandedMilestone(null)}
                          className="btn-secondary flex-1"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleSubmitMilestone(milestone.id)}
                          disabled={submitting === milestone.id || !deliverables}
                          className="btn-primary flex-1 flex items-center justify-center gap-2"
                        >
                          {submitting === milestone.id ? (
                            'Submitting...'
                          ) : (
                            <>
                              <Send className="w-4 h-4" />
                              Submit
                            </>
                          )}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}

              {/* Backer: Verify milestone */}
              {canVerify && (
                <div className="mt-4 pt-4 border-t border-[#1a1a1a]">
                  <p className="text-sm text-[#f97316] mb-3 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Awaiting verification from backers
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleVerifyMilestone(milestone.id, 'reject')}
                      disabled={verifying === milestone.id}
                      className="btn-secondary flex-1 flex items-center justify-center gap-2"
                    >
                      <XCircle className="w-4 h-4" />
                      Needs Revision
                    </button>
                    <button
                      onClick={() => handleVerifyMilestone(milestone.id, 'complete')}
                      disabled={verifying === milestone.id}
                      className="btn-primary flex-1 flex items-center justify-center gap-2"
                    >
                      {verifying === milestone.id ? (
                        'Verifying...'
                      ) : (
                        <>
                          <CheckCircle className="w-4 h-4" />
                          Verify & Release
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
