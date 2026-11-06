import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

export const metadata: Metadata = {
  title: "Oikonomias — Auditoría Contable & Conciliación Bancaria con IA",
  description: "Plataforma de procesamiento inteligente de comprobantes fiscales y conciliación bancaria algorítmica.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="h-full antialiased" suppressHydrationWarning>
      <body 
        className="min-h-full flex flex-col font-sans" 
        suppressHydrationWarning
      >
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
