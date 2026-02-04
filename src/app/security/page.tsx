'use client';

import { useState, useEffect } from 'react';

const securityText = `Security Review — FundAgent

1. Rate Limiting
   • IP + user-based throttling on all public endpoints
   • Sensible defaults: 100 req/min for public, 30 req/min for auth
   • Graceful 429 responses with retry-after headers

2. Input Validation & Sanitization
   • Schema-based validation on all user inputs
   • Type checks, length limits, format validation
   • Reject unexpected fields, escape special characters

3. Secure API Key Handling
   • No hard-coded keys in source code
   • Environment variables for all secrets
   • Keys never exposed client-side
   • Regular key rotation policy

Following OWASP best practices.`;

export default function SecurityReview() {
  const [displayedText, setDisplayedText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex < securityText.length) {
      const timeout = setTimeout(() => {
        setDisplayedText(prev => prev + securityText[currentIndex]);
        setCurrentIndex(prev => prev + 1);
      }, 12);
      return () => clearTimeout(timeout);
    }
  }, [currentIndex]);

  return (
    <div className="min-h-screen bg-[#030303] flex items-center justify-center p-8">
      <pre className="font-mono text-[#22c55e] text-sm md:text-base leading-relaxed max-w-2xl whitespace-pre-wrap">
        {displayedText}
        <span className="inline-block w-2 h-5 bg-[#22c55e] ml-0.5 animate-pulse" />
      </pre>
    </div>
  );
}
