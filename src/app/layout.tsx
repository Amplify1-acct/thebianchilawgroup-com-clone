import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'The Bianchi Law Group',
  description: 'New Jersey Criminal Defense Attorneys',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Nunito+Sans:wght@300;400;600&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, fontFamily: "'Nunito Sans', sans-serif", background: '#fff' }}>
        {children}
      </body>
    </html>
  )
}
