"use client";

import React, { useState, useEffect, FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { Icons } from "./Icons";

export const SettingsView: React.FC = () => {
  const { company, updateCompany } = useAuth();

  const [razonSocial, setRazonSocial] = useState(company?.razon_social || "Distribuidora SRL");
  const [cuit, setCuit] = useState(company?.cuit || "30712345678");
  const [direccion, setDireccion] = useState(company?.direccion || "Av. Corrientes 1234, CABA");
  const [moneda, setMoneda] = useState(company?.moneda || "ARS");

  const [isSaving, setIsSaving] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (company) {
      setRazonSocial(company.razon_social);
      setCuit(company.cuit);
      setDireccion(company.direccion || "");
      setMoneda(company.moneda || "ARS");
    }
  }, [company]);

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setNotification(null);

    const result = await updateCompany({
      razon_social: razonSocial,
      cuit: cuit.replace(/\D/g, ""),
      direccion: direccion,
      moneda: moneda,
    });

    if (result.success) {
      setNotification({
        type: "success",
        text: "¡Configuración de la empresa guardada exitosamente!",
      });
    } else {
      setNotification({
        type: "error",
        text: result.error || "No se pudo actualizar la empresa.",
      });
    }

    setIsSaving(false);
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 font-sans">
      {/* Encabezado */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Configuración de Empresa</h1>
        <p className="mt-1 text-sm text-slate-500">
          Administra la entidad fiscal emisora/receptora activa en el entorno de auditoría contable.
        </p>
      </div>

      {/* Alerta de Notificación */}
      {notification && (
        <div
          className={`mb-6 flex items-center justify-between rounded-2xl p-4 text-xs font-semibold ${
            notification.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          <span>{notification.text}</span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="text-slate-500 hover:text-slate-800 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Formulario */}
      <form onSubmit={handleSaveSettings} className="space-y-6">
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4 mb-6">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Icons.Building className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Datos Fiscales de la Empresa</h3>
              <p className="text-xs text-slate-400">Parámetros utilizados en los algoritmos de cruce y conciliación.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Razón Social */}
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Razón Social / Denominación
              </label>
              <input
                type="text"
                required
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
                placeholder="Ej: Distribuidora SRL"
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* CUIT */}
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                CUIT de la Empresa (11 dígitos)
              </label>
              <input
                type="text"
                required
                maxLength={11}
                value={cuit}
                onChange={(e) => setCuit(e.target.value)}
                placeholder="30712345678"
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Domicilio Fiscal */}
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Domicilio Fiscal
              </label>
              <input
                type="text"
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                placeholder="Av. Corrientes 1234, CABA"
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Moneda Principal */}
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Moneda Funcional Contable
              </label>
              <select
                value={moneda}
                onChange={(e) => setMoneda(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="ARS">ARS — Peso Argentino ($)</option>
                <option value="USD">USD — Dólar Estadounidense (u$s)</option>
                <option value="EUR">EUR — Euro (€)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Políticas de Auditoría y Conciliación */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4 mb-5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Icons.Shield className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Políticas de Validación Automática</h3>
              <p className="text-xs text-slate-400">Reglas aplicadas durante el procesamiento óptico y bancario.</p>
            </div>
          </div>

          <div className="space-y-3 text-xs text-slate-600">
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div>
                <span className="font-bold text-slate-800 block">Validación Impositiva AFIP</span>
                <span className="text-[11px] text-slate-400">Comprueba automáticamente Neto + IVA = Total declarado con tolerancia $0.05.</span>
              </div>
              <span className="font-bold text-emerald-600">Activo</span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div>
                <span className="font-bold text-slate-800 block">Algoritmo RapidFuzz en Conciliación</span>
                <span className="text-[11px] text-slate-400">Empareja conceptos bancarios contra la razón social con scoring porcentual.</span>
              </div>
              <span className="font-bold text-emerald-600">Activo</span>
            </div>
          </div>
        </div>

        {/* Botón Guardar */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-xs font-bold text-white shadow-md shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Guardando configuración...</span>
              </>
            ) : (
              <>
                <Icons.CheckCircle className="h-4 w-4" />
                <span>Guardar Configuración</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

