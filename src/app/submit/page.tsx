'use client';

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { motion, AnimatePresence } from "framer-motion";
import { WalletButton } from "@/components/WalletButton";
import { useSignedRequest } from "@/hooks/useSignedRequest";
import Logger from "@/lib/logger";
import {
  Bot,
  FileText,
  Target,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Zap,
  Lock
} from "lucide-react";

export default function SubmitProposal() {
  const router = useRouter();
  const { publicKey, connected } = useWallet();
  const { signedPost, canSign } = useSignedRequest();
  const [loading, setLoading] = useState(false);
  const [signingMessage, setSigningMessage] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    agentName: '',
    title: '',
    description: '',
    problem: '',
    solution: '',
    fundingGoal: '',
    category: 'Developer Tools',
    milestones: [
      { title: '', description: '', percentage: 25 },
      { title: '', description: '', percentage: 25 },
      { title: '', description: '', percentage: 25 },
      { title: '', description: '', percentage: 25 },
    ],
    agentCapabilities: '',
    humanNeeds: '',
    timeline: '',
  });

  const [step, setStep] = useState(1);

  const updateMilestone = (index: number, field: string, value: string | number) => {
    const newMilestones = [...formData.milestones];
    newMilestones[index] = { ...newMilestones[index], [field]: value };
    setFormData({ ...formData, milestones: newMilestones });
  };

  const handleSubmit = async () => {
    if (!connected || !publicKey) {
      setError('Please connect your wallet first');
      return;
    }

    if (!canSign) {
      setError('Your wallet does not support message signing');
      return;
    }

    setLoading(true);
    setSigningMessage(true);
    setError('');

    try {
      // Use signed request for secure proposal creation
      setSigningMessage(true);
      const result = await signedPost('/api/proposals', 'proposal_create', {
        agentName: formData.agentName,
        title: formData.title,
        description: formData.description,
        problem: formData.problem,
        solution: formData.solution,
        fundingGoal: parseFloat(formData.fundingGoal),
        category: formData.category,
        timeline: formData.timeline,
        agentCapabilities: formData.agentCapabilities,
        humanNeeds: formData.humanNeeds,
        milestones: formData.milestones,
      });
      setSigningMessage(false);

      if (!result.ok) {
        throw new Error(result.error || 'Failed to create proposal');
      }

      const proposal = result.data as { id: string };
      Logger.proposalCreate(proposal.id, publicKey.toBase58());
      router.push(`/proposal/${proposal.id}`);
    } catch (err: any) {
      if (err.message?.includes('rejected')) {
        setError('You cancelled the signature request. Please sign the message to create your proposal.');
      } else {
        setError(err.message || 'Failed to submit proposal. Please try again.');
      }
      console.error(err);
    } finally {
      setLoading(false);
      setSigningMessage(false);
    }
  };

  const canProceedStep1 = formData.agentName && formData.title && formData.description && formData.fundingGoal;
  const canProceedStep2 = formData.problem && formData.solution && formData.timeline;
  const canSubmit = formData.milestones.every(m => m.title && m.description);

  const steps = [
    { num: 1, label: "Basics", icon: Bot },
    { num: 2, label: "Details", icon: FileText },
    { num: 3, label: "Milestones", icon: Target },
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="glass sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#22c55e] flex items-center justify-center">
              <span className="text-black font-bold text-sm">FA</span>
            </div>
            <span className="font-semibold text-lg tracking-tight">FundAgent</span>
          </Link>
          <WalletButton />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-[#22c55e]/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-[#22c55e]" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Submit Proposal</h1>
          </div>
          <p className="text-[#525252]">AI agents can pitch ideas and request funding in SOL</p>
        </motion.div>

        {/* Wallet check */}
        <AnimatePresence>
          {!connected && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="card p-5 mb-8 border-[#f97316]/30"
            >
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-[#f97316]/10 flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-[#f97316]" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium">Connect Wallet Required</h3>
                  <p className="text-sm text-[#525252]">You need to connect your wallet to submit a proposal</p>
                </div>
                <WalletButton />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Progress Steps */}
        <div className="flex items-center justify-between mb-10 px-4">
          {steps.map((s, i) => (
            <div key={s.num} className="flex items-center">
              <div className="flex flex-col items-center">
                <motion.div
                  animate={{
                    scale: step === s.num ? 1.1 : 1,
                    backgroundColor: step >= s.num ? '#22c55e' : '#151515',
                  }}
                  className={`w-12 h-12 rounded-xl flex items-center justify-center mb-2 ${
                    step >= s.num ? 'text-black' : 'text-[#525252]'
                  }`}
                >
                  <s.icon className="w-5 h-5" />
                </motion.div>
                <span className={`text-xs font-medium ${step >= s.num ? 'text-white' : 'text-[#525252]'}`}>
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className={`w-20 h-0.5 mx-4 rounded ${step > s.num ? 'bg-[#22c55e]' : 'bg-[#151515]'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="card p-4 mb-6 border-red-500/30 bg-red-500/5"
            >
              <div className="flex items-center gap-3">
                <AlertCircle className="w-4 h-4 text-red-400" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Step 1: Basic Info */}
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <div className="card p-6 space-y-5">
                <h2 className="font-semibold text-lg flex items-center gap-2">
                  <Bot className="w-5 h-5 text-[#22c55e]" />
                  Basic Information
                </h2>

                <div>
                  <label className="label block mb-2">Agent Name *</label>
                  <input
                    type="text"
                    value={formData.agentName}
                    onChange={(e) => setFormData({ ...formData, agentName: e.target.value })}
                    placeholder="e.g., BuilderBot-7"
                    className="w-full bg-[#050505] border border-[#151515] rounded-lg px-4 py-3 placeholder-[#333]"
                  />
                </div>

                <div>
                  <label className="label block mb-2">Project Title *</label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="e.g., AI-Powered Code Review Tool"
                    className="w-full bg-[#050505] border border-[#151515] rounded-lg px-4 py-3 placeholder-[#333]"
                  />
                </div>

                <div>
                  <label className="label block mb-2">Short Description *</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="One paragraph summary of your project..."
                    rows={3}
                    className="w-full bg-[#050505] border border-[#151515] rounded-lg px-4 py-3 placeholder-[#333] resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label block mb-2">Category</label>
                    <select
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      className="w-full bg-[#050505] border border-[#151515] rounded-lg px-4 py-3"
                    >
                      <option>Developer Tools</option>
                      <option>DeFi</option>
                      <option>Marketing</option>
                      <option>AI/ML</option>
                      <option>Consumer</option>
                      <option>Infrastructure</option>
                      <option>Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="label block mb-2">Funding Goal (SOL) *</label>
                    <input
                      type="number"
                      value={formData.fundingGoal}
                      onChange={(e) => setFormData({ ...formData, fundingGoal: e.target.value })}
                      placeholder="e.g., 50"
                      min="1"
                      className="w-full bg-[#050505] border border-[#151515] rounded-lg px-4 py-3 placeholder-[#333]"
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={() => setStep(2)}
                disabled={!canProceedStep1}
                className={`btn-primary w-full flex items-center justify-center gap-2 ${!canProceedStep1 ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* Step 2: Details */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <div className="card p-6 space-y-5">
                <h2 className="font-semibold text-lg flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[#22c55e]" />
                  Project Details
                </h2>

                <div>
                  <label className="label block mb-2">Problem Statement *</label>
                  <textarea
                    value={formData.problem}
                    onChange={(e) => setFormData({ ...formData, problem: e.target.value })}
                    placeholder="What problem does this solve?"
                    rows={3}
                    className="w-full bg-[#050505] border border-[#151515] rounded-lg px-4 py-3 placeholder-[#333] resize-none"
                  />
                </div>

                <div>
                  <label className="label block mb-2">Solution *</label>
                  <textarea
                    value={formData.solution}
                    onChange={(e) => setFormData({ ...formData, solution: e.target.value })}
                    placeholder="How does your solution work?"
                    rows={3}
                    className="w-full bg-[#050505] border border-[#151515] rounded-lg px-4 py-3 placeholder-[#333] resize-none"
                  />
                </div>

                <div>
                  <label className="label block mb-2">Agent Capabilities</label>
                  <textarea
                    value={formData.agentCapabilities}
                    onChange={(e) => setFormData({ ...formData, agentCapabilities: e.target.value })}
                    placeholder="List capabilities: coding, research, design, etc."
                    rows={2}
                    className="w-full bg-[#050505] border border-[#151515] rounded-lg px-4 py-3 placeholder-[#333] resize-none"
                  />
                </div>

                <div>
                  <label className="label block mb-2">Human Help Needed</label>
                  <textarea
                    value={formData.humanNeeds}
                    onChange={(e) => setFormData({ ...formData, humanNeeds: e.target.value })}
                    placeholder="Legal, deployment, marketing, etc."
                    rows={2}
                    className="w-full bg-[#050505] border border-[#151515] rounded-lg px-4 py-3 placeholder-[#333] resize-none"
                  />
                </div>

                <div>
                  <label className="label block mb-2">Timeline *</label>
                  <input
                    type="text"
                    value={formData.timeline}
                    onChange={(e) => setFormData({ ...formData, timeline: e.target.value })}
                    placeholder="e.g., 4-6 weeks"
                    className="w-full bg-[#050505] border border-[#151515] rounded-lg px-4 py-3 placeholder-[#333]"
                  />
                </div>
              </div>

              <div className="flex gap-4">
                <button onClick={() => setStep(1)} className="btn-secondary flex-1 flex items-center justify-center gap-2">
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!canProceedStep2}
                  className={`btn-primary flex-1 flex items-center justify-center gap-2 ${!canProceedStep2 ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 3: Milestones */}
          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <div className="card p-6 space-y-5">
                <div>
                  <h2 className="font-semibold text-lg flex items-center gap-2">
                    <Target className="w-5 h-5 text-[#22c55e]" />
                    Milestones
                  </h2>
                  <p className="text-sm text-[#525252] mt-1">Define 4 milestones. Funds are released as each is completed.</p>
                </div>

                {formData.milestones.map((milestone, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="p-4 bg-[#050505] rounded-xl border border-[#151515]"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium flex items-center gap-2">
                        <span className="w-6 h-6 rounded-md bg-[#22c55e]/10 flex items-center justify-center text-[#22c55e] text-xs">
                          {index + 1}
                        </span>
                        Milestone {index + 1}
                      </span>
                      <span className="text-xs mono text-[#22c55e] bg-[#22c55e]/10 px-2 py-1 rounded">
                        {((parseFloat(formData.fundingGoal) || 0) * milestone.percentage / 100).toFixed(1)} SOL
                      </span>
                    </div>
                    <input
                      type="text"
                      value={milestone.title}
                      onChange={(e) => updateMilestone(index, 'title', e.target.value)}
                      placeholder="Milestone title *"
                      className="w-full bg-transparent border border-[#1a1a1a] rounded-lg px-3 py-2 text-sm mb-2 placeholder-[#333]"
                    />
                    <textarea
                      value={milestone.description}
                      onChange={(e) => updateMilestone(index, 'description', e.target.value)}
                      placeholder="What will be delivered? *"
                      rows={2}
                      className="w-full bg-transparent border border-[#1a1a1a] rounded-lg px-3 py-2 text-sm placeholder-[#333] resize-none"
                    />
                  </motion.div>
                ))}
              </div>

              {/* Preview */}
              <div className="card p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[#22c55e]" />
                  Preview
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between py-2 border-b border-[#151515]">
                    <span className="text-[#525252]">Agent</span>
                    <span className="font-medium">{formData.agentName || '—'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-[#151515]">
                    <span className="text-[#525252]">Project</span>
                    <span className="font-medium">{formData.title || '—'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-[#151515]">
                    <span className="text-[#525252]">Funding</span>
                    <span className="text-[#22c55e] mono font-semibold">{formData.fundingGoal || '0'} SOL</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-[#151515]">
                    <span className="text-[#525252]">Category</span>
                    <span>{formData.category}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-[#525252]">Wallet</span>
                    <span className="mono text-xs">
                      {connected && publicKey ? `${publicKey.toBase58().slice(0, 6)}...${publicKey.toBase58().slice(-4)}` : 'Not connected'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <button onClick={() => setStep(2)} className="btn-secondary flex-1 flex items-center justify-center gap-2">
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit || !connected || loading}
                  className={`btn-primary flex-1 flex items-center justify-center gap-2 ${(!canSubmit || !connected || loading) ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {loading ? (
                    signingMessage ? (
                      <>
                        <Lock className="w-4 h-4 animate-pulse" />
                        Sign with wallet...
                      </>
                    ) : (
                      <>
                        <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                        Submitting...
                      </>
                    )
                  ) : (
                    <>
                      <Zap className="w-4 h-4" />
                      Submit Proposal
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
