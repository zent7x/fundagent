'use client';

import Link from "next/link";
import { motion } from "framer-motion";
import { Shield, ArrowLeft, Eye, Database, Lock } from "lucide-react";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-xl border-b border-[#111]">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#22c55e] flex items-center justify-center">
              <span className="text-black font-bold text-sm">FA</span>
            </div>
            <span className="font-semibold text-lg tracking-tight">FundAgent</span>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 pt-28 pb-20">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-[#525252] hover:text-white mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-[#22c55e]/10 flex items-center justify-center">
              <Shield className="w-6 h-6 text-[#22c55e]" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Privacy Policy</h1>
              <p className="text-sm text-[#525252]">Last updated: February 2025</p>
            </div>
          </div>

          <div className="card p-8 space-y-8">

            <section>
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Eye className="w-5 h-5 text-[#22c55e]" />
                Information We Collect
              </h2>
              <p className="text-[#a3a3a3] leading-relaxed mb-4">We collect the following information:</p>
              <ul className="list-disc list-inside text-[#a3a3a3] space-y-2 ml-4">
                <li><strong className="text-white">Wallet Addresses:</strong> Public Solana wallet addresses used to interact with the platform</li>
                <li><strong className="text-white">Transaction Data:</strong> All funding transactions including signatures, amounts, and timestamps</li>
                <li><strong className="text-white">Proposal Content:</strong> Titles, descriptions, and other content submitted to the platform</li>
                <li><strong className="text-white">Usage Data:</strong> Page views, clicks, and platform interactions</li>
                <li><strong className="text-white">Device Information:</strong> Browser type, operating system, and device identifiers</li>
                <li><strong className="text-white">IP Addresses:</strong> For security, rate limiting, and fraud prevention</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Database className="w-5 h-5 text-[#22c55e]" />
                How We Use Information
              </h2>
              <ul className="list-disc list-inside text-[#a3a3a3] space-y-2 ml-4">
                <li>To operate and improve the platform</li>
                <li>To verify and log transactions</li>
                <li>To prevent fraud and abuse</li>
                <li>To communicate with users about their proposals</li>
                <li>To comply with legal obligations</li>
                <li>To analyze platform usage and performance</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Lock className="w-5 h-5 text-[#22c55e]" />
                Data Security
              </h2>
              <p className="text-[#a3a3a3] leading-relaxed">
                We implement security measures to protect your information, including encryption for sensitive data, rate limiting to prevent abuse, and secure authentication using wallet signatures. However, no system is completely secure, and we cannot guarantee absolute security.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-4">Blockchain Data</h2>
              <p className="text-[#a3a3a3] leading-relaxed">
                All transactions on the Solana blockchain are public and permanent. Wallet addresses and transaction amounts are visible to anyone. We have no control over blockchain data once transactions are confirmed.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-4">Data Retention</h2>
              <p className="text-[#a3a3a3] leading-relaxed">
                We retain transaction logs and proposal data indefinitely for legal compliance and dispute resolution. Usage logs may be retained for up to 2 years. You may request deletion of your proposal content, but transaction records will be maintained.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-4">Third-Party Services</h2>
              <p className="text-[#a3a3a3] leading-relaxed">
                We use third-party services including Solana RPC providers (Helius) for blockchain interactions. These services have their own privacy policies.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-4">Your Rights</h2>
              <p className="text-[#a3a3a3] leading-relaxed mb-4">You have the right to:</p>
              <ul className="list-disc list-inside text-[#a3a3a3] space-y-2 ml-4">
                <li>Request access to your personal data</li>
                <li>Request correction of inaccurate data</li>
                <li>Request deletion of your data (subject to legal retention requirements)</li>
                <li>Object to certain processing of your data</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-4">Contact</h2>
              <p className="text-[#a3a3a3] leading-relaxed mb-4">
                For privacy-related inquiries, please contact us through our official channels:
              </p>
              <div className="flex flex-col gap-2 ml-4">
                <a href="https://x.com/zent7x" target="_blank" rel="noopener noreferrer" className="text-[#22c55e] hover:underline">
                  Twitter/X: @zent7x
                </a>
                <span className="text-[#a3a3a3]">Website: fundagent.io</span>
              </div>
            </section>

          </div>
        </motion.div>
      </main>
    </div>
  );
}
