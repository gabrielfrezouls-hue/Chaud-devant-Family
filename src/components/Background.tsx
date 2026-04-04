import React, { useEffect, useState } from 'react';
import { Star } from '../types';

const Background: React.FC<{ color?: string }> = ({ color = '#a85c48' }) => {
  const [stars, setStars] = useState<Star[]>([]);

  useEffect(() => {
    const generatedStars = Array.from({ length: 50 }).map((_, i) => ({
      id: i,
      top: `${Math.random() * 100}%`,
      left: `${Math.random() * 100}%`,
      size: `${1 + Math.random() * 2}px`,
      duration: `${5 + Math.random() * 10}s`,
    }));
    setStars(generatedStars);
  }, []);

  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      {stars.map((star) => (
        <div
          key={star.id}
          className="star"
          style={{
            top: star.top,
            left: star.left,
            width: star.size,
            height: star.size,
            backgroundColor: color,
            position: 'absolute',
            borderRadius: '50%',
            opacity: 0.15,
            animation: `twinkle ${star.duration} infinite ease-in-out`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
};

export default Background;
