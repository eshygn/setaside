import type { Metadata } from 'next';
import { Fraunces, IBM_Plex_Mono, Inter_Tight } from 'next/font/google';
import './globals.css';

const display = Fraunces({ variable: '--font-display', subsets: ['latin'], axes: ['opsz', 'SOFT'] });
const sans = Inter_Tight({ variable: '--font-sans', subsets: ['latin'] });
const mono = IBM_Plex_Mono({ variable: '--font-mono', subsets: ['latin'], weight: ['400', '500'] });

export const metadata: Metadata = {
  title: { template: '%s · SetAside', default: 'SetAside: know what to put aside' },
  description: 'SetAside reads your PayPal activity, sorts business income from personal transfers with AI, and tells you how much tax to put aside.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
