const { BlobServiceClient } = require('@azure/storage-blob');

const DEFAULT_CONTAINER = 'fotos-carnet';

function isPhotoStorageConfigured() {
  return Boolean(
    process.env.AZURE_STORAGE_CONNECTION_STRING &&
      (process.env.AZURE_STORAGE_CONTAINER_FOTOS ||
        process.env.AZURE_STORAGE_CONTAINER_PHOTOS ||
        DEFAULT_CONTAINER)
  );
}

function getContainerName() {
  return (
    process.env.AZURE_STORAGE_CONTAINER_FOTOS ||
    process.env.AZURE_STORAGE_CONTAINER_PHOTOS ||
    DEFAULT_CONTAINER
  );
}

function getContainerClient() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

  if (!connectionString) {
    const error = new Error(
      'Azure Blob Storage no está configurado para fotografías.'
    );
    error.code = 'PHOTO_STORAGE_NOT_CONFIGURED';
    throw error;
  }

  const blobServiceClient =
    BlobServiceClient.fromConnectionString(connectionString);
  return blobServiceClient.getContainerClient(getContainerName());
}

function extensionFromMime(mimeType) {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}

function safeMatricula(matricula) {
  return String(matricula).replace(/[^a-zA-Z0-9_-]/g, '');
}

async function uploadCarnetPhotoToStorage({ matricula, buffer, mimeType }) {
  const containerClient = getContainerClient();
  await containerClient.createIfNotExists({ access: 'blob' });

  const extension = extensionFromMime(mimeType);
  const blobName = `${safeMatricula(matricula)}.${extension}`;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: mimeType,
      blobCacheControl: 'public, max-age=3600',
    },
    metadata: {
      matricula: safeMatricula(matricula),
      origen: 'carnet-digital-uagro',
    },
  });

  return `${blockBlobClient.url}?v=${Date.now()}`;
}

async function deleteCarnetPhotoFromStorage(fotoUrl) {
  if (!fotoUrl || !isPhotoStorageConfigured()) return;

  try {
    const containerClient = getContainerClient();
    const url = new URL(fotoUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    const blobName = decodeURIComponent(parts.slice(1).join('/'));
    if (!blobName) return;

    await containerClient.getBlockBlobClient(blobName).deleteIfExists();
  } catch (error) {
    console.warn('⚠️ No se pudo eliminar la fotografía anterior:', error.message);
  }
}

module.exports = {
  isPhotoStorageConfigured,
  uploadCarnetPhotoToStorage,
  deleteCarnetPhotoFromStorage,
};
