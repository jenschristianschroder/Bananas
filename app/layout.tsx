import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sealed World Lab",
  description: "Controlled RAG experiment for alternate-world grounding"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
