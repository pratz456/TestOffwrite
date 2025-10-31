'use client';
import * as React from 'react';

export function Progress({ value = 0, className = '' }: { value?: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={`h-2 w-full rounded bg-gray-200 overflow-hidden ${className}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div 
        className="h-full w-full origin-left scale-x-0 bg-blue-600"
        style={{ 
          transform: `scaleX(${pct/100})`, 
          transition: 'transform 200ms linear' 
        }} 
      />
    </div>
  );
}
