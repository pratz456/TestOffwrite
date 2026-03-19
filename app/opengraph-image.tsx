import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "WriteOff - AI Tax Deduction Tracker for Freelancers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image() {
  // Logo (optional)
  let logoSrc: string | undefined;
  try {
    const logoPath = join(process.cwd(), "public", "writeofflogo.png");
    const logoData = await readFile(logoPath, "base64");
    logoSrc = `data:image/png;base64,${logoData}`;
  } catch {
    // omit
  }

  // Load a font so Satori has at least one (required for layout). Prefer local, else fetch from CDN.
  let interRegular: ArrayBuffer | undefined;
  let interSemibold: ArrayBuffer | undefined;
  try {
    const regBuf = await readFile(
      join(process.cwd(), "public", "fonts", "Inter-Regular.ttf")
    );
    interRegular = regBuf.buffer.slice(regBuf.byteOffset, regBuf.byteOffset + regBuf.byteLength) as ArrayBuffer;
    const semiBuf = await readFile(
      join(process.cwd(), "public", "fonts", "Inter-SemiBold.ttf")
    );
    interSemibold = semiBuf.buffer.slice(semiBuf.byteOffset, semiBuf.byteOffset + semiBuf.byteLength) as ArrayBuffer;
  } catch {
    // no local fonts
  }
  if (!interRegular) {
    try {
      const res = await fetch(
        "https://cdn.jsdelivr.net/npm/inter-font@3.19.0/ttf/Inter-Regular.ttf"
      );
      if (res.ok) interRegular = await res.arrayBuffer();
    } catch {
      // ignore
    }
  }
  // Satori requires at least one font
  if (!interRegular) throw new Error("OG image: could not load a font (add public/fonts/Inter-Regular.ttf or check network)");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #060B17 0%, #0B1633 45%, #071427 100%)",
          fontFamily: "Inter, system-ui, sans-serif",
          overflow: "hidden",
        }}
      >
        {/* Subtle grid (fintech vibe) */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            opacity: 0.22,
          }}
        />

        {/* Soft glows */}
        <div
          style={{
            position: "absolute",
            left: -120,
            top: -140,
            width: 520,
            height: 520,
            background: "radial-gradient(circle, rgba(59,130,246,0.40) 0%, rgba(59,130,246,0) 70%)",
            filter: "blur(6px)",
            opacity: 0.9,
          }}
        />
        <div
          style={{
            position: "absolute",
            right: -160,
            bottom: -220,
            width: 620,
            height: 620,
            background: "radial-gradient(circle, rgba(34,197,94,0.28) 0%, rgba(34,197,94,0) 70%)",
            filter: "blur(10px)",
            opacity: 0.8,
          }}
        />

        {/* Decorative chart line */}
        <div
          style={{
            position: "absolute",
            left: 70,
            bottom: 88,
            width: 520,
            height: 2,
            background: "linear-gradient(90deg, rgba(56,189,248,0) 0%, rgba(56,189,248,0.85) 45%, rgba(34,197,94,0.85) 100%)",
            opacity: 0.7,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 70,
            bottom: 88,
            width: 520,
            height: 120,
            background:
              "linear-gradient(180deg, rgba(56,189,248,0.16) 0%, rgba(56,189,248,0) 100%)",
            transform: "skewX(-12deg)",
            opacity: 0.55,
          }}
        />

        {/* Main glass card */}
        <div
          style={{
            width: 1040,
            height: 480,
            borderRadius: 28,
            border: "1px solid rgba(255,255,255,0.14)",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.06) 100%)",
            boxShadow:
              "0 24px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.10)",
            position: "relative",
            padding: "34px 44px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          {/* Top row: brand */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {logoSrc ? (
                <img
                  src={logoSrc}
                  alt=""
                  width={40}
                  height={40}
                  style={{ borderRadius: 10 }}
                />
              ) : (
                <div
                  style={{
                    display: "flex",
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: "rgba(255,255,255,0.12)",
                    border: "1px solid rgba(255,255,255,0.18)",
                  }}
                />
              )}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: "rgba(255,255,255,0.92)",
                    letterSpacing: "-0.02em",
                  }}
                >
                  WriteOff
                </span>
                <span
                  style={{
                    fontSize: 14,
                    color: "rgba(255,255,255,0.62)",
                    letterSpacing: "0.01em",
                  }}
                >
                  AI deductions • Auto-categorization • Export-ready
                </span>
              </div>
            </div>
          </div>

          {/* Headline */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 18 }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "baseline",
                fontSize: 56,
                fontWeight: 800,
                lineHeight: 1.08,
                color: "rgba(255,255,255,0.96)",
                letterSpacing: "-0.03em",
              }}
            >
              Stop overpaying taxes.
              <span style={{ paddingLeft: 12 }}>
                <span
                  style={{
                    background: "linear-gradient(90deg, #60A5FA 0%, #38BDF8 40%, #34D399 100%)",
                    backgroundClip: "text",
                    color: "transparent",
                    WebkitBackgroundClip: "text",
                  }}
                >
                  WriteOff
                </span>
              </span>{" "}
              finds every deduction.
            </div>

            <div
              style={{
                display: "flex",
                fontSize: 22,
                lineHeight: 1.35,
                color: "rgba(255,255,255,0.72)",
                maxWidth: 860,
              }}
            >
              Connect your accounts and let AI detect deductible expenses, categorize transactions,
              and generate clean, exportable reports for tax time.
            </div>

            {/* Feature chips */}
            <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
              {["Auto-categorize", "Deduction detection", "CPA-ready exports"].map((t) => (
                <div
                  key={t}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.06)",
                    color: "rgba(255,255,255,0.84)",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: "rgba(52,211,153,0.9)",
                      display: "flex",
                    }}
                  />
                  {t}
                </div>
              ))}
            </div>
          </div>

          {/* Bottom row: CTA + pricing */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              marginTop: 18,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(34,197,94,0.28)",
                  background: "rgba(34,197,94,0.10)",
                  color: "rgba(255,255,255,0.92)",
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                Start your <span style={{ color: "#34D399" }}>30-day free trial</span>
                <span style={{ color: "rgba(255,255,255,0.70)", fontWeight: 600 }}>
                  - no card
                </span>
              </div>
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.58)" }}>
                Then $14.99/mo or $150/yr • Cancel anytime
              </div>
            </div>

            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.55)" }}>
              writeoffapp.com
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
      { name: "Inter", data: interRegular!, weight: 400 as const, style: "normal" as const },
      ...(interSemibold ? [{ name: "Inter", data: interSemibold, weight: 600 as const, style: "normal" as const }] : []),
    ],
    }
  );
}