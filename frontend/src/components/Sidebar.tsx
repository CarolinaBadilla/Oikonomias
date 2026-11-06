"use client";

import React from "react";
import { Icons } from "./Icons";
import { useAuth } from "@/context/AuthContext";

export type ViewType = "inicio" | "comprobantes" | "conciliaciones" | "liquidaciones" | "reportes" | "configuracion" | "perfil";

export interface SidebarProps {
  currentView: string;
  setCurrentView: (view: ViewType) => void;
}

interface NavItem {
  id: ViewType;
  viewTarget?: ViewType;
  label: string;
  icon: (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "inicio", viewTarget: "inicio", label: "Inicio", icon: Icons.Home },
  { id: "comprobantes", viewTarget: "comprobantes", label: "Comprobantes", icon: Icons.FileText },
  { id: "conciliaciones", viewTarget: "conciliaciones", label: "Conciliaciones", icon: Icons.Landmark },
  { id: "liquidaciones", viewTarget: "liquidaciones", label: "Liquidación IVA", icon: Icons.Calculator },
  { id: "reportes", viewTarget: "reportes", label: "Reportes", icon: Icons.TrendingUp },
  { id: "configuracion", viewTarget: "configuracion", label: "Configuración", icon: Icons.Settings },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentView, setCurrentView }) => {
  const { user } = useAuth();

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-slate-200/80 bg-white">
      {/* Logo & Marca */}
      <div className="flex h-16 items-center gap-3 px-6 border-b border-slate-100">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm shadow-emerald-500/30">
          <Icons.Logo className="h-5 w-5" />
        </div>
        <div>
          <span className="text-xl font-bold tracking-tight text-slate-900">
            Oikonomias
          </span>
          <span className="ml-1.5 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
            SaaS
          </span>
        </div>
      </div>

      {/* Menú de Navegación Principal */}
      <nav className="flex-1 space-y-1.5 px-3 py-6">
        {NAV_ITEMS.map((item) => {
          const isActive = currentView === item.id;
          const IconComponent = item.icon;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.viewTarget) {
                  setCurrentView(item.viewTarget);
                } else {
                  alert(`El módulo de ${item.label} estará disponible en la próxima actualización del Sprint.`);
                }
              }}
              className={`group flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm transition-all duration-150 ${
                isActive
                  ? "bg-emerald-50 font-semibold text-emerald-700 shadow-sm"
                  : "font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <div className="flex items-center gap-3">
                <IconComponent
                  className={`h-5 w-5 transition-colors ${
                    isActive ? "text-emerald-600" : "text-slate-400 group-hover:text-slate-600"
                  }`}
                />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Pie del Sidebar: Usuario / Perfil */}
      <div className="border-t border-slate-100 p-3 space-y-2">
        <button
          type="button"
          onClick={() => setCurrentView("perfil")}
          className={`flex w-full items-center gap-3 rounded-2xl p-2 text-left transition ${
            currentView === "perfil"
              ? "bg-emerald-50 text-emerald-800"
              : "hover:bg-slate-50 text-slate-700"
          }`}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-tr from-emerald-500 to-teal-600 text-xs font-bold text-white shadow-sm">
            {getInitials(user?.nombre_completo || "Nicolás Badilla")}
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs font-bold text-slate-900 leading-tight">
              {user?.nombre_completo || "Nicolás Badilla"}
            </p>
            <p className="truncate text-[10px] text-slate-400 font-medium">
              Mi Perfil • Contador
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => alert("Soporte Oikonomias: Contacta a soporte@oikonomias.app o consulta la documentación del sistema.")}
          className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
        >
          <Icons.HelpCircle className="h-4 w-4 text-slate-400" />
          <span>Ayuda & Soporte</span>
        </button>
      </div>
    </aside>
  );
};
