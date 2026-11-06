"use client";

import React, { useState, useEffect, FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { Icons } from "./Icons";

export const ProfileView: React.FC = () => {
  const { user, updateProfile, logout } = useAuth();

  const [nombreCompleto, setNombreCompleto] = useState(user?.nombre_completo || "Nicolás Badilla");
  const [email, setEmail] = useState(user?.email || "usuario@ejemplo.com");

  // Contraseñas
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [isSaving, setIsSaving] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (user) {
      setNombreCompleto(user.nombre_completo);
      setEmail(user.email);
    }
  }, [user]);

  const handleUpdateProfile = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setNotification(null);

    if (newPassword) {
      if (newPassword.length < 6) {
        setNotification({ type: "error", text: "La nueva contraseña debe tener al menos 6 caracteres." });
        setIsSaving(false);
        return;
      }
      if (newPassword !== confirmPassword) {
        setNotification({ type: "error", text: "La nueva contraseña y su confirmación no coinciden." });
        setIsSaving(false);
        return;
      }
      if (!currentPassword) {
        setNotification({ type: "error", text: "Debes ingresar tu contraseña actual para cambiarla." });
        setIsSaving(false);
        return;
      }
    }

    const payload: {
      nombre_completo?: string;
      email?: string;
      current_password?: string;
      new_password?: string;
    } = {
      nombre_completo: nombreCompleto,
      email: email,
    };

    if (newPassword) {
      payload.current_password = currentPassword;
      payload.new_password = newPassword;
    }

    const result = await updateProfile(payload);

    if (result.success) {
      setNotification({
        type: "success",
        text: "¡Perfil actualizado con éxito!",
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      setNotification({
        type: "error",
        text: result.error || "Error al actualizar el perfil.",
      });
    }

    setIsSaving(false);
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Encabezado */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Perfil de Usuario</h1>
        <p className="mt-1 text-sm text-slate-500">
          Gestiona tus credenciales, datos de acceso y preferencias contables en Oikonomias.
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

      {/* Tarjeta Resumen del Usuario */}
      <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-600 text-xl font-bold text-white shadow-md shadow-emerald-500/20">
            {getInitials(nombreCompleto || "NB")}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">{nombreCompleto}</h2>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                Contador Principal
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">{email}</p>
            <p className="text-[11px] text-slate-400 mt-1">
              Empresa activa: <strong className="text-slate-700">{user?.empresa_activa?.razon_social || "Distribuidora SRL"}</strong>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={logout}
          className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/50 px-4 py-2.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100/70"
        >
          <Icons.LogOut className="h-4 w-4" />
          <span>Cerrar Sesión</span>
        </button>
      </div>

      {/* Formulario Principal de Edición */}
      <form onSubmit={handleUpdateProfile} className="space-y-8">
        {/* Sección: Datos Personales */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4 mb-5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Icons.User className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Información Personal</h3>
              <p className="text-xs text-slate-400">Datos visibles en las certificaciones contables emitidas.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Nombre Completo
              </label>
              <input
                type="text"
                required
                value={nombreCompleto}
                onChange={(e) => setNombreCompleto(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Correo Electrónico
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Rol en el Sistema
              </label>
              <div className="mt-1.5 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-slate-700">
                <span>{user?.rol || "CONTADOR"}</span>
                <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">
                  Solo Lectura
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Sección: Seguridad y Contraseña */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4 mb-5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <Icons.Lock className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Seguridad & Contraseña</h3>
              <p className="text-xs text-slate-400">Deja los campos en blanco si no deseas modificar tu clave.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Contraseña Actual
              </label>
              <input
                type="password"
                placeholder="••••••••"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Nueva Contraseña
              </label>
              <input
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Confirmar Nueva Clave
              </label>
              <input
                type="password"
                placeholder="Repetir nueva clave"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Botón de Guardar Cambios */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-xs font-bold text-white shadow-md shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Guardando cambios...</span>
              </>
            ) : (
              <>
                <Icons.CheckCircle className="h-4 w-4" />
                <span>Guardar Cambios de Perfil</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

