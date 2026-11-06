"use client";

import React, { useState, useEffect, useRef } from "react";
import { Icons } from "./Icons";
import { useAuth } from "@/context/AuthContext";

interface TopHeaderProps {
  onNavigate?: (view: "perfil" | "configuracion") => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({ onNavigate }) => {
  const { user, company, logout } = useAuth();

  const [isCompanyOpen, setIsCompanyOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  // Estados: null = comprobando, true = conectada, false = desconectada
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const companyRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  // Cerrar dropdowns al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (companyRef.current && !companyRef.current.contains(e.target as Node)) {
        setIsCompanyOpen(false);
      }
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotificationsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Sondeo de salud del Backend
  useEffect(() => {
    let isMounted = true;

    const checkHealth = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      try {
        const res = await fetch(`${apiUrl}/health`, {
          method: "GET",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
        });
        clearTimeout(timeoutId);

        if (isMounted) {
          setIsOnline(res.ok);
        }
      } catch {
        clearTimeout(timeoutId);
        if (isMounted) {
          setIsOnline(false);
        }
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 10000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [apiUrl]);

  const activeCompanyName = company?.razon_social || user?.empresa_activa?.razon_social || "Distribuidora SRL";
  const userName = user?.nombre_completo || "Nicolás Badilla";
  const userEmail = user?.email || "usuario@ejemplo.com";

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 w-full items-center justify-between border-b border-slate-200/80 bg-white px-6">
      {/* Izquierda: Selector / Vista de Empresa Activa */}
      <div className="relative" ref={companyRef}>
        <button
          type="button"
          onClick={() => setIsCompanyOpen(!isCompanyOpen)}
          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-1.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-100"
        >
          <span className="text-sm">🏛️</span>
          <span>
            Empresa: <strong className="font-bold text-slate-900">{activeCompanyName}</strong>
          </span>
          <Icons.ChevronDown className="h-3.5 w-3.5 text-slate-500" />
        </button>

        {isCompanyOpen && (
          <div className="absolute left-0 mt-2 w-64 rounded-2xl border border-slate-100 bg-white p-2 shadow-xl shadow-slate-200/50">
            <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Empresa Activa
            </div>
            <div className="rounded-xl bg-emerald-50/60 p-3 text-xs border border-emerald-100">
              <p className="font-bold text-slate-900">{activeCompanyName}</p>
              <p className="mt-0.5 font-mono text-[11px] text-slate-500">CUIT: {company?.cuit || "30712345678"}</p>
              <p className="text-[10px] text-slate-400 mt-1">{company?.direccion || "Av. Corrientes 1234, CABA"}</p>
            </div>
            <div className="my-1.5 border-t border-slate-100" />
            <button
              type="button"
              onClick={() => {
                setIsCompanyOpen(false);
                onNavigate?.("configuracion");
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-blue-600 hover:bg-blue-50 transition"
            >
              <Icons.Settings className="h-3.5 w-3.5" />
              <span>Gestionar configuración fiscal</span>
            </button>
          </div>
        )}
      </div>

      {/* Derecha: Estado API, Notificaciones y Perfil */}
      <div className="flex items-center gap-4">
        {/* Indicador de Estado de API */}
        <div className="hidden sm:flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-xs">
          {isOnline === true && (
            <>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="font-medium text-emerald-700">API Conectada</span>
            </>
          )}

          {isOnline === false && (
            <>
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              <span className="font-medium text-rose-700">API Desconectada</span>
            </>
          )}

          {isOnline === null && (
            <>
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="font-medium text-amber-700">Comprobando API...</span>
            </>
          )}
        </div>

        {/* Campana de Notificaciones */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
            className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
          >
            <Icons.Bell className="h-4 w-4" />
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white" />
          </button>

          {isNotificationsOpen && (
            <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-slate-100 bg-white p-4 shadow-xl shadow-slate-200/50">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-bold text-slate-900">Notificaciones</span>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  Sistema Oikonomias
                </span>
              </div>
              <div className="mt-3 space-y-2.5">
                <div className="rounded-xl bg-slate-50 p-2.5 text-xs">
                  <p className="font-semibold text-slate-800">Seguridad & Rate Limiting</p>
                  <p className="mt-0.5 text-slate-500">Protección activa contra fuerza bruta (5 intentos/min).</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-2.5 text-xs">
                  <p className="font-semibold text-slate-800">Motor de Conciliación Activo</p>
                  <p className="mt-0.5 text-slate-500">RapidFuzz y Pandas listos para cruce de extractos.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Avatar y Menú de Usuario */}
        <div className="relative" ref={userRef}>
          <button
            type="button"
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            className="flex items-center gap-3 rounded-xl p-1 transition hover:bg-slate-50"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-tr from-emerald-500 to-teal-600 font-semibold text-white shadow-sm text-xs">
              {getInitials(userName)}
            </div>
            <div className="hidden text-left sm:block">
              <span className="block text-xs font-bold text-slate-900 leading-tight">
                {userName}
              </span>
              <span className="block text-[10px] text-slate-500">
                Contador Principal
              </span>
            </div>
            <Icons.ChevronDown className="hidden h-3.5 w-3.5 text-slate-400 sm:block" />
          </button>

          {isUserMenuOpen && (
            <div className="absolute right-0 mt-2 w-52 rounded-2xl border border-slate-100 bg-white p-2 shadow-xl shadow-slate-200/50">
              <div className="px-3 py-2 text-xs font-medium text-slate-500 border-b border-slate-100 truncate">
                {userEmail}
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsUserMenuOpen(false);
                  onNavigate?.("perfil");
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                <Icons.User className="h-3.5 w-3.5 text-slate-400" />
                <span>Mi Perfil</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsUserMenuOpen(false);
                  onNavigate?.("configuracion");
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                <Icons.Settings className="h-3.5 w-3.5 text-slate-400" />
                <span>Configuración de Empresa</span>
              </button>
              <div className="my-1 border-t border-slate-100" />
              <button
                type="button"
                onClick={() => {
                  setIsUserMenuOpen(false);
                  logout();
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 transition"
              >
                <Icons.LogOut className="h-3.5 w-3.5" />
                <span>Cerrar Sesión</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
