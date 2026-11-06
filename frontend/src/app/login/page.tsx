"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { Icons } from "@/components/Icons";

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [rateLimitTimer, setRateLimitTimer] = useState(0);

  // Redirigir a inicio si ya está autenticado
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.push("/");
    }
  }, [authLoading, isAuthenticated, router]);

  // Manejo de cuenta regresiva si se activa Rate Limiting (60s)
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (rateLimitTimer > 0) {
      interval = setInterval(() => {
        setRateLimitTimer((prev) => {
          if (prev <= 1) {
            setIsRateLimited(false);
            setErrorMessage(null);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [rateLimitTimer]);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isRateLimited) return;

    setErrorMessage(null);
    setIsSubmitting(true);

    const result = await login(email, password);

    if (result.success) {
      router.push("/");
    } else {
      if (result.status === 429) {
        setIsRateLimited(true);
        setRateLimitTimer(60);
        setErrorMessage(result.error || "Demasiados intentos. Espera 60 segundos.");
      } else {
        setErrorMessage(result.error || "Credenciales incorrectas. Verifica tu email y contraseña.");
      }
    }

    setIsSubmitting(false);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#F8FAFC] px-4 py-12 sm:px-6 lg:px-8 font-sans">
      <div className="w-full max-w-md space-y-8">
        {/* Encabezado y Logo */}
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/25">
            <Icons.Logo className="h-8 w-8" />
          </div>
          <h2 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">
            Iniciar sesión en Oikonomias
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Plataforma de Auditoría Contable y Conciliación con Inteligencia Artificial
          </p>
        </div>

        {/* Tarjeta del Formulario */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-8 shadow-sm">
          {/* Alerta de Error o Rate Limit */}
          {errorMessage && (
            <div
              className={`mb-6 flex items-start gap-3 rounded-2xl p-4 text-xs font-medium ${
                isRateLimited
                  ? "border border-amber-300 bg-amber-50 text-amber-900"
                  : "border border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              <div className="shrink-0 pt-0.5">
                {isRateLimited ? (
                  <Icons.AlertCircle className="h-4 w-4 text-amber-600" />
                ) : (
                  <Icons.AlertCircle className="h-4 w-4 text-rose-600" />
                )}
              </div>
              <div className="flex-1">
                <p className="font-semibold">{isRateLimited ? "Acceso Bloqueado por Seguridad" : "Error de Autenticación"}</p>
                <p className="mt-0.5">{errorMessage}</p>
                {isRateLimited && rateLimitTimer > 0 && (
                  <p className="mt-2 font-mono text-[11px] font-bold text-amber-800">
                    Reintentar en: {rateLimitTimer} segundos
                  </p>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Campo Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold text-slate-700"
              >
                Correo Electrónico
              </label>
              <div className="relative mt-1">
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={isSubmitting || isRateLimited}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@ejemplo.com"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            {/* Campo Contraseña */}
            <div>
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Contraseña
                </label>
                <span className="text-[11px] text-slate-400">
                  Mínimo 6 caracteres
                </span>
              </div>
              <div className="relative mt-1">
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={isSubmitting || isRateLimited}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            {/* Botón de Envío */}
            <button
              type="submit"
              disabled={isSubmitting || isRateLimited}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Validando acceso...</span>
                </>
              ) : isRateLimited ? (
                <span>Bloqueado ({rateLimitTimer}s)</span>
              ) : (
                <>
                  <Icons.CheckCircle className="h-4 w-4" />
                  <span>Ingresar al Sistema</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Pie de Página */}
        <p className="text-center text-xs text-slate-400">
          Oikonomias © 2026 • Sistema de Inteligencia Contable
        </p>
      </div>
    </div>
  );
}

