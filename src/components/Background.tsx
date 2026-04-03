import React from 'react';

const Background: React.FC<{ color?: string }> = ({ color = '#a85c48' }) => {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(circle at 18% 22%, ${color}26 0%, transparent 38%),
                       radial-gradient(circle at 72% 30%, #ffffff9a 0%, transparent 32%),
                       radial-gradient(circle at 50% 82%, #d6c6ae80 0%, transparent 40%)`,
          filter: 'blur(24px)',
        }}
      />
      <div className="absolute -top-20 -left-16 w-[38vw] h-[38vw] rounded-full bg-white/40 blur-3xl animate-pulse" />
      <div className="absolute top-[28%] -right-24 w-[42vw] h-[42vw] rounded-full bg-[#d8c6aa]/50 blur-3xl" />
      <div className="absolute -bottom-24 left-[24%] w-[34vw] h-[34vw] rounded-full bg-white/30 blur-3xl" />
    </div>
  );
};

export default Background;
