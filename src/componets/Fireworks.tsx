
import React, { useEffect, useRef } from 'react';

const Fireworks: React.FC<{ active: boolean }> = ({ active }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Defined before usage to ensure type and value availability
    class Particle {
      x: number;
      y: number;
      color: string;
      velocity: { x: number; y: number };
      alpha: number;

      constructor(x: number, y: number, color: string, velocity: { x: number; y: number }) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.velocity = velocity;
        this.alpha = 1;
      }

      draw() {
        if (!ctx) return;
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 2, 0, Math.PI * 2, false);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.restore();
      }

      update() {
        this.velocity.y += 0.05; // gravity
        this.x += this.velocity.x;
        this.y += this.velocity.y;
        this.alpha -= 0.01;
      }
    }

    let particles: Particle[] = [];

    const createFirework = (x: number, y: number) => {
      const colors = ['#fde047', '#fbbf24', '#f59e0b', '#ffffff', '#ef4444', '#3b82f6'];
      const color = colors[Math.floor(Math.random() * colors.length)];
      for (let i = 0; i < 40; i++) {
        const angle = (Math.PI * 2 * i) / 40;
        const speed = Math.random() * 5 + 2;
        particles.push(new Particle(x, y, color, {
          x: Math.cos(angle) * speed,
          y: Math.sin(angle) * speed
        }));
      }
    };

    const animate = () => {
      if (!active) return;
      requestAnimationFrame(animate);
      ctx.fillStyle = 'rgba(2, 6, 23, 0.1)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      particles.forEach((particle, index) => {
        if (particle.alpha <= 0) {
          particles.splice(index, 1);
        } else {
          particle.update();
          particle.draw();
        }
      });

      if (Math.random() < 0.05) {
        createFirework(Math.random() * canvas.width, Math.random() * (canvas.height * 0.5));
      }
    };

    animate();

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      className={`fixed inset-0 z-10 transition-opacity duration-1000 ${active ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    />
  );
};

export default Fireworks;
