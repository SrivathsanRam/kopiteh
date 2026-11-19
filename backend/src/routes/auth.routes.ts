import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { createAccountValidation, runValidation } from '../middleware/auth.validation';

const router = Router();

router.post('/auth/create-account', createAccountValidation, runValidation, AuthController.createAccount);
router.get('/auth/auth-check', AuthController.authCheck);

export default router;
