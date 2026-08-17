import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Geist, Geist_Mono } from "next/font/google";
import { THEME_INIT_SCRIPT } from "@/components/theme-toggle";
import { I18nProvider } from "@/components/i18n-provider";
import { getDictionary } from "@/lib/i18n";
import { getRequestLanguage } from "@/lib/i18n/server";
import "./globals.css";

/**
 * Body text. The Cyrillic subset is loaded because two of the seven guest
 * languages are written in it — without it a Bulgarian or Russian guest reads
 * the whole app in whatever their system falls back to.
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Headings only — the dining-room voice, against Geist for everything else. */
const displaySerif = Cormorant_Garamond({
  variable: "--font-display-serif",
  subsets: ["latin", "latin-ext", "cyrillic"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Vista Del Mar · Reservations",
    template: "%s · Vista Del Mar",
  },
  description: "Reserve your table and choose your menu at Vista Del Mar, the hotel's à la carte restaurant.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#100e0c" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  /**
   * The language is settled here, once per request, and handed to both the
   * server tree and the client one. Doing it in the layout is what lets a
   * screen render in Polish on the first paint rather than switching to it
   * after hydration.
   */
  const language = await getRequestLanguage();
  const dictionary = getDictionary(language);

  return (
    <html
      lang={language}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${displaySerif.variable} h-full antialiased`}
    >
      <head>
        {/* Applies the saved theme before the first paint, so a guest who
            chose dark never sees the light palette flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col text-ink">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-fg"
        >
          {dictionary.common.skipToContent}
        </a>
        <I18nProvider language={language} dictionary={dictionary}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
