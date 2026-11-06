"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { Sidebar, ViewType } from "@/components/Sidebar";
import { TopHeader } from "@/components/TopHeader";
import { HomeUploadView } from "@/components/HomeUploadView";
import { SplitScreenAuditor } from "@/components/SplitScreenAuditor";
import { ReconciliationDashboard } from "@/components/ReconciliationDashboard";
import { IvaLiquidationView } from "@/components/IvaLiquidationView";
import { ReportsView } from "@/components/ReportsView";
import { ProfileView } from "@/components/ProfileView";
import { SettingsView } from "@/components/SettingsView";
import { Icons } from "@/components/Icons";

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  const [currentView, setCurrentView] = useState<ViewType>("inicio");
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);

  // Redirección inmediata sin timeouts
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  const handleInvoiceSelect = (invoiceData: any) => {
    setSelectedInvoice(invoiceData);
    setCurrentView("comprobantes");
  };

  // Mientras verifica o redirige, mantenemos el fondo claro (#F8FAFC) para evitar la pantalla negra
  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/20">
            <Icons.Logo className="h-6 w-6" />
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
            <span>Validando sesión segura...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#F8FAFC] font-sans text-slate-900 antialiased">
      <Sidebar
        currentView={currentView}
        setCurrentView={setCurrentView}
      />

      <div className="flex flex-1 flex-col pl-64">
        <TopHeader onNavigate={(view) => setCurrentView(view)} />

        <main className="flex-1 pb-16">
          {currentView === "inicio" && (
            <HomeUploadView onInvoiceProcessed={handleInvoiceSelect} />
          )}

          {currentView === "comprobantes" && (
            <SplitScreenAuditor
              invoiceData={selectedInvoice}
              onBack={() => setCurrentView("inicio")}
            />
          )}

          {currentView === "conciliaciones" && (
            <ReconciliationDashboard />
          )}

          {currentView === "liquidaciones" && (
            <IvaLiquidationView />
          )}

          {currentView === "reportes" && (
            <ReportsView />
          )}

          {currentView === "configuracion" && (
            <SettingsView />
          )}

          {currentView === "perfil" && (
            <ProfileView />
          )}
        </main>
      </div>
    </div>
  );
}