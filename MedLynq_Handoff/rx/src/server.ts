import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rxRoutes from './routes/rx.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.static('public'));
app.use('/api/rx', rxRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`[medlynq-rx] listening on port ${PORT}`);
});
