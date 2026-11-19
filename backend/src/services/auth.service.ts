import type { CreateAccountPayload } from "../types/payloads";
import type { ServiceResult } from "../types/responses";
import { firebaseAuth, db } from "../config/firebase";
import { successResponse, errorResponse } from "../types/responses";
import { ErrorCodes } from "../types/errors";
import { SuccessCodes } from "../types/success";
import { Collections } from "./firestore.service";

function firebaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
}

export const AuthService = {
  async createAccount(payload: CreateAccountPayload): Promise<ServiceResult<any>> {
    if (payload.secretCode !== process.env.ADMIN_SIGNUP_CODE) {
      return errorResponse(ErrorCodes.UNAUTHORIZED, "Invalid signup code");
    }

    let uid: string | null = null;
    try {
      const account = await firebaseAuth.createUser({
        email: payload.email,
        password: payload.password,
        displayName: payload.name,
        emailVerified: true,
      });
      uid = account.uid;
      await firebaseAuth.setCustomUserClaims(uid, { role: "admin" });
      const created_at = new Date().toISOString();
      const user = {
        user_id: uid,
        name: payload.name,
        email: payload.email,
        role: "admin",
        is_authenticated: true,
        created_at,
      };
      await db.collection(Collections.users).doc(uid).set(user);
      return successResponse(SuccessCodes.CREATED, {
        message: "Account created successfully.",
        user,
      });
    } catch (error) {
      if (uid) await firebaseAuth.deleteUser(uid).catch(() => undefined);
      const code = firebaseErrorCode(error);
      if (code === "auth/email-already-exists") {
        return errorResponse(ErrorCodes.VALIDATION_ERROR, "Email already registered");
      }
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async authCheck(bearerToken?: string): Promise<ServiceResult<any>> {
    if (!bearerToken) {
      return successResponse(SuccessCodes.OK, { isAuthenticated: false });
    }
    const token = bearerToken.startsWith("Bearer ")
      ? bearerToken.slice("Bearer ".length)
      : bearerToken;
    try {
      const decoded = await firebaseAuth.verifyIdToken(token);
      return successResponse(SuccessCodes.OK, {
        isAuthenticated: decoded.role === "admin",
      });
    } catch {
      return successResponse(SuccessCodes.OK, { isAuthenticated: false });
    }
  },
};
