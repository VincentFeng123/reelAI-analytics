import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Nosca Analytics",
  description: "Private owner analytics for the Nosca product.",
  icons: {
    icon: "/nosca-favicon-rounded-v5.png",
  },
  robots: {
    follow: false,
    index: false,
    nocache: true,
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
