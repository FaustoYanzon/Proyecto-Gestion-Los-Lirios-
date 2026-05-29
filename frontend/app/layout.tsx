// frontend/app/layout.tsx
// Carga fuentes Public Sans + Fraunces + JetBrains Mono y aplica al body.

import type { Metadata } from 'next';
import { Public_Sans, Fraunces, JetBrains_Mono } from 'next/font/google';
import Providers from './providers';
import './globals.css';

const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Los Lirios SA — Gestión',
  description: 'Sistema de gestión integral. Producción, finanzas y campañas.',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/logo-mark.svg', type: 'image/svg+xml' },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      className={`${publicSans.variable} ${fraunces.variable} ${jetbrains.variable}`}
    >
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
