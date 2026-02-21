import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrueClaim — Professional Insurance Claims Intelligence",
  description: "Enterprise-grade medical billing audit system that analyzes clinical notes and claims to detect upcoding, ghost services, and billing anomalies.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <nav className="navbar">
          <a href="/" className="navbar-brand">
            <div className="navbar-logo">TC</div>
            <div className="navbar-title">True<span>Claim</span></div>
          </a>
          {/* Removed demo links */}
        </nav>
        {children}
      </body>
    </html>
  );
}
