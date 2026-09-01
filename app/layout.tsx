import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HAYK — NUMU Creative Director",
  description: "Turn a thought into a protected, shot-directed cinematic production.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
