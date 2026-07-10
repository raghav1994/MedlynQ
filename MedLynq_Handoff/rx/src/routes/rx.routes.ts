import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { decodePrescriptionHandler } from '../controllers/rx.controller';

const router = Router();

const upload = multer({
  dest: path.join(__dirname, '../../uploads/rx'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

router.post('/decode', upload.single('prescription'), decodePrescriptionHandler);

export default router;
