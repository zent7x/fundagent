'use client';

import { useState, useEffect, useCallback, memo, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Send, Lock, AlertCircle, Loader2 } from 'lucide-react';
import { encryptMessage, decryptMessage } from '@/lib/crypto';
import { useSignedRequest } from '@/hooks/useSignedRequest';

interface Message {
  id: string;
  content: string;
  isEncrypted: boolean;
  createdAt: string;
  sender: {
    walletAddress: string;
  };
}

interface MessagePanelProps {
  proposalId: string;
  agentWallet: string;
}

// Memoized message item
const MessageItem = memo(({
  message,
  isOwnMessage,
  decryptedContent
}: {
  message: Message;
  isOwnMessage: boolean;
  decryptedContent: string;
}) => {
  const shortAddress = `${message.sender.walletAddress.slice(0, 4)}...${message.sender.walletAddress.slice(-4)}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
    >
      <div className={`max-w-[80%] ${isOwnMessage ? 'bg-[#22c55e]/20' : 'bg-[#1a1a1a]'} rounded-lg p-3`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs mono text-[#525252]">{shortAddress}</span>
          {message.isEncrypted && <Lock className="w-3 h-3 text-[#22c55e]" />}
        </div>
        <p className="text-sm break-words">{decryptedContent}</p>
        <span className="text-xs text-[#333] mt-1 block">
          {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </motion.div>
  );
});
MessageItem.displayName = 'MessageItem';

export const MessagePanel = memo(function MessagePanel({ proposalId, agentWallet }: MessagePanelProps) {
  const { publicKey, connected } = useWallet();
  const { generateAuth, canSign } = useSignedRequest();
  const [messages, setMessages] = useState<Message[]>([]);
  const [decryptedMessages, setDecryptedMessages] = useState<Map<string, string>>(new Map());
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sessionAuth, setSessionAuth] = useState<{
    walletAddress: string;
    signature: string;
    message: string;
    timestamp: number;
    nonce: string;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const walletAddress = publicKey?.toBase58();

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/messages?proposalId=${proposalId}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (err) {
      console.error('Error fetching messages:', err);
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  // Decrypt messages when they change
  useEffect(() => {
    async function decryptAll() {
      if (!walletAddress || messages.length === 0) return;

      const decrypted = new Map<string, string>();

      for (const msg of messages) {
        if (msg.isEncrypted) {
          try {
            const plaintext = await decryptMessage(msg.content, walletAddress, agentWallet);
            decrypted.set(msg.id, plaintext);
          } catch {
            decrypted.set(msg.id, '[Unable to decrypt]');
          }
        } else {
          decrypted.set(msg.id, msg.content);
        }
      }

      setDecryptedMessages(decrypted);
    }

    decryptAll();
  }, [messages, walletAddress, agentWallet]);

  // Initial fetch and polling
  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 10000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // Clear session auth when wallet changes
  useEffect(() => {
    setSessionAuth(null);
  }, [walletAddress]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!connected || !publicKey || !newMessage.trim() || !canSign) return;

    setSending(true);
    setError('');

    try {
      // Get or create session auth (sign once, reuse for 5 minutes)
      let auth = sessionAuth;
      const now = Date.now();
      const FIVE_MINUTES = 5 * 60 * 1000;

      if (!auth || (now - auth.timestamp) > FIVE_MINUTES) {
        // Need to sign - this will prompt wallet once
        auth = await generateAuth('chat_session');
        setSessionAuth(auth);
      }

      // Encrypt the message
      const encrypted = await encryptMessage(newMessage.trim(), walletAddress!, agentWallet);

      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth,
          proposalId,
          content: encrypted,
          isEncrypted: true,
          adminContent: newMessage.trim(),
        }),
      });

      if (res.ok) {
        setNewMessage('');
        fetchMessages();
      } else {
        const data = await res.json();
        // If auth expired, clear it so next send will re-sign
        if (res.status === 401) {
          setSessionAuth(null);
        }
        setError(data.error || 'Failed to send message');
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('rejected')) {
        setError('Signature request was cancelled');
      } else {
        setError('Failed to send message');
      }
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-[#1a1a1a] flex items-center justify-between">
        <h4 className="font-medium flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[#22c55e]" />
          Messages
        </h4>
        <span className="text-xs text-[#22c55e] flex items-center gap-1">
          <Lock className="w-3 h-3" />
          E2E Encrypted
        </span>
      </div>

      <div className="h-64 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 animate-spin text-[#525252]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-[#525252] text-sm h-full flex items-center justify-center">
            No messages yet. Start a conversation!
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {messages.map((msg) => (
              <MessageItem
                key={msg.id}
                message={msg}
                isOwnMessage={msg.sender.walletAddress === walletAddress}
                decryptedContent={decryptedMessages.get(msg.id) || 'Decrypting...'}
              />
            ))}
          </AnimatePresence>
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/30">
          <p className="text-xs text-red-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {error}
          </p>
        </div>
      )}

      {connected && canSign ? (
        <div className="p-3 border-t border-[#1a1a1a]">
          <div className="flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type a message..."
              disabled={sending}
              className="flex-1 bg-[#0a0a0a] border border-[#1a1a1a] rounded px-3 py-2 text-sm text-white placeholder-[#333] focus:border-[#22c55e] focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={sending || !newMessage.trim()}
              className="btn-primary px-3 disabled:opacity-50"
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3 border-t border-[#1a1a1a] text-center">
          <p className="text-xs text-[#525252]">Connect wallet to send messages</p>
        </div>
      )}
    </div>
  );
});
