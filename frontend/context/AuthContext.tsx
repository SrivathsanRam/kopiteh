"use client";

import { useEffect, useState } from "react";
import { onIdTokenChanged, signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { useAuthStore } from "@/stores/auth.store";

export function AuthContext({ children }: { children: React.ReactNode }) {
  const { isHydrated, setAccessToken, setUser, logout } = useAuthStore();
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    if (!isHydrated) return;
    const auth = getFirebaseAuth();
    return onIdTokenChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        logout();
        setBootstrapped(true);
        return;
      }

      const tokenResult = await firebaseUser.getIdTokenResult();
      if (tokenResult.claims.role !== "admin") {
        await signOut(auth);
        logout();
        setBootstrapped(true);
        return;
      }

      setAccessToken(tokenResult.token);
      setUser({
        user_id: firebaseUser.uid,
        email: firebaseUser.email ?? "",
        name: firebaseUser.displayName ?? firebaseUser.email ?? "Administrator",
        role: "admin",
        created_at: firebaseUser.metadata.creationTime ?? new Date().toISOString(),
      });
      setBootstrapped(true);
    });
  }, [isHydrated, logout, setAccessToken, setUser]);

  if (!bootstrapped) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    );
  }
  return <>{children}</>;
}
