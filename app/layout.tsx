import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Ultimate Character Card Builder",
  description: "Write, illustrate and test character cards in one place",
};

// viewport-fit=cover lets the phone layout's bottom bar pad itself clear of
// the home indicator (env(safe-area-inset-bottom)). resizes-content has
// Chrome shrink the page to fit above the on-screen keyboard, instead of
// covering its bottom, so what you type stays in view.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#020617",
};

// Set the theme before first paint, so a light-mode user doesn't get a
// flash of dark; and the look (components/Appearance.tsx keeps its CSS
// here as it applies it), before the settings it comes from have loaded.
const themeScript = `try{var d=document.documentElement,t=(JSON.parse(localStorage.getItem('uccb-ui')||'{}').state||{}).theme,l=JSON.parse(localStorage.getItem('uccb-look-css')||'null');if(l&&l.css){var s=document.createElement('style');s.id='uccb-look';s.textContent=l.css;document.head.appendChild(s);d.setAttribute('data-look','');t=l.base||t}if(t)d.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
