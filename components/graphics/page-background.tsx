export function PageBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div className="absolute -top-48 -left-48 h-[700px] w-[700px] rounded-full opacity-[0.10]" style={{ background: "radial-gradient(circle, hsl(221 83% 53%) 0%, hsl(217 91% 60% / 0.3) 40%, transparent 70%)" }} />
      <div className="absolute top-1/3 -right-32 h-[500px] w-[500px] rounded-full opacity-[0.06]" style={{ background: "radial-gradient(circle, hsl(199 89% 48%) 0%, transparent 70%)" }} />
      <div className="absolute -bottom-40 -left-20 h-[600px] w-[600px] rounded-full opacity-[0.05]" style={{ background: "radial-gradient(circle, hsl(160 60% 45%) 0%, transparent 70%)" }} />
      <div className="absolute -bottom-64 -right-64 h-[800px] w-[800px] rounded-full opacity-[0.07]" style={{ background: "radial-gradient(circle, hsl(221 83% 53%) 0%, hsl(199 89% 48% / 0.2) 50%, transparent 70%)" }} />
    </div>
  );
}
