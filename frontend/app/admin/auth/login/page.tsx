'use client'

import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/formfield"
import { useState } from "react"
import { useAuthStore } from "@/stores/auth.store"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { signInWithEmailAndPassword, signOut } from "firebase/auth"
import { getFirebaseAuth } from "@/lib/firebase"

export default function Home() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const router = useRouter();

  const setAccessToken = useAuthStore((state) => state.setAccessToken);
  const setUser = useAuthStore((state) => state.setUser);
  const handleLogin = async () => {
    setError("");
    setSuccess("");
    setLoading(true);

    if (!email?.trim()) {
      setError("Please enter your email");
      setLoading(false);
      return;
    }

    if (!password) {
      setError("Please enter your password");
      setLoading(false);
      return;
    }


    setLoading(true);
    try {
      const auth = getFirebaseAuth();
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const tokenResult = await credential.user.getIdTokenResult(true);
      if (tokenResult.claims.role !== "admin") {
        await signOut(auth);
        throw new Error("This account does not have administrator access.");
      }
      setAccessToken(tokenResult.token);
      setUser({
        user_id: credential.user.uid,
        email: credential.user.email ?? email.trim(),
        name: credential.user.displayName ?? "Administrator",
        role: "admin",
        created_at: credential.user.metadata.creationTime ?? new Date().toISOString(),
      });
      setSuccess("Login successful.");

      setTimeout(() => {
        router.push("/admin/main/viewanalytics");
      }, 1500);
    } catch (err: any) {
      console.error("Login error:", err);
      setError(err.code === "auth/invalid-credential" ? "Invalid email or password." : err.message || "Unable to log in.");
    } finally {
      setLoading(false);
    }

  }
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="w-[400px] items-center flex flex-col justify-center">
        <div className="p-5 flex flex-col w-full h-full space-y-20 items-center">
          <div className="flex items-center flex-col">
            <h1 className=" font-extrabold text-4xl text-center">Login</h1>

          </div>
          <div className="w-full">
            <div className="flex flex-col space-y-10 w-full">
              <FormField
                className="flex flex-col space-y-1"
                classNameOut={`p-3 bg-white rounded-2xl transition-all duration-200 ease-out
                  ${error ? "border-2 border-red-500" : "border-1 focus-within:border-transparent focus-within:ring-2 focus-within:ring-primary1/80"}
                `}
                classNameIn="focus:outline-none text-grey-primary placeholder-center w-full text-left focus:placeholder-transparent"
                variant="email"
                label=""
                inputProps={{ value: email, placeholder: "Email", onChange: (e) => { setEmail(e.target.value); setError(null); } }} />
              <FormField
                className="flex flex-col space-y-1"
                classNameOut={`p-3 bg-white rounded-2xl transition-all duration-200 ease-out
                  ${error ? "border-2 border-red-500" : "border-1 focus-within:border-transparent focus-within:ring-2 focus-within:ring-primary1/80"}
                `}
                classNameIn="focus:outline-none text-grey-primary placeholder-center w-full text-left focus:placeholder-transparent"
                variant="password"
                label=""
                inputProps={{ value: password, placeholder: "Password", onChange: (e) => { setPassword(e.target.value); setError(null); } }} />
            </div>
          </div>

          <div className="flex flex-col justify-center items-center w-full space-y-3">
            <Button
              onClick={handleLogin}
              variant="signin"
              disabled={loading || !email || !password}
              className="flex w-1/3 items-center justify-center"
            >
              {loading ? (
                <div className="flex items-center space-x-2">
                  <span className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  <span>Logging in...</span>
                </div>
              ) : (
                "Log In"
              )}
            </Button>
            {error && (
              <div className="flex justify-center w-full">
                <p className="text-red-500 text-sm mt-2 text-center">{error}</p>
              </div>
            )}

            {success && (
              <div className="flex justify-center w-full">
                <p className="text-green-600 text-sm mt-2 text-center">{success}</p>
              </div>
            )}
            <Button
              onClick={() => {
                router.push(`/admin/auth/forgotpassword?email=${encodeURIComponent(email)}`);
              }}
              className="cursor-pointer bg-transparent hover:bg-transparent"
            >
              <span className="text-sm text-grey-primary/80">Forgot password?</span>
            </Button>
            <div className="flex flex-row space-x-1 text-grey-primary text-md">
              <label className="text-grey-primary/70">Don&apos;t have an account yet?</label>
              <Link href="/admin/auth/signup" className="font-semibold underline cursor-pointer">
                <span>Register here!</span>
              </Link>
            </div>

          </div>


        </div>
      </div>
    </main>
  )
}
