import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/shell/sidebar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Sentinel", template: "%s · Sentinel" },
  description: "Describe what to watch on the web. Sentinel compiles it into a pipeline and shows you what it is doing.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="flex min-h-full flex-col md:flex-row">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-surface"
        >
          Skip to content
        </a>
        <Sidebar />
        <main id="main" className="min-w-0 flex-1 md:h-dvh md:overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 md:px-8 md:py-8">{children}</div>
        </main>
      </body>
    </html>
  );
}
