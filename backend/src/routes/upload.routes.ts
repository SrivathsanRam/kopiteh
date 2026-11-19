import { Router } from 'express';
import uploadController from '../controllers/upload.controller';
import { upload } from '../middleware/upload.middleware';
import { asyncHandler } from '../middleware/async.handler';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post(
  '/single',
  authenticateToken,
  upload.single('image'),
  asyncHandler(uploadController.uploadSingle.bind(uploadController))
);

router.post(
  '/multiple',
  authenticateToken,
  upload.array('images', 10),
  asyncHandler(uploadController.uploadMultiple.bind(uploadController))
);

router.post(
  '/base64',
  authenticateToken,
  asyncHandler(uploadController.uploadBase64.bind(uploadController))
);

export default router;
