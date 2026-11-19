"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { sendPasswordResetEmail } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/formfield";

export default function ForgotPasswordPage() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setEmail(searchParams.get("email") ?? "");
  }, [searchParams]);

  const handleForgotPassword = async () => {
    setError(null);
    setSuccess(null);
    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
      setSuccess("A password reset link has been sent to your email.");
    } catch (err: any) {
      setError(err.message || "Unable to send the password reset email.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="w-[400px] p-5 flex flex-col space-y-12 items-center">
        <div className="text-center">
          <h1 className="font-extrabold text-4xl">Forgot Password</h1>
          <p className="mt-2 text-grey-primary/70">
            Enter your email and Firebase will send you a secure reset link.
          </p>
        </div>

        <div className="w-full space-y-8">
          <FormField
            className="flex flex-col space-y-1"
            classNameOut={`p-3 bg-white rounded-2xl transition-all ${error ? "border-2 border-red-500" : "border"}`}
            classNameIn="focus:outline-none text-grey-primary w-full"
            variant="email"
            label=""
            inputProps={{
              value: email,
              placeholder: "Email",
              onChange: (event) => {
                setEmail(event.target.value);
                setError(null);
              },
            }}
          />
          <Button
            onClick={handleForgotPassword}
            variant="signin"
            disabled={loading || !email}
            className="w-full"
          >
            {loading ? "Sending..." : "Send reset email"}
          </Button>
          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          {success && <p className="text-green-600 text-sm text-center">{success}</p>}
        </div>

        <Link href="/admin/auth/login" className="font-semibold underline">
          Back to login
        </Link>
      </div>
    </main>
  );
}
