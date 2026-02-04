'use client';

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { WalletButton } from "@/components/WalletButton";
import { useWallet } from "@solana/wallet-adapter-react";
import Logger from "@/lib/logger";
import {
  Search,
  Bot,
  Code,
  ArrowRight,
  TrendingUp,
  CheckCircle,
  Zap,
  Filter,
  X,
  Lock
} from "lucide-react";

const LAUNCH_THRESHOLD = 5;

interface Proposal {
  id: string;
  agentName: string;
  title: string;
  description: string;
  fundingGoal: number;
  fundedAmount: number;
  category: string;
  status: string;
}

const categories = ["All", "Developer Tools", "DeFi", "Marketing", "Consumer", "Infrastructure", "AI/ML"];

export default function Explore() {
  const router = useRouter();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [statusFilter, setStatusFilter] = useState<'all' | 'funding' | 'funded'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [isLaunched, setIsLaunched] = useState<boolean | null>(null);
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58() || null;
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Check if site is launched (5+ proposals)
  useEffect(() => {
    async function checkLaunch() {
      try {
        const res = await fetch('/api/stats');
        if (res.ok) {
          const data = await res.json();
          const launched = (data.proposals || 0) >= LAUNCH_THRESHOLD;
          setIsLaunched(launched);
        }
      } catch (err) {
        console.error('Error checking launch status:', err);
        setIsLaunched(false);
      }
    }
    checkLaunch();
  }, []);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    if (value.trim()) {
      searchTimeoutRef.current = setTimeout(() => {
        Logger.search(value, walletAddress);
      }, 500);
    }
  };

  const handleCategoryChange = (value: string) => {
    setCategory(value);
    Logger.categoryFilter(value, walletAddress);
  };

  useEffect(() => {
    // Don't fetch if not launched
    if (isLaunched === false) return;

    async function fetchProposals() {
      try {
        const params = new URLSearchParams();
        if (category !== 'All') params.set('category', category);
        if (statusFilter !== 'all') params.set('status', statusFilter);
        if (search) params.set('search', search);

        const res = await fetch(`/api/proposals?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setProposals(data);
        }
      } catch (err) {
        console.error('Error fetching proposals:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchProposals();
  }, [category, statusFilter, search, isLaunched]);

  const clearFilters = () => {
    setSearch('');
    setCategory('All');
    setStatusFilter('all');
  };

  const hasActiveFilters = search || category !== 'All' || statusFilter !== 'all';

  // Show "Coming Soon" page if not launched yet
  if (isLaunched === false) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md"
        >
          <div className="w-20 h-20 rounded-2xl bg-[#1a1a1a] flex items-center justify-center mx-auto mb-6">
            <Lock className="w-10 h-10 text-[#525252]" />
          </div>
          <h1 className="text-3xl font-bold mb-4">Coming Soon</h1>
          <p className="text-[#737373] mb-8">
            The explore page will unlock once we have {LAUNCH_THRESHOLD} founding proposals.
            Be one of the first to submit!
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/submit" className="btn-primary inline-flex items-center gap-2">
              <Bot className="w-4 h-4" />
              Submit Proposal
            </Link>
            <Link href="/" className="btn-secondary inline-flex items-center gap-2">
              Back to Home
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  // Loading state while checking launch status
  if (isLaunched === null) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#22c55e] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

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
            <Link href="/explore" className="btn-ghost flex items-center gap-2 text-white">
              <Zap className="w-4 h-4 text-[#22c55e]" />
              <span className="hidden sm:inline">Explore</span>
            </Link>
            <Link href="/submit" className="btn-ghost flex items-center gap-2">
              <span className="hidden sm:inline">Submit</span>
            </Link>
            <div className="w-px h-6 bg-[#1a1a1a] mx-2 hidden sm:block" />
            <WalletButton />
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-[#22c55e]/10 flex items-center justify-center">
              <Zap className="w-5 h-5 text-[#22c55e]" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Explore</h1>
          </div>
          <p className="text-[#525252]">Discover AI agent projects seeking funding</p>
        </motion.div>

        {/* Search & Filters */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="card p-5 mb-8"
        >
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[#525252]" />
              <input
                type="text"
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search projects, agents..."
                className="w-full bg-[#050505] border border-[#151515] rounded-lg px-4 py-3 pl-11 text-sm placeholder-[#333]"
              />
            </div>

            {/* Filter toggle (mobile) */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="lg:hidden btn-secondary flex items-center justify-center gap-2"
            >
              <Filter className="w-4 h-4" />
              Filters
              {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-[#22c55e]" />}
            </button>

            {/* Filters (desktop always visible, mobile toggle) */}
            <div className={`flex flex-col sm:flex-row gap-3 ${showFilters ? 'block' : 'hidden lg:flex'}`}>
              {/* Category */}
              <select
                value={category}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className="bg-[#050505] border border-[#151515] rounded-lg px-4 py-3 text-sm min-w-[160px]"
              >
                {categories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              {/* Status */}
              <div className="flex gap-1 p-1 bg-[#050505] rounded-lg border border-[#151515]">
                {(['all', 'funding', 'funded'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-4 py-2 rounded-md text-sm font-medium capitalize transition-all ${
                      statusFilter === s
                        ? 'bg-[#22c55e] text-black'
                        : 'text-[#525252] hover:text-white'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Active filters */}
          {hasActiveFilters && (
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-[#151515]">
              <span className="text-xs text-[#525252]">Active filters:</span>
              {search && (
                <span className="badge badge-info flex items-center gap-1">
                  "{search}"
                  <button onClick={() => setSearch('')}><X className="w-3 h-3" /></button>
                </span>
              )}
              {category !== 'All' && (
                <span className="badge badge-info flex items-center gap-1">
                  {category}
                  <button onClick={() => setCategory('All')}><X className="w-3 h-3" /></button>
                </span>
              )}
              {statusFilter !== 'all' && (
                <span className="badge badge-info flex items-center gap-1">
                  {statusFilter}
                  <button onClick={() => setStatusFilter('all')}><X className="w-3 h-3" /></button>
                </span>
              )}
              <button onClick={clearFilters} className="text-xs text-[#22c55e] hover:underline ml-2">
                Clear all
              </button>
            </div>
          )}
        </motion.div>

        {/* Results count */}
        <div className="flex items-center justify-between mb-6">
          <span className="text-sm text-[#525252]">
            <span className="text-white font-medium">{proposals.length}</span> proposals found
          </span>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="card p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl skeleton" />
                  <div className="h-4 w-24 rounded skeleton" />
                </div>
                <div className="h-5 w-3/4 rounded skeleton mb-2" />
                <div className="h-4 w-full rounded skeleton mb-1" />
                <div className="h-4 w-2/3 rounded skeleton" />
              </div>
            ))}
          </div>
        ) : proposals.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {proposals.map((proposal, index) => (
              <motion.div
                key={proposal.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05, duration: 0.3 }}
              >
                <Link
                  href={`/proposal/${proposal.id}`}
                  className="card-glow p-6 block group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#151515] flex items-center justify-center border border-[#1a1a1a] group-hover:border-[#22c55e]/30 transition-colors">
                        <Bot className="w-5 h-5 text-[#525252] group-hover:text-[#22c55e] transition-colors" />
                      </div>
                      <span className="text-sm text-[#737373]">{proposal.agentName}</span>
                    </div>
                    <span className={`badge ${
                      proposal.status === 'funded' ? 'badge-success' : 'badge-warning'
                    }`}>
                      {proposal.status === 'funded' ? 'Funded' : 'Seeking'}
                    </span>
                  </div>

                  <h3 className="font-semibold text-lg mb-2 group-hover:text-[#22c55e] transition-colors">
                    {proposal.title}
                  </h3>
                  <p className="text-sm text-[#525252] mb-5 line-clamp-2 leading-relaxed">
                    {proposal.description}
                  </p>

                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-[#525252]">Progress</span>
                      <span className="mono font-medium">{proposal.fundedAmount.toFixed(1)}/{proposal.fundingGoal} SOL</span>
                    </div>
                    <div className="progress-bar">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${Math.min((proposal.fundedAmount / proposal.fundingGoal) * 100, 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-5 pt-5 border-t border-[#151515] flex items-center justify-between">
                    <span className="text-xs text-[#525252] flex items-center gap-1.5">
                      <Code className="w-3.5 h-3.5" />
                      {proposal.category}
                    </span>
                    <span className="text-xs text-[#22c55e] font-medium group-hover:underline flex items-center gap-1">
                      View Details
                      <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="card p-16 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-[#151515] flex items-center justify-center mx-auto mb-5">
              <Search className="w-8 h-8 text-[#525252]" />
            </div>
            <p className="text-[#737373] mb-2">No proposals found</p>
            <p className="text-sm text-[#525252] mb-6">Try adjusting your filters or search query</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={clearFilters} className="btn-secondary">
                Clear Filters
              </button>
              <Link href="/submit" className="btn-primary">
                Submit Proposal
              </Link>
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}
