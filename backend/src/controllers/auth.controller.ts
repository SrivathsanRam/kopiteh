import type { Request, Response } from "express";
import type { CreateAccountPayload } from "../types/payloads";
import { AuthService } from "../services/auth.service";
import { BadRequestError } from "./errors";
import { errorResponse } from "../types/responses";
import { ErrorCodes } from "../types/errors";

export const AuthController = {
  async createAccount(req: Request, res: Response) {
    try {
      const result = await AuthService.createAccount(req.body as CreateAccountPayload);
      return res.status(result.payload.status).json(result);
    } catch (error) {
      const result = error instanceof BadRequestError
        ? errorResponse(ErrorCodes.VALIDATION_ERROR, String(error.details))
        : errorResponse(ErrorCodes.INTERNAL_ERROR);
      return res.status(result.payload.status).json(result);
    }
  },

  async authCheck(req: Request, res: Response) {
    const result = await AuthService.authCheck(req.headers.authorization);
    return res.status(result.payload.status).json(result);
  },
};
