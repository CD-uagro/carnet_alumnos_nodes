const express = require('express');
const multer = require('multer');
const router = express.Router();
const {
  findCarnetByMatricula,
  updateCarnetFotoUrl,
  cleanCosmosDocument
} = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const {
  isPhotoStorageConfigured,
  uploadCarnetPhotoToStorage,
  getCarnetPhotoReadUrl,
  downloadCarnetPhotoFromStorage,
  deleteCarnetPhotoFromStorage
} = require('../config/photoStorage');

const allowedPhotoMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
const maxPhotoSizeBytes = 2 * 1024 * 1024;

function hasAllowedPhotoSignature(file) {
  const buffer = file?.buffer;
  if (!buffer || buffer.length < 12) return false;

  if (file.mimetype === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (file.mimetype === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }

  if (file.mimetype === 'image/webp') {
    return (
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    );
  }

  return false;
}

const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxPhotoSizeBytes },
  fileFilter: (req, file, cb) => {
    if (!allowedPhotoMimeTypes.includes(file.mimetype)) {
      return cb(new Error('INVALID_PHOTO_TYPE'));
    }
    cb(null, true);
  }
});

function withSignedPhotoUrl(carnet) {
  if (!carnet || !carnet.fotoUrl) return carnet;

  return {
    ...carnet,
    fotoUrl: getCarnetPhotoReadUrl(carnet.fotoUrl)
  };
}

/**
 * GET /me/carnet
 * Obtener información completa del carnet del usuario autenticado
 */
router.get('/carnet', authenticateToken, async (req, res) => {
  try {
    const { matricula } = req.user;

    if (!matricula) {
      return res.status(400).json({
        success: false,
        message: 'Matrícula no encontrada en token'
      });
    }

    // Buscar carnet en SASU
    const carnet = await findCarnetByMatricula(matricula);

    if (!carnet) {
      return res.status(404).json({
        success: false,
        message: 'Carnet no encontrado'
      });
    }

    // Limpiar datos técnicos de Cosmos DB
    const carnetLimpio = withSignedPhotoUrl(cleanCosmosDocument(carnet));

    // Log exitoso
    console.log(`📋 Carnet solicitado para matrícula: ${matricula}`);

    // Respuesta exitosa
    res.json({
      success: true,
      data: carnetLimpio
    });

  } catch (error) {
    console.error('❌ Error obteniendo carnet:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

router.post('/carnet/foto', authenticateToken, (req, res) => {
  uploadPhoto.single('file')(req, res, async (uploadError) => {
    try {
      const { matricula } = req.user;

      if (!matricula) {
        return res.status(400).json({
          success: false,
          message: 'Matrícula no encontrada en token'
        });
      }

      if (uploadError) {
        const isTooLarge = uploadError.code === 'LIMIT_FILE_SIZE';
        const isInvalidType = uploadError.message === 'INVALID_PHOTO_TYPE';

        return res.status(400).json({
          success: false,
          message: isTooLarge
            ? 'La fotografía no puede exceder 2 MB.'
            : isInvalidType
              ? 'Formato no permitido. Usa JPG, PNG o WebP.'
              : 'No se pudo procesar la fotografía.'
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Selecciona una fotografía para subir.'
        });
      }

      if (!hasAllowedPhotoSignature(req.file)) {
        return res.status(400).json({
          success: false,
          message: 'El contenido del archivo no coincide con una imagen permitida.'
        });
      }

      if (!isPhotoStorageConfigured()) {
        return res.status(501).json({
          success: false,
          storagePending: true,
          message:
            'Carga de fotografía en preparación. Falta configurar Azure Blob Storage.'
        });
      }

      const carnet = await findCarnetByMatricula(matricula);
      if (!carnet) {
        return res.status(404).json({
          success: false,
          message: 'Carnet no encontrado'
        });
      }

      const fotoUrl = await uploadCarnetPhotoToStorage({
        matricula,
        buffer: req.file.buffer,
        mimeType: req.file.mimetype
      });

      const carnetActualizado = await updateCarnetFotoUrl(matricula, fotoUrl);
      const carnetConFotoFirmada = withSignedPhotoUrl(carnetActualizado);

      console.log(`📸 Fotografía actualizada para matrícula: ${matricula}`);

      return res.json({
        success: true,
        fotoUrl: carnetConFotoFirmada?.fotoUrl || null,
        data: carnetConFotoFirmada
      });
    } catch (error) {
      console.error('❌ Error subiendo fotografía:', error);
      const safeErrorCode = error.code || error.name || 'PHOTO_UPLOAD_FAILED';
      const safeStatusCode = error.statusCode || error.status || 500;
      return res.status(500).json({
        success: false,
        message: 'Error interno subiendo la fotografía',
        errorCode: safeErrorCode,
        statusCode: safeStatusCode
      });
    }
  });
});

router.get('/carnet/foto', authenticateToken, async (req, res) => {
  try {
    const { matricula } = req.user;

    if (!matricula) {
      return res.status(400).json({
        success: false,
        message: 'Matrícula no encontrada en token'
      });
    }

    const carnet = await findCarnetByMatricula(matricula);
    if (!carnet || !carnet.fotoUrl) {
      return res.status(404).json({
        success: false,
        message: 'Fotografía no registrada'
      });
    }

    const photo = await downloadCarnetPhotoFromStorage(carnet.fotoUrl);
    if (!photo) {
      return res.status(404).json({
        success: false,
        message: 'Fotografía no encontrada'
      });
    }

    res.setHeader('Content-Type', photo.contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Length', photo.buffer.length);
    return res.send(photo.buffer);
  } catch (error) {
    console.error('❌ Error obteniendo fotografía:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno obteniendo la fotografía',
      errorCode: error.code || error.name || 'PHOTO_DOWNLOAD_FAILED'
    });
  }
});

router.delete('/carnet/foto', authenticateToken, async (req, res) => {
  try {
    const { matricula } = req.user;

    if (!matricula) {
      return res.status(400).json({
        success: false,
        message: 'Matrícula no encontrada en token'
      });
    }

    const carnet = await findCarnetByMatricula(matricula);
    if (!carnet) {
      return res.status(404).json({
        success: false,
        message: 'Carnet no encontrado'
      });
    }

    await deleteCarnetPhotoFromStorage(carnet.fotoUrl);
    const carnetActualizado = await updateCarnetFotoUrl(matricula, null);

    console.log(`🧹 Fotografía retirada para matrícula: ${matricula}`);

    return res.json({
      success: true,
      fotoUrl: null,
      data: carnetActualizado
    });
  } catch (error) {
    console.error('❌ Error quitando fotografía:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno quitando la fotografía'
    });
  }
});

module.exports = router;
