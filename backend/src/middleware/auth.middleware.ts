import type { Request, Response, NextFunction } from "express";
import { firebaseAuth } from "../config/firebase";
import { errorResponse } from "../types/responses";
import { ErrorCodes } from "../types/errors";

export async function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (!token) {
    const result = errorResponse(ErrorCodes.UNAUTHORIZED, "Missing or malformed Authorization header");
    return res.status(result.payload.status).json(result);
  }

  try {
    const decoded = await firebaseAuth.verifyIdToken(token);
    if (decoded.role !== "admin") {
      const result = errorResponse(ErrorCodes.UNAUTHORIZED, "Administrator access required");
      return res.status(result.payload.status).json(result);
    }
    (req as any).user = decoded;
    return next();
  } catch {
    const result = errorResponse(ErrorCodes.UNAUTHORIZED, "Invalid or expired Firebase token");
    return res.status(result.payload.status).json(result);
  }
}
