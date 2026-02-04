'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useEffect, useState } from 'react';
import { Wallet, LogOut, Loader2, Copy, Check, ExternalLink } from 'lucide-react';

export function WalletButton() {
  const { publicKey, disconnect, connected, connecting, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const copyAddress = () => {
    if (publicKey) {
      navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!mounted) {
    return (
      <button className="btn-primary text-sm flex items-center gap-2 opacity-50" disabled>
        <Wallet className="w-4 h-4" />
        Connect
      </button>
    );
  }

  if (connecting) {
    return (
      <button className="btn-primary text-sm flex items-center gap-2 opacity-50" disabled>
        <Loader2 className="w-4 h-4 animate-spin" />
        Connecting...
      </button>
    );
  }

  if (connected && publicKey) {
    const address = publicKey.toBase58();
    const shortAddress = `${address.slice(0, 4)}...${address.slice(-4)}`;

    return (
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-2 px-3 py-2 bg-[#111] border border-[#1a1a1a] rounded hover:border-[#22c55e]/50 transition-colors"
        >
          {wallet?.adapter.icon && (
            <img src={wallet.adapter.icon} alt="" className="w-4 h-4" />
          )}
          <span className="text-sm mono text-[#22c55e]">{shortAddress}</span>
        </button>

        {showDropdown && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowDropdown(false)}
            />
            <div className="absolute right-0 top-full mt-2 w-48 bg-[#111] border border-[#1a1a1a] rounded-lg shadow-xl z-50 overflow-hidden">
              <div className="p-3 border-b border-[#1a1a1a]">
                <p className="text-xs text-[#525252] mb-1">Connected Wallet</p>
                <p className="text-sm mono text-white truncate">{shortAddress}</p>
              </div>

              <button
                onClick={copyAddress}
                className="w-full px-3 py-2 text-left text-sm text-[#737373] hover:bg-[#1a1a1a] hover:text-white flex items-center gap-2 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-[#22c55e]" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copy Address
                  </>
                )}
              </button>

              <a
                href={`https://explorer.solana.com/address/${address}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full px-3 py-2 text-left text-sm text-[#737373] hover:bg-[#1a1a1a] hover:text-white flex items-center gap-2 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                View on Explorer
              </a>

              <button
                onClick={() => {
                  disconnect();
                  setShowDropdown(false);
                }}
                className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-[#1a1a1a] flex items-center gap-2 transition-colors border-t border-[#1a1a1a]"
              >
                <LogOut className="w-4 h-4" />
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => setVisible(true)}
      className="btn-primary text-sm flex items-center gap-2"
    >
      <Wallet className="w-4 h-4" />
      Connect Wallet
    </button>
  );
}
