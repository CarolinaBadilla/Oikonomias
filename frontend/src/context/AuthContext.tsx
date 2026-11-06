"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useRouter } from "next/navigation";

export interface Company {
  id: string;
  cuit: string;
  razon_social: string;
  direccion?: string | null;
  moneda: string;
}

export interface User {
  id: string;
  email: string;
  nombre_completo: string;
  rol: string;
  is_active: boolean;
  empresa_activa?: Company | null;
}

export interface AuthContextType {
  user: User | null;
  company: Company | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string; status?: number }>;
  logout: () => void;
  updateProfile: (data: {
    nombre_completo?: string;
    email?: string;
    current_password?: string;
    new_password?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  updateCompany: (data: {
    razon_social?: string;
    cuit?: string;
    direccion?: string;
    moneda?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "contala_access_token";

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const router = useRouter();

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

  const refreshUser = async (authToken?: string) => {
    const activeToken =
      authToken ||
      token ||
      (typeof window !== "undefined"
        ? localStorage.getItem(TOKEN_KEY)
        : null);

    if (!activeToken) {
      setUser(null);
      setToken(null);
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/me`, {
        headers: {
          Authorization: `Bearer ${activeToken}`,
          "Content-Type": "application/json",
        },
      });

      if (res.ok) {
        const userData: User = await res.json();
        setUser(userData);
        setToken(activeToken);
      } else {
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
        setToken(null);
        if (typeof window !== "undefined" && !window.location.pathname.includes("/login")) {
          router.push("/login");
        }
      }
    } catch (error) {
      console.warn("No se pudo conectar con el endpoint de autenticación:", error);
      setUser(null);
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const storedToken = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (storedToken) {
      setToken(storedToken);
      refreshUser(storedToken);
    } else {
      setIsLoading(false);
      if (typeof window !== "undefined" && !window.location.pathname.includes("/login")) {
        router.push("/login");
      }
    }
  }, []);

  const login = async (
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string; status?: number }> => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.status === 429) {
        return {
          success: false,
          status: 429,
          error: "Has superado el límite de 5 intentos por minuto. Tu acceso está temporalmente pausado por seguridad.",
        };
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        return {
          success: false,
          status: res.status,
          error: data.detail || "Credenciales incorrectas o usuario no registrado.",
        };
      }

      const receivedToken = data.access_token;
      localStorage.setItem(TOKEN_KEY, receivedToken);
      setToken(receivedToken);
      setUser(data.user);

      return { success: true };
    } catch {
      return {
        success: false,
        error: "Error de conexión con el servidor. Verifica que el backend esté en ejecución.",
      };
    }
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    router.push("/login");
  };

  const updateProfile = async (data: {
    nombre_completo?: string;
    email?: string;
    current_password?: string;
    new_password?: string;
  }): Promise<{ success: boolean; error?: string }> => {
    if (!token) return { success: false, error: "No autenticado" };

    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/profile`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { success: false, error: resData.detail || "Error al actualizar perfil." };
      }

      setUser(resData);
      return { success: true };
    } catch {
      return { success: false, error: "Error de red al actualizar perfil." };
    }
  };

  const updateCompany = async (data: {
    razon_social?: string;
    cuit?: string;
    direccion?: string;
    moneda?: string;
  }): Promise<{ success: boolean; error?: string }> => {
    if (!token) return { success: false, error: "No autenticado" };

    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/company`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { success: false, error: resData.detail || "Error al actualizar configuración de empresa." };
      }

      // Actualizar la empresa activa en el estado del usuario
      setUser((prev) => (prev ? { ...prev, empresa_activa: resData } : null));
      return { success: true };
    } catch {
      return { success: false, error: "Error de red al actualizar empresa." };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        company: user?.empresa_activa || null,
        token,
        isAuthenticated: Boolean(token && user),
        isLoading,
        login,
        logout,
        updateProfile,
        updateCompany,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth debe ser utilizado dentro de un AuthProvider");
  }
  return context;
};

