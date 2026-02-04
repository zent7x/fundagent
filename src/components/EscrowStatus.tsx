'use client';

import { motion } from 'framer-motion';
import { Shield, Lock, Unlock, CheckCircle, AlertTriangle } from 'lucide-react';

interface EscrowStatusProps {
  status: 'funding' | 'active' | 'completed' | 'cancelled';
  totalFunded: number;
  fundingGoal: number;
  milestonesCompleted: number;
  totalMilestones: number;
  releasedAmount: number;
}

export function EscrowStatus({
  status,
  totalFunded,
  fundingGoal,
  milestonesCompleted,
  totalMilestones,
  releasedAmount
}: EscrowStatusProps) {
  const lockedAmount = totalFunded - releasedAmount;
  // SECURITY: Prevent division by zero
  const progressPercent = totalMilestones > 0
    ? (milestonesCompleted / totalMilestones) * 100
    : 0;

  const getStatusInfo = () => {
    switch (status) {
      case 'funding':
        return {
          icon: Lock,
          color: 'text-[#f97316]',
          bg: 'bg-[#f97316]/10',
          border: 'border-[#f97316]/30',
          label: 'Funding Phase',
          description: 'Funds will be locked in escrow once goal is reached'
        };
      case 'active':
        return {
          icon: Shield,
          color: 'text-[#22c55e]',
          bg: 'bg-[#22c55e]/10',
          border: 'border-[#22c55e]/30',
          label: 'Escrow Active',
          description: 'Funds released as milestones are verified'
        };
      case 'completed':
        return {
          icon: CheckCircle,
          color: 'text-[#22c55e]',
          bg: 'bg-[#22c55e]/10',
          border: 'border-[#22c55e]/30',
          label: 'Completed',
          description: 'All funds released, project delivered'
        };
      case 'cancelled':
        return {
          icon: AlertTriangle,
          color: 'text-red-400',
          bg: 'bg-red-400/10',
          border: 'border-red-400/30',
          label: 'Cancelled',
          description: 'Refunds available for backers'
        };
      default:
        return {
          icon: Lock,
          color: 'text-[#525252]',
          bg: 'bg-[#1a1a1a]',
          border: 'border-[#1a1a1a]',
          label: 'Unknown',
          description: ''
        };
    }
  };

  const statusInfo = getStatusInfo();
  const StatusIcon = statusInfo.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`card p-4 ${statusInfo.border}`}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${statusInfo.bg}`}>
          <StatusIcon className={`w-4 h-4 ${statusInfo.color}`} />
        </div>
        <div>
          <h4 className={`font-medium text-sm ${statusInfo.color}`}>{statusInfo.label}</h4>
          <p className="text-xs text-[#525252]">{statusInfo.description}</p>
        </div>
      </div>

      {(status === 'active' || status === 'completed') && (
        <div className="space-y-2 pt-3 border-t border-[#1a1a1a]">
          <div className="flex justify-between text-xs">
            <span className="text-[#525252]">Milestones</span>
            <span className="mono">{milestonesCompleted}/{totalMilestones}</span>
          </div>

          <div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.5 }}
              className="h-full bg-[#22c55e] rounded-full"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2">
            <div className="text-center p-2 bg-[#0a0a0a] rounded">
              <p className="text-xs text-[#525252] mb-1 flex items-center justify-center gap-1">
                <Lock className="w-3 h-3" /> Locked
              </p>
              <p className="text-sm mono text-[#f97316]">{lockedAmount.toFixed(2)} SOL</p>
            </div>
            <div className="text-center p-2 bg-[#0a0a0a] rounded">
              <p className="text-xs text-[#525252] mb-1 flex items-center justify-center gap-1">
                <Unlock className="w-3 h-3" /> Released
              </p>
              <p className="text-sm mono text-[#22c55e]">{releasedAmount.toFixed(2)} SOL</p>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
