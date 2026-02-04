'use client';

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Bot,
  Lightbulb,
  ArrowRight,
  ArrowLeft,
  Loader2,
  CheckCircle,
  Sparkles,
  Copy,
  Check,
  MessageSquare,
} from "lucide-react";

const categories = [
  { value: 'Developer Tools', label: 'Developer Tools', desc: 'Code, productivity, dev workflow' },
  { value: 'DeFi', label: 'DeFi', desc: 'Decentralized finance' },
  { value: 'Marketing', label: 'Marketing', desc: 'Growth, content, social' },
  { value: 'Consumer', label: 'Consumer', desc: 'End-user applications' },
  { value: 'Infrastructure', label: 'Infrastructure', desc: 'Backend, APIs, protocols' },
  { value: 'AI/ML', label: 'AI/ML', desc: 'AI/ML tools and applications' },
  { value: 'Other', label: 'Other', desc: 'Everything else' },
];

const aiPrompt = `I want to submit an idea to FundAgent (a platform where AI ideas get funded). Help me fill out this form:

1. **Title**: A clear, specific name for the idea (e.g., "AI-Powered Code Review Bot")
2. **Description**: 2-3 sentences explaining what it does and why it's valuable
3. **Category**: Developer Tools, DeFi, Marketing, Consumer, Infrastructure, AI/ML, or Other
4. **Contact**: How sponsors can reach us (twitter:@handle, email:you@example.com, or discord:username)

Give me a good idea that solves a real problem. Be specific, not vague.`;

export default function SubmitIdeaPage() {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [ideaUrl, setIdeaUrl] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'Developer Tools',
    contactMethod: '',
  });

  const copyPrompt = () => {
    navigator.clipboard.writeText(aiPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/ideas/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.details?.join(', ') || data.error || 'Failed to submit');
        return;
      }

      setSuccess(true);
      setIdeaUrl(data.idea.url);
    } catch (err) {
      setError('Failed to submit idea');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full text-center"
        >
          <div className="w-20 h-20 rounded-2xl bg-[#22c55e]/10 flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-[#22c55e]" />
          </div>
          <h1 className="text-3xl font-bold mb-4">Idea Submitted!</h1>
          <p className="text-[#737373] mb-8">
            Your idea is now live. Humans can discover and sponsor it.
          </p>

          <div className="card p-4 mb-8 text-left">
            <p className="text-sm text-[#525252] mb-2">Share this link:</p>
            <code className="text-sm text-[#22c55e] break-all">{ideaUrl}</code>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/ideas" className="btn-primary">
              Browse All Ideas
            </Link>
            <button
              onClick={() => {
                setSuccess(false);
                setForm({ title: '', description: '', category: 'Developer Tools', contactMethod: '' });
              }}
              className="btn-secondary"
            >
              Submit Another
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-xl border-b border-[#111]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#22c55e] flex items-center justify-center">
              <span className="text-black font-bold text-sm">FA</span>
            </div>
            <span className="font-semibold text-lg tracking-tight">FundAgent</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/ideas" className="text-sm text-[#737373] hover:text-white transition-colors">
              Browse Ideas
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 pt-28 pb-20">
        {/* Back link */}
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-[#525252] hover:text-white mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        <div className="grid lg:grid-cols-2 gap-12">
          {/* Left: AI Helper */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#22c55e]/20 to-[#22c55e]/5 flex items-center justify-center border border-[#22c55e]/20">
                <Bot className="w-5 h-5 text-[#22c55e]" />
              </div>
              <div>
                <h2 className="font-semibold">Step 1: Ask Your AI</h2>
                <p className="text-sm text-[#525252]">Copy this prompt, paste it into Claude/GPT</p>
              </div>
            </div>

            <div className="card p-5 relative group">
              <div className="absolute -inset-px bg-gradient-to-r from-[#22c55e]/20 to-transparent rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <pre className="text-sm text-[#a3a3a3] whitespace-pre-wrap font-mono leading-relaxed">
                  {aiPrompt}
                </pre>
                <button
                  onClick={copyPrompt}
                  className="absolute top-0 right-0 p-2 rounded-lg bg-[#111] hover:bg-[#1a1a1a] border border-[#222] transition-colors"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-[#22c55e]" />
                  ) : (
                    <Copy className="w-4 h-4 text-[#525252]" />
                  )}
                </button>
              </div>
            </div>

            <div className="mt-6 p-4 rounded-xl bg-[#0a0a0a] border border-[#151515]">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-[#22c55e] mt-0.5" />
                <div>
                  <p className="text-sm text-[#a3a3a3]">
                    <strong className="text-white">Pro tip:</strong> Ask your AI for multiple ideas and pick the best one.
                    The more specific the idea, the more likely it gets sponsored.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right: Form */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-500/5 flex items-center justify-center border border-blue-500/20">
                <Lightbulb className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="font-semibold">Step 2: Submit the Idea</h2>
                <p className="text-sm text-[#525252]">Paste what your AI gave you</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="card p-6 space-y-5">
              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-2">Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="AI-Powered Code Review Bot"
                  className="w-full bg-[#050505] border border-[#1a1a1a] rounded-lg px-4 py-3 text-sm placeholder-[#333] focus:border-[#22c55e]/50 focus:outline-none transition-colors"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="A tool that reviews pull requests automatically, catches bugs before they ship, and suggests improvements based on best practices."
                  className="w-full bg-[#050505] border border-[#1a1a1a] rounded-lg px-4 py-3 text-sm placeholder-[#333] focus:border-[#22c55e]/50 focus:outline-none transition-colors resize-none"
                  rows={4}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full bg-[#050505] border border-[#1a1a1a] rounded-lg px-4 py-3 text-sm focus:border-[#22c55e]/50 focus:outline-none transition-colors"
                >
                  {categories.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label} - {cat.desc}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Contact Method</label>
                <input
                  type="text"
                  value={form.contactMethod}
                  onChange={(e) => setForm({ ...form, contactMethod: e.target.value })}
                  placeholder="twitter:@yourhandle or email:you@example.com"
                  className="w-full bg-[#050505] border border-[#1a1a1a] rounded-lg px-4 py-3 text-sm placeholder-[#333] focus:border-[#22c55e]/50 focus:outline-none transition-colors"
                  required
                />
                <p className="text-xs text-[#525252] mt-1">How sponsors will reach you</p>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full btn-primary py-4 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    Submit Idea
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>

              <p className="text-xs text-[#525252] text-center">
                Ideas are public. Sponsors can fund and build them.
              </p>
            </form>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
