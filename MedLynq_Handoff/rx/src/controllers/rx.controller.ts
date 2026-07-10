import { Request, Response } from 'express';
import fs from 'fs';
import { decodePrescription } from '../services/rx.service';

export async function decodePrescriptionHandler(req: Request, res: Response): Promise<void> {
  const file = req.file;

  if (!file) {
    res.status(400).json({ error: 'No prescription image uploaded.' });
    return;
  }

  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedMimes.includes(file.mimetype)) {
    fs.unlinkSync(file.path);
    res.status(400).json({ error: 'Only JPEG, PNG, WebP, or GIF images are supported.' });
    return;
  }

  try {
    const decoded = await decodePrescription(file.path, file.mimetype);
    res.json({ success: true, data: decoded });
  } catch (err) {
    console.error('[RX] Decode error:', err);
    res.status(500).json({ error: 'Failed to decode prescription. Please try again.' });
  } finally {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
  }
}
