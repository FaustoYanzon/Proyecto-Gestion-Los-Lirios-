import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Providers from '@/components/providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Los Lirios SA',
  description: 'Sistema de gestión agrícola',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.className} h-full`}>
      <body className="h-full bg-gray-50" style={{ backgroundColor: '#f9fafb' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
