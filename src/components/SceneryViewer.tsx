import React, { useMemo } from 'react';

interface SceneryViewerProps {
  sceneries: string[];
}

export function SceneryViewer({ sceneries }: SceneryViewerProps) {
  // Generate random particles for the magical dust/firefly effect
  const particles = useMemo(() => Array.from({length: 40}).map((_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 100}%`,
    size: Math.random() * 3 + 1 + 'px',
    duration: Math.random() * 15 + 15 + 's', // 15 to 30s
    delay: Math.random() * -30 + 's'         // start at different points
  })), []);

  return (
    <div className="flex-1 h-full relative overflow-hidden bg-black">
      {sceneries.map((src, index) => {
        // Find the active (top) image and the one just before it (to crossfade from)
        const isActive = index === sceneries.length - 1;
        const isPrevious = index === sceneries.length - 2;
        
        // For performance, only mount/render the top two images
        if (!isActive && !isPrevious && sceneries.length > 1) return null;

        return (
          <img 
            key={index} 
            src={src} 
            alt={`Scenery ${index + 1}`} 
            className={`absolute inset-0 w-full h-full object-cover animate-kenburns ${
              isActive ? 'opacity-100 mix-blend-normal' : 'opacity-0 mix-blend-overlay'
            }`}
            style={{ 
              transition: 'opacity 10s ease-in-out',
              zIndex: isActive ? 10 : 5 
            }}
            referrerPolicy="no-referrer"
          />
        );
      })}

      {sceneries.length === 0 && (
        <div className="absolute inset-0 z-20 flex items-center justify-center w-full h-full text-white/50 font-serif text-2xl drop-shadow-md">
          Waking up the game world...
        </div>
      )}

      {/* Magical Particles Overlay / Surprise Feature */}
      <div className="absolute inset-0 pointer-events-none mix-blend-screen z-30">
        {particles.map(p => (
           <div 
             key={p.id} 
             className="particle shadow-[0_0_8px_2px_rgba(255,230,180,0.6)]" 
             style={{
               left: p.left, top: p.top, width: p.size, height: p.size, 
               animationDuration: p.duration, animationDelay: p.delay
             }} 
           />
        ))}
      </div>

      {/* Cinematic Vignette overlay */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,_transparent_40%,_rgba(0,0,0,0.5))] z-40" />
    </div>
  );
}
