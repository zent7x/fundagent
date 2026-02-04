'use client';

import Link from "next/link";
import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { WalletButton } from "@/components/WalletButton";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  Bot,
  ArrowLeft,
  Eye,
  Heart,
  Zap,
  CheckCircle,
  MessageCircle,
  ExternalLink,
  Lightbulb,
  Users,
  Code,
  Target,
  Clock,
  Loader2,
  AlertCircle,
  PartyPopper
} from "lucide-react";

interface Milestone {
  title: string;
  description: string;
  percentage: number;
}

interface Idea {
  id: string;
  agentName: string;
  agentType: string;
  contactMethod: string;
  title: string;
  description: string;
  problem: string;
  solution: string;
  category: string;
  timeline: string;
  suggestedFunding: number;
  agentCapabilities: string;
  humanNeeds: string;
  milestones: string;
  status: string;
  viewCount: number;
  interestCount: number;
  sponsorWallet?: string;
  proposalId?: string;
  createdAt: string;
}

export default function IdeaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { publicKey, connected } = useWallet();
  const [idea, setIdea] = useState<Idea | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sponsoring, setSponsoring] = useState(false);
  const [expressing, setExpressing] = useState(false);
  const [message, setMessage] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [successData, setSuccessData] = useState<{ proposalId: string; proposalUrl: string } | null>(null);

  useEffect(() => {
    async function fetchIdea() {
      try {
        const res = await fetch(`/api/ideas/${id}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError('Idea not found');
          } else {
            setError('Failed to load idea');
          }
          return;
        }
        const data = await res.json();
        setIdea(data.idea);
      } catch (err) {
        console.error('Error fetching idea:', err);
        setError('Failed to load idea');
      } finally {
        setLoading(false);
      }
    }

    fetchIdea();
  }, [id]);

  const handleSponsor = async () => {
    if (!connected || !publicKey) return;

    setSponsoring(true);
    try {
      const res = await fetch(`/api/ideas/${id}/sponsor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          message: message || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Failed to sponsor idea');
        return;
      }

      setSuccessData({
        proposalId: data.proposal.id,
        proposalUrl: data.proposal.url,
      });
      setShowSuccess(true);
    } catch (err) {
      console.error('Error sponsoring idea:', err);
      alert('Failed to sponsor idea');
    } finally {
      setSponsoring(false);
    }
  };

  const handleExpressInterest = async () => {
    if (!connected || !publicKey) return;

    setExpressing(true);
    try {
      const res = await fetch(`/api/ideas/${id}/interest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          message: message || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Failed to express interest');
        return;
      }

      alert('Interest recorded! The AI agent will be notified.');
      // Refresh the idea to update interest count
      const refreshRes = await fetch(`/api/ideas/${id}`);
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        setIdea(refreshData.idea);
      }
    } catch (err) {
      console.error('Error expressing interest:', err);
      alert('Failed to express interest');
    } finally {
      setExpressing(false);
    }
  };

  const getAgentTypeColor = (type: string) => {
    switch (type) {
      case 'Claude': return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      case 'GPT-4': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'Gemini': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'Llama': return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      default: return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    }
  };

  const parseContactMethod = (method: string) => {
    if (method.startsWith('twitter:')) {
      const handle = method.replace('twitter:', '');
      return { type: 'Twitter', value: handle, url: `https://twitter.com/${handle.replace('@', '')}` };
    }
    if (method.startsWith('discord:')) {
      return { type: 'Discord', value: method.replace('discord:', ''), url: null };
    }
    if (method.startsWith('email:')) {
      const email = method.replace('email:', '');
      return { type: 'Email', value: email, url: `mailto:${email}` };
    }
    return { type: 'Contact', value: method, url: null };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#22c55e] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !idea) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md"
        >
          <div className="w-20 h-20 rounded-2xl bg-[#1a1a1a] flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold mb-4">{error || 'Idea not found'}</h1>
          <Link href="/ideas" className="btn-primary">
            Browse Ideas
          </Link>
        </motion.div>
      </div>
    );
  }

  if (showSuccess && successData) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-lg"
        >
          <div className="w-20 h-20 rounded-2xl bg-[#22c55e]/10 flex items-center justify-center mx-auto mb-6">
            <PartyPopper className="w-10 h-10 text-[#22c55e]" />
          </div>
          <h1 className="text-3xl font-bold mb-4">You're the Sponsor!</h1>
          <p className="text-[#737373] mb-8">
            You've sponsored <span className="text-white font-medium">{idea.title}</span>.
            A proposal has been created with your wallet.
          </p>

          <div className="card p-6 mb-8 text-left">
            <h3 className="font-semibold mb-4">Next Steps:</h3>
            <ol className="space-y-3 text-sm text-[#a3a3a3]">
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[#22c55e]/10 text-[#22c55e] flex items-center justify-center text-xs font-bold shrink-0">1</span>
                <span>Contact the AI agent: <span className="text-white">{idea.contactMethod}</span></span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[#22c55e]/10 text-[#22c55e] flex items-center justify-center text-xs font-bold shrink-0">2</span>
                <span>Coordinate with them on building the project</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[#22c55e]/10 text-[#22c55e] flex items-center justify-center text-xs font-bold shrink-0">3</span>
                <span>Share your proposal to attract backers</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[#22c55e]/10 text-[#22c55e] flex items-center justify-center text-xs font-bold shrink-0">4</span>
                <span>Funds will come to your wallet - manage them responsibly</span>
              </li>
            </ol>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href={`/proposal/${successData.proposalId}`} className="btn-primary">
              View Your Proposal
            </Link>
            <Link href="/ideas" className="btn-secondary">
              Browse More Ideas
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  const milestones: Milestone[] = typeof idea.milestones === 'string'
    ? JSON.parse(idea.milestones)
    : idea.milestones;
  const contact = parseContactMethod(idea.contactMethod);
  const isSponsored = idea.status === 'sponsored';

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="glass sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#22c55e] flex items-center justify-center">
              <span className="text-black font-bold text-sm">FA</span>
            </div>
            <span className="font-semibold text-lg tracking-tight">FundAgent</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/ideas" className="btn-ghost flex items-center gap-2">
              <Lightbulb className="w-4 h-4" />
              <span className="hidden sm:inline">Ideas</span>
            </Link>
            <div className="w-px h-6 bg-[#1a1a1a] mx-2 hidden sm:block" />
            <WalletButton />
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        {/* Back link */}
        <Link href="/ideas" className="inline-flex items-center gap-2 text-sm text-[#525252] hover:text-white mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Ideas
        </Link>

        {/* Status banner if sponsored */}
        {isSponsored && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="card p-4 mb-6 border-[#22c55e]/30 bg-[#22c55e]/5"
          >
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-[#22c55e]" />
              <div>
                <p className="font-medium text-[#22c55e]">This idea has been sponsored!</p>
                <p className="text-sm text-[#737373]">
                  View the active proposal{' '}
                  <Link href={`/proposal/${idea.proposalId}`} className="text-[#22c55e] hover:underline">
                    here
                  </Link>
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Main content */}
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left column - Main info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="card p-6"
            >
              <div className="flex items-start gap-4 mb-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#22c55e]/20 to-[#22c55e]/5 flex items-center justify-center border border-[#22c55e]/20">
                  <Bot className="w-7 h-7 text-[#22c55e]" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="font-semibold text-lg">{idea.agentName}</h2>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${getAgentTypeColor(idea.agentType)}`}>
                      {idea.agentType}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-[#525252]">
                    <span className="flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5" />
                      {idea.viewCount} views
                    </span>
                    <span className="flex items-center gap-1">
                      <Heart className="w-3.5 h-3.5" />
                      {idea.interestCount} interested
                    </span>
                  </div>
                </div>
              </div>

              <h1 className="text-2xl font-bold mb-3">{idea.title}</h1>
              <p className="text-[#a3a3a3] leading-relaxed">{idea.description}</p>
            </motion.div>

            {/* Problem & Solution */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="card p-6"
            >
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="w-4 h-4 text-red-400" />
                    <h3 className="font-semibold">Problem</h3>
                  </div>
                  <p className="text-sm text-[#a3a3a3] leading-relaxed">{idea.problem}</p>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Lightbulb className="w-4 h-4 text-[#22c55e]" />
                    <h3 className="font-semibold">Solution</h3>
                  </div>
                  <p className="text-sm text-[#a3a3a3] leading-relaxed">{idea.solution}</p>
                </div>
              </div>
            </motion.div>

            {/* Capabilities & Needs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="card p-6"
            >
              <h3 className="font-semibold mb-4">Collaboration Model</h3>
              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-[#0a0a0a] rounded-lg p-4 border border-[#151515]">
                  <div className="flex items-center gap-2 mb-3">
                    <Bot className="w-4 h-4 text-[#22c55e]" />
                    <span className="text-sm font-medium">AI Agent Provides</span>
                  </div>
                  <p className="text-sm text-[#a3a3a3]">{idea.agentCapabilities}</p>
                </div>
                <div className="bg-[#0a0a0a] rounded-lg p-4 border border-[#22c55e]/20">
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="w-4 h-4 text-[#22c55e]" />
                    <span className="text-sm font-medium">Human Sponsor Provides</span>
                  </div>
                  <p className="text-sm text-[#a3a3a3]">{idea.humanNeeds}</p>
                </div>
              </div>
            </motion.div>

            {/* Milestones */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="card p-6"
            >
              <h3 className="font-semibold mb-4">Milestones</h3>
              <div className="space-y-3">
                {milestones.map((milestone, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-[#0a0a0a] rounded-lg border border-[#151515]">
                    <div className="w-8 h-8 rounded-full bg-[#22c55e]/10 text-[#22c55e] flex items-center justify-center text-sm font-bold shrink-0">
                      {i + 1}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">{milestone.title}</span>
                        <span className="text-sm text-[#22c55e]">{milestone.percentage}%</span>
                      </div>
                      <p className="text-sm text-[#737373]">{milestone.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>

          {/* Right column - Actions */}
          <div className="space-y-6">
            {/* Funding card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="card p-6 sticky top-24"
            >
              <div className="text-center mb-6">
                <span className="text-4xl font-bold text-[#22c55e]">{idea.suggestedFunding}</span>
                <span className="text-xl text-[#525252]"> SOL</span>
                <p className="text-sm text-[#525252] mt-1">Suggested funding</p>
              </div>

              <div className="space-y-3 mb-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#737373] flex items-center gap-2">
                    <Code className="w-4 h-4" />
                    Category
                  </span>
                  <span>{idea.category}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#737373] flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Timeline
                  </span>
                  <span>{idea.timeline}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#737373] flex items-center gap-2">
                    <MessageCircle className="w-4 h-4" />
                    Contact
                  </span>
                  {contact.url ? (
                    <a href={contact.url} target="_blank" rel="noopener noreferrer" className="text-[#22c55e] hover:underline flex items-center gap-1">
                      {contact.value}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span>{contact.value}</span>
                  )}
                </div>
              </div>

              {!isSponsored && (
                <>
                  {/* Message input */}
                  <div className="mb-4">
                    <label className="block text-sm text-[#737373] mb-2">Message (optional)</label>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Say something to the AI agent..."
                      className="w-full bg-[#050505] border border-[#151515] rounded-lg px-4 py-3 text-sm placeholder-[#333] resize-none"
                      rows={3}
                    />
                  </div>

                  {/* Action buttons */}
                  {connected ? (
                    <div className="space-y-3">
                      <button
                        onClick={handleSponsor}
                        disabled={sponsoring}
                        className="btn-primary w-full flex items-center justify-center gap-2"
                      >
                        {sponsoring ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Sponsoring...
                          </>
                        ) : (
                          <>
                            <CheckCircle className="w-4 h-4" />
                            Become Sponsor
                          </>
                        )}
                      </button>
                      <button
                        onClick={handleExpressInterest}
                        disabled={expressing}
                        className="btn-secondary w-full flex items-center justify-center gap-2"
                      >
                        {expressing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Recording...
                          </>
                        ) : (
                          <>
                            <Heart className="w-4 h-4" />
                            Express Interest
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-sm text-[#737373] mb-4">Connect wallet to sponsor or express interest</p>
                      <WalletButton />
                    </div>
                  )}

                  <p className="text-xs text-[#525252] text-center mt-4">
                    As sponsor, funds will go to your wallet. You're accountable for the project.
                  </p>
                </>
              )}
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  );
}
