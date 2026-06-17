const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const carnetRoutes = require('./routes/carnet');
const citasRoutes = require('./routes/citas');
const appointmentsRoutes = require('./routes/appointments');
const promocionesRoutes = require('./routes/promociones');
const vacunasRoutes = require('./routes/vacunas');
const consultasRoutes = require('./routes/consultas');
const alebrijeRoutes = require('./routes/alebrije');
const { connectToCosmosDB } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de CORS
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://localhost:8080',
      'https://carnet-alumnos-nodes.onrender.com',
      'https://app.carnetdigital.space'
    ];
    
    // Permitir requests sin origin (aplicaciones móviles, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware de seguridad
app.use(helmet());
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutos
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // límite de requests por IP
  message: {
    success: false,
    message: 'Demasiadas peticiones desde esta IP, intente de nuevo más tarde.'
  }
});

app.use(limiter);

// Middleware para parsing JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoints (ambos /ping y /health para compatibilidad)
app.get('/ping', (req, res) => {
  res.json({
    success: true,
    message: 'Backend SASU online',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime()
  });
});

app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    message: 'Backend SASU online',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime()
  });
});

// Rutas principales
app.use('/auth', authRoutes);
app.use('/me', carnetRoutes);
app.use('/me', citasRoutes);
app.use('/me', appointmentsRoutes);
app.use('/me', promocionesRoutes);  // Montado en /me para coincidir con Flutter app
app.use('/me', vacunasRoutes);  // Ruta de vacunación
app.use('/me', consultasRoutes);  // Ruta de consultas de atención
app.use('/me', alebrijeRoutes);  // Ruta de alebrijes Tamagotchi

// Manejo de rutas no encontradas
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint no encontrado'
  });
});

// Middleware de manejo de errores
app.use((error, req, res, next) => {
  console.error('Error:', error);
  
  res.status(error.status || 500).json({
    success: false,
    message: error.message || 'Error interno del servidor',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// Inicializar conexión a base de datos y servidor
async function startServer() {
  try {
    await connectToCosmosDB();
    console.log('✅ Conexión a Azure Cosmos DB establecida');
    
    // Configuración optimizada del servidor HTTP
    const server = app.listen(PORT, () => {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`🚀 Backend SASU - Carnet Digital UAGro`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📡 Puerto: ${PORT}`);
      console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🏥 Health check: http://localhost:${PORT}/health`);
      console.log(`🏥 Health check (alt): http://localhost:${PORT}/ping`);
      console.log(`⚡ Keep-alive: ENABLED`);
      console.log(`⏱️  Timeout: ${server.timeout}ms`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    });
    
    // Configuraciones para mejor rendimiento y confiabilidad
    server.keepAliveTimeout = 65000; // Mayor que el timeout de ALB/ELB (60s)
    server.headersTimeout = 66000;   // Ligeramente mayor que keepAliveTimeout
    server.timeout = 120000;         // Timeout general de 2 minutos
    
    // Manejo graceful shutdown
    process.on('SIGTERM', () => {
      console.log('⚠️ SIGTERM recibido. Cerrando servidor gracefully...');
      server.close(() => {
        console.log('✅ Servidor cerrado exitosamente');
        process.exit(0);
      });
    });
    
    process.on('SIGINT', () => {
      console.log('\n⚠️ SIGINT recibido. Cerrando servidor gracefully...');
      server.close(() => {
        console.log('✅ Servidor cerrado exitosamente');
        process.exit(0);
      });
    });
    
  } catch (error) {
    console.error('❌ Error al inicializar servidor:', error);
    process.exit(1);
  }
}

// Manejo de cierre graceful
process.on('SIGTERM', () => {
  console.log('👋 Cerrando servidor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 Cerrando servidor...');
  process.exit(0);
});

startServer();
