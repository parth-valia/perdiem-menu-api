import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import router from './routes/index';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// Security headers — helmet sets sane defaults that block common web attacks.
// We're an API-only server so we tune some CSP defaults off.
app.use(helmet({ contentSecurityPolicy: false }));

// CORS — restrict to known origins; the client app and local dev
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    methods: ['GET'],
    allowedHeaders: ['Content-Type'],
  }),
);

// Rate limiting — Square's API is the real bottleneck, but we also want to
// protect our own endpoint from being hammered. 100 req/min per IP is generous
// for a menu browser.
const limiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' },
  },
});
app.use(limiter);

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json());

app.use('/api/v1', router);

// 404 handler — must come after routes
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
});

app.use(errorHandler);

const PORT = parseInt(process.env.PORT ?? '3001', 10);

app.listen(PORT, () => {
  console.log(`[perdiem-api] running on port ${PORT} (${process.env.NODE_ENV ?? 'development'})`);
});

export default app;
